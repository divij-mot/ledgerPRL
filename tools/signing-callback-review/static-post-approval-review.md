# Static review: post-approval signing callbacks

Reviewed 2026-10-09, checkout `9a20a1b8dfce40870bc0def0ef0583ae0dc0ee69`.
All `src/...` references below are relative to `apps/ledger-bitcoin-prl/`.

The initial findings describe the pre-patch checkout. The source-only correction review at the end records the subsequently edited files and exact hashes. These changes have not been runtime-qualified.

## Result and scope

Two source-confirmed error-propagation defects remain after transaction approval:

1. **Moderate hardening/correctness issue:** a failed derivation-value read can be ignored, allowing signing under the approved account's default `/0/0` address instead of the input's validated address.
2. **Low-severity correctness/UX issue:** a failed account-key re-fetch can return success with no signatures and display “transaction signed.”

Neither finding demonstrates a spendable signature for changed transaction contents. The reviewed profile pins the transaction through Merkle commitments and a precomputed default-sighash message. Finding 1 can yield a cryptographically valid signature under the wrong key; that signature generally cannot spend the committed input. If the approved input already uses `/0/0`, the signature is for the approved input and transaction, despite the unhandled read failure.

This is an independent static source review, not an executed reproduction or a complete cryptographic audit. Only source/text reads and this report were performed. No C/test edits, production changes, builds, emulator/native binaries, capacity tests, device access, network, or signing execution were performed.

## Relevant control flow

- `handler_sign_psbt` preprocesses inputs/outputs, requires one normal internal key with `to_sign=true`, rejects tapscript/MuSig use, computes all transaction hashes, and obtains approval before calling `sign_transaction` (`src/handler/sign_psbt.c:53-66`).
- The accepted standard policy is version 2, single-key BIP86 with no script tree and branches 0/1 (`src/handler/lib/policy.c:1392-1433`); the account path must be the expected three-component hardened path (`:1479-1489`). Nonzero wallet HMACs are rejected (`src/handler/sign_psbt/init_global_state.c:147-155`).
- During preprocessing, `input_keys_callback` reads derivation values, latches failures in `unexpected_pubkey_error`, and sets `key_expression_found`, `is_change`, and `address_index` only on successful compatible derivation (`src/handler/sign_psbt/preprocess_inputs.c:83-115`). Preprocessing checks that latch (`:170-174`), compares the input's script with the derived wallet script (`:284-302`; `src/handler/sign_psbt/process_in_outs.c:109-134`), and marks the input as internal (`preprocess_inputs.c:305`).
- After approval, signing reconstructs a fresh zeroed `input_info_t` and repeats the same callback traversal for each previously marked internal input (`src/handler/sign_psbt/sign_input.c:672-689`).

## Finding 1: callback error latch is ignored on the signing pass

**Source chain**

1. `call_get_merkleized_map_with_callback` authenticates the input-map commitment and traverses its keys (`src/handler/lib/get_merkleized_map.c:28-57`).
2. The key traversal calls a **void** callback and returns zero after all key leaves succeed. It cannot directly observe a callback's nested value-read error (`src/handler/lib/check_merkle_tree_sorted.c:25-55`).
3. `input_keys_callback` performs a nested derivation-value read. A negative result sets `input.in_out.unexpected_pubkey_error` but does not abort the outer traversal (`src/handler/sign_psbt/preprocess_inputs.c:85-95`).
4. The derivation reader returns negative on a failed streamed proof/preimage, without updating the input's change/index (`src/handler/sign_psbt/process_in_outs.c:58-67`; `src/handler/sign_psbt/extract_bip32_derivation.c:144-155`). Even when an untrusted streamed chunk has reached the extraction callback, the extracted derivation is copied to its caller only after successful stream completion (`extract_bip32_derivation.c:158-166`).
5. The signing loop checks only `res < 0`; it does **not** check `unexpected_pubkey_error` or `key_expression_found` before `sign_transaction_input` (`src/handler/sign_psbt/sign_input.c:678-721`). Its fresh input remains `is_change=false`, `address_index=0` when the one permitted derivation fails.
6. `sign_transaction_input` constructs the private-key derivation from the retained, authenticated account prefix plus these fresh fields (`sign_input.c:257-268`). Given the accepted policy, that means the same account's `/0/0` path.
7. That path passes the generic PRL path check (`src/prl.h:64-71`). The Schnorr helper generates and verifies the signature against the key it just derived, rather than checking that public key against the committed input's expected output key (`src/handler/sign_psbt/sign_input.c:156-168,173-175,207-228`). Thus local signature self-verification does not catch this path-selection error.

