# Native PRL parser and resource-boundary review

## Result and limits

Two new, source-supported low-severity hardening findings were identified:

1. Nonminimal CompactSize encodings are accepted by both the APDU/Merkle readers and the reachable optional previous-transaction parser. The latter hashes a canonical reconstruction rather than the supplied noncanonical transaction bytes.
2. The wallet xpub parser accepts any nonnegative Base58 decode length, then compares a fixed four-byte checksum from a structure that a short successful decode did not completely initialize.

Neither finding establishes an amount/recipient/ownership substitution, a signing-key bypass, an out-of-bounds write, or a practical information disclosure. No new high- or critical-severity issue was substantiated in this review. That is a bounded static-review result, not a security certification.

Review baseline: repository commit `03112c09890fb08c48a83e743d842fdbd791c29c`; source working tree was clean when inspected. The inspected SDK checkout was `6709cd2bdfebb224ee070f7c1211b54254262579`. Paths below are relative to the repository root; `APP` means `apps/ledger-bitcoin-prl` and `SDK` means `apps/ledger/vendor/ledger-secure-sdk`.

The initial finding pass used only source/document reads and this review deliverable. A subsequently authorized source-only correction is recorded in `PATCH.md` and `source-only.patch`; it remains unqualified. No native executable, test, harness, compiler, emulator, capacity run, device, network request, or secret access was used. Existing corrected findings concerning leaf-index trailing bytes, signature ACK bytes, postapproval derivation error latches/empty selection, and Taproot tweak-return handling are not reported as new findings. Source line citations in this report refer to the pre-correction baseline above.

## NP-01: Noncanonical CompactSize acceptance and previous-tx normalization

Severity: low, parser/profile correctness and hardening. Confidence: high in source behavior; native manifestation and firmware qualification remain untested.

### Source trace

- `SDK/lib_standard_app/varint.c:42-76` accepts FD/FE/FF encodings whenever enough bytes exist. It does not require FD values to be at least 253, FE values to exceed 65535, or FF values to exceed 4294967295.
- `SDK/lib_standard_app/buffer.c:130-140` delegates directly to that decoder, clears the output on a negative decode result, and advances by the returned encoded length on success. Thus nonminimal encodings are successful reads, not malformed/incomplete reads.
- `APP/src/handler/sign_psbt/init_global_state.c:68-113` uses this reader for the APDU global-map size and input/output counts. Numeric limits and exact final APDU exhaustion are checked, but neither enforces shortest encoding. For example, an input count of one encoded as `FD 01 00` passes the same numeric test as `01`.
- The same permissive reader is used for a committed map's size at `APP/src/handler/lib/get_merkleized_map.c:38-44`, preimage lengths at `get_preimage.c:32-57`, `get_merkle_preimage.c:40-57`, and `stream_preimage.c:34-54`, a leaf index at `get_merkle_leaf_index.c:33-38`, and wallet descriptor length/key count at `APP/src/common/wallet.c:119-149`.
- Independently of the SDK, `APP/src/common/parser_ext.c:67-107` implements a two-buffer CompactSize reader with the same omission. It returns `false` without consuming bytes when the complete prefix-selected encoding is unavailable; once all bytes are available, it consumes them, writes the value, and returns `true` without minimality checks.
- This local reader is reached in previous-transaction scriptSig length (`APP/src/handler/lib/psbt_parse_rawtx.c:103-118`), output-script length (`197-226`), input count (`343-355`), output count (`390-402`), and witness element counts/lengths (`447-507`).
- The four non-witness length/count sites subsequently call `crypto_hash_update_varint`, which re-encodes the numeric value using `varint_write` (`APP/src/crypto.h:153-156`; `SDK/lib_standard_app/varint.c:25-39,79-103`). That writer uses shortest encodings. Witness fields are parsed but not part of the txid hash, as expected.

### Reachability under the strict PRL profile

1. `APP/src/main.c:52-78` exposes SIGN_PSBT.
2. `APP/src/handler/sign_psbt.c:53-55` calls the global parser and then input preprocessing before review/signing.
3. The input key allowlist explicitly permits `PSBT_IN_NON_WITNESS_UTXO` (`APP/src/handler/sign_psbt/preprocess_inputs.c:58-65,77-78`). It is optional even though a witness UTXO is ultimately required for this Taproot profile (`334-338`).
4. When the non-witness field is present, preprocessing calls `get_amount_scriptpubkey_from_psbt_nonwitness` (`199-220`), which invokes `call_psbt_parse_rawtx` and compares its computed txid against the committed previous txid (`APP/src/handler/sign_psbt/amount_from_psbt.c:47-76`).
5. `call_psbt_parse_rawtx` obtains the committed value hash, streams/authenticates the supplied bytes, requires completed parsing and a valid selected output, and finally double-hashes the reconstructed base serialization (`APP/src/handler/lib/psbt_parse_rawtx.c:595-623`).