**Host behavior needed:** first provide a valid PSBT and all data needed for review. After approval, answer the outer input-map/key requests correctly but supply invalid content/proof/continuation for the callback's derivation value, using an otherwise valid continuation APDU. Resume correct responses for subsequent requests. The nested read fails without invalidating the outer key traversal; no cryptographic commitment needs to be forged to trigger the error path. Choosing an invalid value proof alone is sufficient; malformed APDU transport behavior is not necessary.

**Impact and limits:** signing may continue and yield a signature under `/0/0` for the already fixed transaction digest. For an input at another address, this is an invalid transaction signature relative to that input's actual output key, not arbitrary path control or a demonstrated theft primitive. The host cannot inject an arbitrary new path through this failed read: extraction failure prevents that path from being installed. The account prefix remains the previously authenticated account. A later failure also does not retract any signatures already yielded for earlier inputs; those signatures still commit the approved transaction.

**Recommended correction, not implemented:** immediately reject after traversal if the error latch is set or no compatible key was found. In this strict profile, require the one derivation and expected internal-key presence again, and validate/bind the reconstructed key to the committed script before signing, or retain the validated per-input path from preprocessing and avoid this mutable reconstruction. General callback APIs should carry an explicit error result rather than relying on callers to remember a separate latch.

## Finding 2: key-info re-fetch failure is conflated with “nothing to sign”

- `select_keyexprs_to_process` re-fetches previously known internal key info, but on any false result it simply continues (`src/handler/sign_psbt/sign_input.c:538-560`).
- `get_and_verify_key_info` returns false for transport/proof/preimage failure as well as “not internal,” without an error status for the data-failure branch (`src/handler/sign_psbt/init_global_state.c:228-249`). `fill_keyexpr_info_if_internal` forwards that boolean (`:285-304`).
- If the sole key fails this post-approval re-fetch, selection returns false and `sign_transaction` returns **true** (`src/handler/sign_psbt/sign_input.c:667-670`).
- The handler uses that true result for both its UI status and `SW_OK` (`src/handler/sign_psbt.c:66-68`). The NBGL success branch explicitly displays `STATUS_TYPE_TRANSACTION_SIGNED` (`src/ui/display.c:420-428`; `src/ui/display_nbgl.c:687-694`).

An invalid Merkle proof or preimage inside a valid continuation response is enough. Unlike an APDU-parser failure, this does not require an earlier status word already to have been sent. The result is false success with zero emitted signatures, not a signature substitution or private-key disclosure.

**Recommended correction, not implemented:** distinguish “not internal / not selected” from retrieval/validation failure, propagate errors, and fail closed when an already-required internal key cannot be revalidated. Track the number of expected/completed signatures and permit success only when all required inputs were handled.

## Why these failures do not establish spendable substitution

- The initial APDU stores fixed input/output counts and roots (`src/handler/sign_psbt/init_global_state.c:68-106`). Later map fetches authenticate their serialized size/key-root/value-root against those roots (`src/handler/lib/get_merkleized_map.c:28-44`).
- Merkle proof verification checks leaf position/depth, exact continuation sizes/progress, and the reconstructed root (`src/handler/lib/get_merkle_leaf_hash.c:27-30,64-87,119-146`). The buffered preimage reader hashes and checks all supplied bytes, and clears failed outputs (`src/handler/lib/get_merkle_preimage.c:126-146`). Streaming data is delivered before final authentication, but its caller receives a negative status on mismatch (`src/handler/lib/stream_preimage.c:75-77,115-131`); the defect is swallowing that status, not accepting a different authenticated value.
- Keys are verified strictly sorted, hence unique (`src/handler/lib/check_merkle_tree_sorted.c:29-44`). By-key value lookup authenticates the returned key index and then the value at that index (`src/handler/lib/get_merkleized_map_value.c:20-49`; `src/handler/lib/get_merkle_leaf_index.c:50-64`). A host can claim a key is absent without proving absence (`get_merkle_leaf_index.c:45-47`), but the relevant post-approval sighash/witness reads require `PRESENT` and reject absence (`src/handler/sign_psbt/sign_input.c:246-254,323-329`).
- Preprocessing permits only default sighash for this profile (`src/handler/sign_psbt/preprocess_inputs.c:344-360`), and the signing helper also requires sighash byte zero, no tapscript hash, and the BIP86 empty tweak (`src/handler/sign_psbt/sign_input.c:165-168`). Key leaves are authenticated on the repeated pass, so presence flags cannot silently be changed to reach a different spend mode.
- The five transaction hashes are computed before approval (`src/handler/sign_psbt.c:63-64`; `src/handler/sign_psbt/txhashes.c:162-281`). Default taproot sighash commits to those hashes, version, locktime, and current input index (`txhashes.c:596-623,663-667`). Changing outputs, inputs, amounts, scripts, order, or the index would change the signed message, absent a cryptographic break. A wrong `/0/0` signature cannot be moved to a different input to evade this binding.
- There is no generic dispatcher fatal-error latch for these nested semantic failures: its stored status is reset on interruptions, while helper return values and callback state carry failures (`src/boilerplate/dispatcher.c:49-63,94-129`). The final “no response” fallback only checks whether a status was sent (`:184-189`); it cannot repair a false success.