The raw-transaction parser is consequently reachable in accepted PRL signing requests; this is not an allegation based on unreachable legacy signing code.

### Static counterexample and impact boundary

Take an otherwise acceptable previous transaction with one input. Replace its input-count encoding `01` with `FD 01 00`, and commit that changed non-witness-UTXO value in the PSBT's Merkle tree. Leave the PSBT previous txid equal to the original canonical transaction's txid and keep the witness UTXO consistent with the original selected output.

The stream's SHA256 authenticates the changed bytes against the host-chosen Merkle commitment. The parser consumes the overlong count as one and hashes it back as `01`. It therefore computes the original canonical transaction's txid, and the previous-txid comparison has no reason to reject solely because of this changed encoding. This is a source-level counterexample, not an executed test.

This permits malformed/noncanonical evidence to pass a check described as validating the supplied previous transaction. It does not change the selected output amount or script: the strict path compares any supplied non-witness output with the witness UTXO (`preprocess_inputs.c:248-262`), verifies the input is internal (`284-302`), and later commits amounts/scripts in the Taproot sighash (`APP/src/handler/sign_psbt/txhashes.c:229-279`). No collision or false ownership proof follows from merely normalizing the integer encodings.

### Exact minimal correction proposal

Use app-local canonical readers rather than changing the pinned SDK dependency or globally macro-replacing its API:

1. Add a boolean single-buffer wrapper in `common/buffer_ext.[ch]`. Decode against a temporary copy of the buffer descriptor; require the consumed encoded length to equal `varint_size(value)` (or check the three prefix minimums directly). Commit the original offset and output only on canonical success. Return `false` with the output unchanged on truncation or noncanonical encoding. All ten currently reachable single-buffer call sites already terminate their containing read/parse path on `false`; no extra parser state is needed there.
2. Replace those ten reachable uses: the two wallet-header values, global-map size plus two SIGN_PSBT counts, serialized-map size, the three preimage readers, and the leaf-index response reader. Keep the numeric caps and exact-consumption checks. REGISTER_WALLET and SIGN_MESSAGE are absent from the command table; their reader sites need not be changed to correct the reachable profile.
3. Change the local two-buffer CompactSize API to an explicitly documented tri-state return: `1` canonical success, `0` insufficient bytes, `-1` malformed/nonminimal. Decode using temporary buffer descriptors and only commit offsets/value on success. Incomplete and malformed reads should leave the original offsets and output unchanged.
4. Update all six raw-transaction call sites. The four length/count parsing steps currently store the result in `bool`; change them to `int`, apply width limits/state assignments/hash updates only when the result is exactly `1`, and return `0`/`-1` unchanged. At the two witness sites, preserve `0` versus `-1` rather than using logical negation. `parser_run` already preserves results `<= 0` (`parser_ext.c:126-146`), and the streaming callback already latches negative results (`psbt_parse_rawtx.c:546-568`). The outer routine already rejects a latched error before using outputs (`606-623`).

Important correction hazard: do not just add a minimality check after consuming bytes and return boolean `false`. Existing callers interpret `false` as “need more data” and can retry that same field using the bytes after the rejected encoding. Also do not change the reader to return `-1` while retaining `bool result` or `if (!reader(...))` callers: `-1` would be treated as success. The proposed tri-state caller updates avoid both problems.

### Unexecuted regression requirements

- Canonical boundary values: 252, 253, 65535, 65536, 4294967295, 4294967296, UINT64_MAX; numeric application caps still apply afterward.
- Reject FD encodings below 253, FE below 65536, FF below 4294967296, including zero in each wider form.
- For the two-buffer reader, split each encoding at every byte boundary; truncated reads must leave offsets unchanged, complete noncanonical reads must return a fatal error, and malformed bytes followed by a valid-looking replacement must never be reinterpreted as a successful same-field retry.
- Inject nonminimal values separately at the APDU, map, preimage, leaf-index, and wallet-header boundaries.
- Exercise the previous-tx static counterexample with a recomputed valid Merkle commitment; require rejection even though normalization would produce the old txid. Repeat for input/output counts, script lengths, and witness count/length fields.

## NP-02: Successful short Base58 decode is not length-checked

Severity: low, malformed-input/uninitialized-read hardening. Confidence: high in the source-level length omission; no practical leak or bypass demonstrated.

### Source trace and precise decoder semantics