## Upstream comparison and next verification

Local text comparison with `/workspace/shared/app-bitcoin-stable-2.5.1` shows the same boolean selection pattern (`src/handler/sign_psbt/sign_input.c:524-546,653-655`) and the same missing callback-latch check in the signing pass (`:664-707`), plus the same conflation in key-info retrieval (`src/handler/sign_psbt/init_global_state.c:254-330`). These patterns are inherited; this report makes no claim about exploitability across upstream's broader supported policies.

When the native lane is explicitly resumed, directed tests should distinguish: invalid outer-map/key proofs (must abort); invalid nested derivation proof or preimage on the post-approval pass (must abort before signing); invalid post-approval account-key retrieval (must not report success); valid multi-input signing; and a later-input fault after earlier signatures have already been yielded. No such tests were run in this review.

## Addendum: independent static review of defensive source corrections

Reviewed 2026-10-09 at approximately 23:03 UTC. Inspected the complete current diff of the three files below against checkout `9a20a1b8dfce40870bc0def0ef0583ae0dc0ee69`, then traced affected callers and the existing host recovery path. **No new blocking issue was found in this narrow static review. Both original findings are corrected in the inspected source for the enforced Pearl profile; no claim of compiled, emulator, device, or native-test validation is made.** This reviewer did not edit any production source.

### Corrections and compatibility

- **Callback failure / reconstructed path:** `src/handler/sign_psbt/sign_input.c:698-705` now rejects a negative traversal result, the callback error latch, missing compatible key, derivation count other than one, missing Taproot internal-key field, or missing witness UTXO. These checks occur before the signing loop. All are already mandatory during successful preprocessing (`src/handler/sign_psbt/preprocess_inputs.c:170-174,284-305,334-339`), so no previously accepted honest input in the strict profile should be rejected. Optional non-witness UTXO remains allowed. It is sound to avoid re-reading the internal-key field's contents at this point: its key and value commitments were authenticated and validated before review; a successful derivation stream must match the same value commitment. The new error check prevents a failed stream from installing or retaining default path state. Path 0/0 itself remains valid when genuinely authenticated; zero is not used as a blanket rejection sentinel.
- **Empty selection:** `src/handler/sign_psbt/sign_input.c:672-678` now returns false with `SW_INCORRECT_DATA` when selection fails. This fixes the re-fetch-error case because `handler_sign_psbt` has already required exactly one signable normal internal key (`src/handler/sign_psbt.c:56-62`). The underlying selection helper still conflates errors with non-selection (`sign_input.c:543-565`); this minimal correction is sufficient only under that enforced one-key invariant. It is not a general repair for future multi-key/MuSig policies, which should use distinct error/not-selected outcomes. No additional runtime signature-count counter was introduced, but the fixed input bitvector, one selected key, and per-input false-return propagation make the current successful path process every approved internal input.
- **Leaf-index framing:** `src/handler/lib/get_merkle_leaf_index.c:33-38` now rejects leftover response bytes after found/index. The parser's existing bounds and found-flag checks remain intact. This intentionally rejects previously tolerated padding; the retained host returns exactly one flag plus a compact-size index (`packages/bitcoin-prl-adapter/src/upstream/clientCommands.ts:216-226`). Honest absent-key responses still encode flag 0/index 0, and all queried profile maps are nonempty. The change does not authenticate absence; callers still must distinguish absence from transport/proof failure as before.
- **Yield ACK framing:** `src/handler/sign_psbt/sign_input.c:83-92` now rejects any nonempty ACK body. Checking total size, rather than remaining bytes, is appropriate: `process_interruption` supplies a freshly created buffer for the continuation payload (`src/boilerplate/dispatcher.c:121-129`), and YIELD has no ACK data. The retained host returns an empty buffer (`packages/bitcoin-prl-adapter/src/upstream/clientCommands.ts:39-44`). The already-released signature is correctly called out in the new comment. Protocol version, signature format, signed digest, tweak, derivation, and output bytes are otherwise unchanged.
- **Public Taproot tweak return:** `src/handler/lib/policy.c:1164-1169` now returns `-1` if `crypto_tr_tweak_pubkey` fails. The crypto function's actual contract is 0/-1 and its output is written only on successful completion (`src/crypto.c:566-607`; declaration `src/crypto.h:439-461`), so `< 0` is correct. This avoids returning a successful 34-byte script containing uninitialized/stale output bytes after failure. Both callers honor the negative script length: ownership comparison rejects it (`src/handler/sign_psbt/compare_wallet_script_at_path.c:44-56`), and wallet address generation exits with error before conversion/display (`src/handler/get_wallet_address.c:169-186`). Valid tweaked-key derivation is unchanged. The pre-existing zero-tweak/exceptional SDK behavior was not broadened or runtime-tested.

### Error lifecycle and signatures already released

The new selection/callback guards send an error, return false to `handler_sign_psbt`, suppress its final `SW_OK`, show failure, and reach its existing zeroization cleanup (`src/handler/sign_psbt.c:66-75`). As before, a malformed continuation APDU can already trigger an error inside `process_interruption`, followed by the caller's error status; the patches neither create a persistent error latch nor redesign that existing double-status possibility (`src/boilerplate/dispatcher.c:105-124`). The findings and corrections do not depend on malformed APDU framing: valid continuation APDUs containing invalid Merkle data are sufficient.

The transaction is not atomic with respect to signature delivery. `yield_signature` sends the signature as part of the `io_exchange` that receives its ACK (`src/handler/sign_psbt/sign_input.c:79-90`; `src/boilerplate/dispatcher.c:84-102`). A malformed ACK, later input failure, timeout, or final rejection cannot revoke that signature. The device may therefore display rejection after one or all signatures already reached the host. This is a retained protocol/UI limit, not evidence that signed bytes became invalid.

Static inspection confirms the current host handles the important complete-result case: it verifies each yielded output key and signature, finalizes only the complete set, and calls the durability callback **before** replying to the final yield (`packages/bitcoin-prl-adapter/src/client.ts:337-353,529-571`). Later ACK/status failure returns the retained verified result with `device-acknowledgement-unconfirmed`; a durability failure instead raises `VerifiedSigningResultError` carrying it (`:583-592`). The failed session is terminal (`:267-276`). The companion persists the signing reservation before device activity, saves verified bytes in the pre-ACK callback, preserves emergency recovery data if persistence fails, and gives an acknowledgement warning (`apps/companion/src/main.ts:1105-1117,1156-1264,1266-1274`). An incomplete signature set is not finalized or silently downgraded to an unsigned draft; its original signing reservation remains. Recovering the identical payment requires fresh identity approval and input-status validation (`:1084-1154`). No new broadcast permission or automatic broadcast was introduced.

These are source-level observations of existing recovery code, not an end-to-end recovery test. A future native qualification should verify nonempty ACKs after both intermediate and final signatures, wrong callback data at each post-approval stage, honest one-/multi-input flows, native return statuses, and actual device UI behavior.

### Exact inspected source SHA-256 hashes

Paths are repository-relative:

- `apps/ledger-bitcoin-prl/src/handler/lib/get_merkle_leaf_index.c`: `2715f9b45e742852dd3f0fd323779a1f39b14a0e00478e90cec12568724ff022`
- `apps/ledger-bitcoin-prl/src/handler/lib/policy.c`: `ca51d7abd135d3c8a9ce259010afb00f77869b34aa1ca21ca4173bc8ab394f9e`
- `apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c`: `2b667957a5944e44cdc494cfcb5876de53d7048dfecea4556c6c2f7a7b78e5d8`

Native execution remained paused throughout. No builds, native tests/binaries, emulator, capacity tests, device interaction, network, or signing execution was attempted. Existing build/test evidence from earlier source cannot qualify these edited C files.