- `APP/src/common/wallet.c:356-370` permits an alphanumeric xpub string of 111 or 112 characters. This is only a loose encoded-character-length check.
- At `wallet.c:373-379`, `serialized_extended_pubkey_check_t ext_pubkey_check` has automatic storage and no initializer. The only check on `base58_decode` is whether it returned a negative result.
- The structure is 78 serialized xpub bytes followed by four checksum bytes (`APP/src/crypto.h:21-33`). All members are byte arrays or a byte, so no padding is required between these fields.
- The inspected SDK decoder returns `-1` for invalid input or a decoded result larger than the destination. On positive success it copies exactly its computed `length` bytes and returns that length (`SDK/lib_standard_app/base58.c:45-105`, especially `97-105`). It neither requires `length == out_len` nor initializes the unused destination suffix.
- The caller hashes the fixed 78-byte payload and compares all four checksum bytes (`wallet.c:381-389`), without first establishing that all 82 bytes were supplied by the successful decode.

An allowed 111-character Base58 string can decode to 81 bytes. For example, 111 occurrences of the character `2` represent `(58^111 - 1) / 57`, which lies between `256^80` and `256^81`; this requires 81 decoded bytes and has no leading zero characters. This arithmetic example was not executed. It establishes that the 111/112-character check does not imply an 82-byte result. The final checksum byte can therefore remain indeterminate when the fixed-size comparison is called. A particular `memcmp` may stop at an earlier mismatch; this report does not claim every malformed input actually causes a machine-level load of that final byte.

### Reachability and impact boundary

GET_WALLET_ADDRESS reaches the policy key parser through `is_wallet_policy_standard` (`APP/src/handler/get_wallet_address.c:126-137`; `APP/src/handler/lib/policy.c:1440-1456`). SIGN_PSBT uses the same standard-wallet check while loading the account (`APP/src/handler/sign_psbt/init_global_state.c:187-197`). The host commits and supplies the key-info leaf, so Merkle validation does not restrict its encoding to a well-formed xpub.

The strict policy subsequently derives the expected xpub and compares all 78 bytes (`policy.c:1463-1492`). Later signing key-info reads perform the same full comparison (`init_global_state.c:262-279`). Therefore a short malformed Base58 result is not established as a way to authenticate a different account or signing key. The source issue is use of an incompletely written checksum structure before an exact decoded-length check. No out-of-bounds write, returned stack data, private-key disclosure, or reliable side channel has been demonstrated.

### Exact minimal correction proposal

At the single `base58_decode` call in `common/wallet.c`, require the return to equal `(int) sizeof(ext_pubkey_check)`, not merely be nonnegative. Return the existing parse error otherwise, before checksum hashing/comparison. For defense in depth initialize `ext_pubkey_check` to zero, but do not treat zero-initialization as a substitute for exact decoded-length validation. The parsed output structure is already cleared at `wallet.c:316`; malformed decoding must never proceed to the assignment at `391`.

Decoder failures already return before the checksum logic. Exact successful length validation closes the only missing distinction. No SDK change is required. The existing caller negative-result checks propagate this parse failure before account use.

### Unexecuted regression requirements

- Valid 82-byte xpub/checksum round trips at permitted 111/112-character encodings remain accepted.
- 111-character input decoding to 81 bytes is rejected before hashing/comparing the structure.
- Where a test double is appropriate, returns 0 through 81 and negative return values must fail; exactly 82 with valid checksum can proceed; an over-cap result must fail.
- A canary-filled destination or memory-initialization instrumentation should demonstrate that no checksum byte outside the returned decoded region is read on short success. Such native instrumentation was not run here.

## Checked boundaries and important exclusions

| Boundary | Source-supported observation |
|---|---|
| APDU envelope | SDK `parser.c:25-50` validates Lc against received size; `APP/src/boilerplate/dispatcher.c:150-157` rejects wrong protocol/P1 and unsolicited continuation; continuation parsing requires exact CLA/INS/P1/P2 at `121-127`. |
| APDU command payloads | SIGN_PSBT checks complete consumption (`init_global_state.c:108-113`); xpub and wallet-address handlers bound paths/indexes and reject trailing command bytes (`get_extended_pubkey.c:47-70`, `get_wallet_address.c:70-95`); network/fingerprint requests require empty data. |
| Transaction counts | SIGN_PSBT enforces 1..16 inputs and 1..2 outputs before narrowing (`init_global_state.c:81-106`; `prl.h:12-13`). The global committed counts are independently checked as exact one-byte values (`prl_psbt.c:59-76`). The canonicality finding does not evade these numerical bounds. |
| Map sizes and key shapes | Global maps must contain 5..7 entries before the key scan (`prl_psbt.c:59-66`); input/output maps must contain 1..8 before scanning (`get_merkleized_map.c:38-44`). Input keys allow at most eight entries and output keys at most four, with exact scalar/32-byte-key shapes (`preprocess_inputs.c:55-70`, `preprocess_outputs.c:51-64`). |
| Key uniqueness | All committed keys are visited and must be strictly increasing (`check_merkle_tree_sorted.c:25-53`). `_keys_are_sorted` is set only after successful traversal (`get_merkleized_map.c:47-56`; `prl_psbt.c:63-67`). |
| Merkle proofs | Tree size/index, exact leaf depth, proof count versus declared depth, available and exact response bytes, and final root equality are checked (`get_merkle_leaf_hash.c:27-31,58-85,95-147`). An initially empty proof batch can request more once; continuation batches must have positive count and correct element size. |
| Preimage capacity | Fixed-output readers reject announced lengths above destination capacity before copying (`get_preimage.c:39-57`, `get_merkle_preimage.c:47-57`). Streamed values are capped at 65536 payload bytes before callbacks (`stream_preimage.c:41-67`). |
| Continuation progress | All three preimage loops reject zero progress, wrong element width, trailing/missing bytes, and overrun beyond remaining bytes before decrement (`get_preimage.c:88-115`, `get_merkle_preimage.c:95-123`, `stream_preimage.c:92-119`). Counts are one-byte values, so the checked multiplication has no realistic integer-overflow range on supported targets. |
| Stream-to-parser boundary | Rawtx fields are read in at most 32-byte pieces, carry storage is checked rather than truncated, parser errors latch, trailing bytes fail, and incomplete parsing/invalid selected index fail (`psbt_parse_rawtx.c:130-153,238-282,535-623`). Values are not used by the amount helper after a negative parser result (`amount_from_psbt.c:66-86`). |
| Derivation values | Only Taproot keys and a five-step PRL path reach acceptance (`process_in_outs.c:41-84`); the leaf-hash count must be zero; fingerprint/path size is capped and its final length must be at least four and divisible by four (`extract_bip32_derivation.c:66-104,144-166`). Stream/hash failure and callback error are checked before decoding output bytes. |
| Monetary counters | Per-value and aggregate checks use subtraction before addition; totals remain below PRL_MAX_MONEY (`prl.h:51-56`; `preprocess_inputs.c:222-230,266-278,305-309`; `preprocess_outputs.c:159-170,233-237`). Duplicate outpoints are rejected within the 16-input bound (`preprocess_inputs.c:148-188`). |
| Authentication errors | Buffered Merkle/preimage outputs are cleared on failure; raw/map error codes are normalized instead of conflated with absence (`get_preimage.c:130-140`, `get_merkle_preimage.c:137-146`, `get_merkle_leaf_element.c:24-30`, `get_merkleized_map_value.c:30-49`). Required fields require PRESENT before use. Host-claimed absence is not a membership proof, but strict required fields and presence-latched optional controls prevent using that claim to choose a different PRL transaction value in the reviewed path. |
| Wallet parser resources | The generic descriptor parser executes before the standard-policy gate, so it is an exposed parser surface even for this profile. Header/descriptor and AST byte budgets, recursion depth, wrapper-depth accounting, taptree depth, and allocation-failure checks exist (`wallet.h:53-85,106-113`; `wallet.c:710-765,2018-2030`). Their worst-case compiled stack use was not measured. |

The generic Bitcoin signing branches (legacy ECDSA, SegWit-v0, script-path Taproot, MuSig2, registration, and message signing) were not treated as successful reachable signing features. `policy.c:1394-1434` restricts standard wallets to version-2 single-key, no-tree BIP86; the signing entry guard at `sign_psbt.c:56-62` additionally rejects non-normal/tapscript/MuSig state; unsupported commands are absent from `main.c:52-78`.

One inherited helper merits a scope note rather than an exploit finding: `io_ext.c:114-135` assumes response append state is below capacity; appending again after an overflow/finalization could underflow its `remaining` calculation. The reviewed strict path has small fixed response sizes and returns/reset paths around errors. No host-controlled trace to that dangerous append state was found, so it is not presented as a reachable memory-corruption finding.

The 65536-byte previous-transaction bound permits a substantial amount of authenticated parsing and many positive one-byte continuations. The command deadline and interruption timeout are source-visible (`dispatcher.c:41-46,76-92`; `io_ext.c:93-111`), but wall-clock guarantees, ticker behavior, compiler stack allocation, deepest rejected descriptors, maximum valid inputs, and actual hardware capacity are unqualified. Future native/hardware work must be separately authorized and must verify the final corrected source/binaries.
