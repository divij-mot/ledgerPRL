# PRL device approval-to-signature binding: static review

Date: 2026-10-09. Target: `apps/ledger-bitcoin-prl`, the C fork declaring
Ledger app-bitcoin 2.5.1 commit `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`.
Repository HEAD observed during review: `9a20a1b8dfce40870bc0def0ef0583ae0dc0ee69`.
Its locally verified tree is `d2309835da0b71f92ba2279cacf2ddf2a2047173`.
The supplied corresponding remote baseline is
`5e7b68be4c0464685d2f1a43b9a0b7dfab50f39e`, reported as the same tree. That remote
object is not available in this checkout and was not fetched; the remote
same-tree claim was not independently reverified in this no-network review.
Final inspected source hashes are in [source-identity.json](source-identity.json).

## Scope and present result

This review reads source and local upstream objects only. It performs no native
build, compiled-code execution, emulator run, capacity harness, firmware install,
native test, wallet access, broadcast, or network operation. After reporting the
findings, the parent explicitly authorized narrow **source-only** defensive
guards in `sign_input.c` and `policy.c`; those are now applied, with no test-source
changes. The paused native-execution lane remains paused. Examples below are source-level
control-flow traces, **not executed reproductions**.

One host-triggerable post-approval error-propagation defect and one
fault-conditional crypto-error propagation defect are established below. Both
have source-only corrections, **uncompiled and unexecuted**, described in
[source-only-patch.md](source-only-patch.md).
The inspected transaction commitments still bind the resulting digest to the
transaction approved on-device; this defect does **not** establish approval
bypass, transaction substitution, private-key disclosure, or theft. Static review
is not hardware qualification, a proof of security, or vendor approval.

The two already-documented continuation-body exceptions in
`../device-source-review/README.md` are outside this finding.

## DAB-01: signing re-read ignores a failed input-derivation callback

**Severity: Low, fail-closed/correctness. Source-confirmed control flow;
source-corrected, uncompiled and unexecuted.** The following trace describes the
pre-correction source (line references are from that snapshot; nearby current
lines may have shifted). A hostile host can trigger the original error with ordinary malformed
continuation data; no hardware fault is required. Obtaining a signature still
requires the user to approve the original transaction.

### Initial validation really happens

1. `handler_sign_psbt` creates zeroed transaction/signing state, preprocesses every
   input and output, computes transaction hashes, then calls the device review.
   `sign_transaction` is only called after the review returns true
   ([sign_psbt.c:44-68](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt.c#L44)).
2. Preprocessing obtains the committed input map and invokes
   `input_keys_callback`. It explicitly rejects
   `input.in_out.unexpected_pubkey_error` immediately after that traversal
   ([preprocess_inputs.c:151-174](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_inputs.c#L151)).
3. Successful derivation parsing establishes a device-derived five-element BIP86
   path/public-key match, compatibility with the authenticated account, and
   `is_change`/`address_index`; ownership is independently checked against the
   reconstructed output script. This review is **not** claiming that an invalid
   derivation can enter through the initial validation
   ([process_in_outs.c:54-106](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/process_in_outs.c#L54),
   [preprocess_inputs.c:282-303](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_inputs.c#L282)).

### Error after approval is handled differently

1. `sign_transaction` selects the already-signable internal key expression,
   creates a **new** zeroed `input_info_t`, and re-fetches its map with the same
   callback. Its only check is `res < 0` from the outer map traversal. It does not
   inspect `unexpected_pubkey_error` or `key_expression_found` before calling
   `sign_transaction_input`
   ([sign_input.c:667-721](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c#L667)).
2. The outer map traversal authenticates the map commitment and sorted key
   leaves, but its callback has no return status. It calls the callback and then
   proceeds to the next key; a callback-local failure does not change its success
   return ([get_merkleized_map.c:28-57](../../apps/ledger-bitcoin-prl/src/handler/lib/get_merkleized_map.c#L28),
   [check_merkle_tree_sorted.c:25-55](../../apps/ledger-bitcoin-prl/src/handler/lib/check_merkle_tree_sorted.c#L25)).
3. While processing the authentic `PSBT_IN_TAP_BIP32_DERIVATION` **key**, the
   callback separately fetches that key's **value** from the committed values
   tree. The host can return a malformed proof for this inner request, while
   supplying valid proofs for the outer key traversal and all other requests.
   `get_merkle_leaf_hash` returns `-1`, for example on an impossible proof depth;
   its wrapper clears the leaf-hash output but does not terminate the command
   ([get_merkle_leaf_hash.c:58-75,153-163](../../apps/ledger-bitcoin-prl/src/handler/lib/get_merkle_leaf_hash.c#L58)).
4. `call_stream_merkle_leaf_element` returns `-1`; `extract_bip32_derivation`
   returns `-1`; `read_change_and_index_from_psbt_bip32_derivation` returns `-1`.
   The callback sets `unexpected_pubkey_error = true` and leaves the new input's
   `is_change`, `address_index`, and `key_expression_found` at their zero defaults
   ([stream_merkle_leaf_element.c:17-25](../../apps/ledger-bitcoin-prl/src/handler/lib/stream_merkle_leaf_element.c#L17),
   [extract_bip32_derivation.c:144-155](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/extract_bip32_derivation.c#L144),
   [process_in_outs.c:58-67](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/process_in_outs.c#L58),
   [preprocess_inputs.c:83-115](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_inputs.c#L83)).
5. The host resumes correct responses, including the remaining key leaves and
   witness UTXO. The outer traversal succeeds. The witness-present flag has been
   set from its authentic key, so the ordinary Taproot signing branch runs.
   `sign_transaction_input` builds the signing path from the authenticated
   account prefix plus the fresh input's zeroed branch/index. The path becomes
   `m/86'/coin'/account'/0/0`, regardless of the originally approved input's actual
   nonzero index or change branch
   ([preprocess_inputs.c:72-82](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_inputs.c#L72),
   [sign_input.c:257-268,320-327,398-413](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c#L257)).
6. That fallback path passes `prl_address_path_valid`. The code derives and
   tweaks that private key, signs, and verifies against the public key generated
   from **that same fallback private key**, not against the committed prevout's
   output key. Thus self-verification does not reject the path mismatch
   ([sign_input.c:156-208](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c#L156)).

### Exact signature impact and limits

The original `signing_state.tx_hashes` is unchanged. DEFAULT key-path BIP341
hashing uses the frozen all-input prevouts, amounts, scripts and sequences, all
outputs, fixed version/locktime, zero spend type, and the current input index.
No new host-provided transaction digest is accepted after approval
([txhashes.c:588-623,663-666,692](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/txhashes.c#L588)).

The response can therefore contain:

- `CCMD_YIELD` and the original input index;
- a one-byte public-key-length field equal to 32, followed by the x-only BIP86-tweaked
  public key for the authenticated account's `/0/0` child;
- a 64-byte BIP340 signature over the **original approved transaction's** digest,
  with no appended sighash byte.

See [sign_input.c:58-81,216-229](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c#L58).
For an original input at `/0/7` or `/1/7`, this normally does not verify against
that input's actual output key and cannot spend it. For an original `/0/0`
input, it can be the correct transaction signature despite the rejected
derivation proof. Another valid transaction cannot simply reuse it: the digest
still commits all transaction inputs/amounts/scripts/outputs and input index,
subject to the usual cryptographic assumptions. No key extraction or useful
arbitrary-message signing oracle is established.

This is a concrete failure to abort after rejected post-approval data, and can
produce a wrong-key/invalid transaction signature or misleading success. A
host/client that checks returned public keys should reject the wrong-key result.

### Related empty-signing success

The same phase also treats an inability to re-authenticate the sole key
expression as "nothing to process": `select_keyexprs_to_process` skips an entry
when `fill_keyexpr_info_if_internal` fails, and `sign_transaction` returns `true`
when no entries remain ([sign_input.c:538-560,667-670](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c#L538)).
The caller can then show success and return `SW_OK` with no yielded signatures.
The accepted PRL profile requires exactly one signable expression before review,
so this should be an error in this profile, not normal no-op success. This has no
demonstrated fund-loss impact and is recorded as related error propagation,
rather than a separate higher-severity finding.

### Source correction and remaining defense in depth

- Applied: immediately after the post-approval map re-read, reject when `res < 0`,
  `input.in_out.unexpected_pubkey_error`, or
  `!input.in_out.key_expression_found`. Return `false` with an error status
  before constructing any signing path or invoking a private-key operation.
- Applied: require exactly one derivation, the internal-key-present flag, and
  the witness-UTXO-present flag in that same guard.
- Applied: propagate failure when the required sole key expression cannot be
  re-authenticated; do not report a successful empty signing operation.
- Additional defense in depth, not applied: compare the final derived output
  public key with the committed prevout key before yielding. This is not needed
  to close the demonstrated ordinary-host error path: a successful callback is
  authenticated to the same fixed Merkle roots used during initial validation.
  It would provide another check against crypto failures or future refactors.

The source correction does not replace native negative tests or emulator/physical
qualification. Those require separate authorization to reopen execution. The
exact limited source diff and rationale are in `source-only-patch.md`.

### Required qualification when the native lane is reopened

1. A valid transaction spending `/0/7`, then corrupt only the derivation **value**
   proof in the final signing re-read. Require an error before any signature
   yield or private-key signing invocation. Repeat for `/1/7` and `/0/0`.
2. Repeat with a malformed value preimage, a correct-length wrong-hash preimage,
   truncated continuation, and failed public-key derivation. Keep the outer key
   proofs valid so the callback-error boundary is actually exercised.
3. Corrupt the sole account-key proof during `select_keyexprs_to_process` and
   require an error rather than signed-status/`SW_OK` with no signatures.
4. Repeat for the first and later input in a multi-input transaction. Already
   yielded signatures remain consequential; a later error cannot revoke them.
5. Positive coverage: receive/change branches and highest allowed account/index;
   all returned public keys equal committed prevout keys; exact DEFAULT digest
   and returned signature independently verify; rejection yields no signature.

### Provenance of the defect

The ignored callback-latch structure and empty-selection success are also
present in the pinned upstream `sign_input.c` (upstream lines 645-705 and
corresponding selector). That does not remove the defect from the reachable PRL
path. The fork additionally checks device derivation/public-key equality in
`process_in_outs.c:79-84`, creating more checked failure cases whose latch must
be respected. Comparison was against the pinned Git object, not the upstream
checkout's current HEAD.

## DAB-02: Taproot script construction discarded a failed public-key tweak

**Severity: Low, fault-conditional hardening. Source-corrected, uncompiled and
unexecuted. No practical ordinary-host trigger or fund-loss exploit established.**

The original `get_wallet_script` Taproot branch calls `crypto_tr_tweak_pubkey`
and returns `34` without inspecting its return value
([policy.c:1141-1169](../../apps/ledger-bitcoin-prl/src/handler/lib/policy.c#L1141)).
The callee can return `-1` for a tweak outside the curve order, a failed lift,
or SDK point/math errors, before its final copy writes the 32-byte output key
([crypto.c:566-607](../../apps/ledger-bitcoin-prl/src/crypto.c#L566)).
SDK comparison and point-add wrappers propagate their underlying failures
([cx_math.c:24-36](../../apps/ledger/vendor/ledger-secure-sdk/lib_cxng/src/cx_math.c#L24),
[cx_ecfp.c:270-294](../../apps/ledger/vendor/ledger-secure-sdk/lib_cxng/src/cx_ecfp.c#L270)).

For ordinary BIP86 there is no taptree hash written into the output workspace
first. A failed tweak can therefore leave the script's key bytes indeterminate
while the caller receives a successful length. The receiving-address handler
would encode those bytes; the ownership/change comparator would compare them
as if a wallet script had been constructed
([get_wallet_address.c:166-208](../../apps/ledger-bitcoin-prl/src/handler/get_wallet_address.c#L166),
[compare_wallet_script_at_path.c:42-63](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/compare_wallet_script_at_path.c#L42)).

Authenticated xpubs, checked BIP32 derivation, and fixed BIP86 policy prevent a
host from simply injecting an arbitrary invalid point into this path. A
cryptographically exceptional tweak or SDK/platform failure is needed; this
review does not demonstrate how a normal hostile host causes one. Indeterminate
bytes are not a demonstrated attacker-chosen change destination. The most direct
conditional concern is returning/displaying a bad receiving address instead of
aborting, or incorrect ownership classification after a failed primitive.

Applied correction: if `crypto_tr_tweak_pubkey(...) < 0`, return `-1` before
reporting a script length. Both reachable receiving-address and signing
ownership callers already check that negative result. No new stored state or
broader crypto refactor was introduced. Fault-injection qualification, when
authorized, must force each callee failure and verify no address response,
ownership success, approval progression, or signature yield follows it. A
successful baseline must continue deriving the exact same BIP86 addresses.

The discarded return is also present verbatim in pinned upstream
`policy.c:1164-1167`; this is inherited, not evidence of vendor qualification of
the fork or SDK retarget.

## Further crypto return-value review

### Returns which are checked in the reachable signing path

- Device public-key derivation and compression propagate SDK failure through
  `crypto_get_compressed_pubkey_at_path` and `get_extended_pubkey_at_path`
  ([crypto.c:244-265,317-354](../../apps/ledger-bitcoin-prl/src/crypto.c#L244)).
  Policy verification and initial derivation verification check those results.
- Public child derivation checks hardened-index/depth limits, the scalar range,
  point multiplication, point parsing, and addition; its two callers in the
  wallet path propagate a negative result
  ([crypto.c:90-160](../../apps/ledger-bitcoin-prl/src/crypto.c#L90),
  [policy.c:469-475,510-525](../../apps/ledger-bitcoin-prl/src/handler/lib/policy.c#L469)).
- The secret-side BIP86 tweak checks point/math results, parity normalization,
  and tweak range. The signer rejects failed derivation, tweak failure, zero
  tweaked scalar, public-key generation failure, RNG failure, signing failure,
  wrong signature length, and failed signature self-verification. It clears the
  private-key structure before yielding or reporting an ordinary error
  ([crypto.c:611-653](../../apps/ledger-bitcoin-prl/src/crypto.c#L611),
  [sign_input.c:145-232](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c#L145)).
- SDK derivation helpers clear raw/private buffers and return errors. The
  inspected Schnorr routine uses `CX_CHECK` around bignum/point/hash operations,
  rejects a zero nonce, and returns its error. Its use of the signature buffer
  for nonce-related intermediate data makes the app's error/success wipes
  consequential
  ([crypto_helpers.c:25-101](../../apps/ledger/vendor/ledger-secure-sdk/lib_standard_app/crypto_helpers.c#L25),
  [cx_ecschnorr.c:79-158,339-398](../../apps/ledger/vendor/ledger-secure-sdk/lib_cxng/src/cx_ecschnorr.c#L79)).

### Unchecked hash returns remain a fault-hardening limit

`crypto_hash_update`/`crypto_hash_digest` return SDK error statuses, but retained
transaction hashing, Merkle hashing/preimage code, and `crypto_tr_tagged_hash`
often ignore them. Examples include `txhashes.c:190-213,269-278,591-692`,
`common/merkle.c:32-50`, and `crypto.c:522-540`. Self-verifying a signature over
the computed digest does not independently prove that each prior hash step
succeeded.

This is not reported as another ordinary-host exploit. The inspected SDK
software SHA256 initializes a valid local context; its ordinary update error
checks concern null pointers/inconsistent buffer state, and finalization returns
success for a valid context. The PRL profile bounds counts, buffers and streamed
bytes well below counter limits
([crypto.h:90-108](../../apps/ledger-bitcoin-prl/src/crypto.h#L90),
[cx_hash.c:138-160](../../apps/ledger/vendor/ledger-secure-sdk/lib_cxng/src/cx_hash.c#L138),
[cx_sha256.c:111-117,194-280](../../apps/ledger/vendor/ledger-secure-sdk/lib_cxng/src/cx_sha256.c#L111)).
No host-controllable valid-profile parameter satisfying those error conditions
was found. The one-shot iovec wrapper returns errors and clears its context,
but does not guarantee clearing a digest on failure
([cx_hash_iovec.c:25-43,95-103](../../apps/ledger/vendor/ledger-secure-sdk/src/cx_hash_iovec.c#L25)).

Explicit checked status propagation would strengthen the fault model, but is a
larger change than the authorized narrow guards and was not applied. Compiler,
hardware-fault and exceptional-control-flow behavior remain unqualified.

## Other re-read failure paths traced

- Every map re-read remains bound to the original input/output root, tree size
  and leaf index. A different valid map cannot be substituted without breaking
  the Merkle commitment. By-key success proves the requested key's leaf index
  and fetches the value at that same index. Strict key ordering rejects
  duplicates ([get_merkleized_map.c:28-57](../../apps/ledger-bitcoin-prl/src/handler/lib/get_merkleized_map.c#L28),
  [get_merkleized_map_value.c:20-49](../../apps/ledger-bitcoin-prl/src/handler/lib/get_merkleized_map_value.c#L20)).
- The host's "absent" response is unproved. It cannot hide required globals,
  network binding or an optional global that the key walk saw: those reads must
  succeed. Input witness/sighash presence is likewise discovered through the
  authentic key walk, so a missing required witness or explicit sighash value
  fails in the final signing path. DEFAULT remains the only accepted explicit
  sighash; omitted sighash also produces DEFAULT.
- The hashing helper's sequence fallback accepts unproved absence, but the
  initial PRL profile requires every sequence to be exactly `0xffffffff`.
  Its fallback is that same value, so this does not change the approved digest
  in this profile ([preprocess_inputs.c:294-303](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_inputs.c#L294),
  [txhashes.c:91-104](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/txhashes.c#L91)).
- Amount hashing first tries the witness UTXO and falls back to non-witness data
  on any witness-read failure. This is a broad error fallback, but when both
  forms exist, preprocessing has already verified their amount/script equality
  against the fixed map commitment and verified the previous transaction's
  txid. When no non-witness UTXO exists, that fallback fails. No amount/digest
  substitution was established from it
  ([amount_from_psbt.c:143-162](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/amount_from_psbt.c#L143),
  [preprocess_inputs.c:199-279](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_inputs.c#L199)).
- After approval, malformed witness UTXO or explicit sighash reads return errors
  before signing. The derivation callback latch and empty-selector cases were
  the two exceptional fall-throughs found in this pass, now source-corrected.

## Concrete display-to-signature invariants verified

### Account, policy and ownership

The wallet policy preimage is hash-authenticated, its descriptor length and
full parse are checked, and the signing policy serialization is fully consumed.
Only a nameless version-2 standard `tr` policy with one normal device account
key, no tree, and branches 0/1 is accepted. The entire serialized account xpub
is compared to a device-derived xpub, not merely its four-byte fingerprint
([init_global_state.c:147-207](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/init_global_state.c#L147),
[policy.c:326-365,1392-1499](../../apps/ledger-bitcoin-prl/src/handler/lib/policy.c#L326),
[wallet.c:1832-1834](../../apps/ledger-bitcoin-prl/src/common/wallet.c#L1832)).

Every input is positive owned P2TR with a unique outpoint, exactly one
zero-tapleaf-hash BIP86 derivation, matching internal key and final sequence.
The reconstructed BIP86 script is byte-compared to the prevout script. External
inputs, script paths, partial sighashes and MuSig are excluded. Proof of chain
existence, finality, spendability or absence of competing spends is not provided
by this device flow.

### Recipient and change

There is exactly one positive external P2TR/P2MR output and at most one positive
verified P2TR branch-1 change output. False/incomplete change declarations fail
rather than silently become hidden change. P2TR recipients are curve-range/lift
checked; P2MR is only a 32-byte payment destination, not proof that the recipient
can spend it. A self-owned output without change metadata remains visible as the
recipient, so omission does not hide it
([preprocess_outputs.c:152-260](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_outputs.c#L152)).

The one recipient always fits the output cache and simplified review on every
supported target (capacities 8/16). Its address comes from the **cached script**,
using compiled HRP, witness version and the entire witness program; Bech32m is
used for versions 1/2. There is no separate host-provided address label to swap
into the display. Verified change address/index/amount are stored from that
same preprocessing pass and copied into persistent UI buffers
([transaction_display.c:320-375](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/transaction_display.c#L320),
[script.c:86-107](../../apps/ledger-bitcoin-prl/src/common/script.c#L86),
[segwit_addr.c:183-194](../../apps/ledger-bitcoin-prl/src/common/segwit_addr.c#L183),
[display.c:294-304,357-407](../../apps/ledger-bitcoin-prl/src/ui/display.c#L294)).

### Monetary and MAX behavior

Values and aggregate sums are bounded by `2100000000000000000` grains. Checked
addition tests `value <= MAX - total` before addition; each total is below
`INT64_MAX`. Initial validation requires outputs no greater than inputs, so
unsigned fee subtraction cannot underflow. The reachable profile cannot enable
the inherited open-sighash exception to that check. The sum of recipient,
change and fee equals the committed input sum. Values are formatted with integer
division/remainder at eight decimal places; no floating-point rounding occurs
([prl.h:11-13,52-61](../../apps/ledger-bitcoin-prl/src/prl.h#L11),
[preprocess_outputs.c:246-260](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/preprocess_outputs.c#L246),
[transaction_display.c:214-217](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/transaction_display.c#L214),
[display_utils.c:17-47](../../apps/ledger-bitcoin-prl/src/ui/display_utils.c#L17)).

The C device does not receive a distinct "MAX" intent or compute fee rates. A
host's MAX transfer is simply a one-recipient, no-change transaction here; the
device displays and commits its actual amount and fee. This review does not
establish that host UTXO selection used every coin or that its fee estimate is
economically appropriate.

One retained UX caveat: `prl_high_fee` compares fee with 10% of **total inputs**
and disables that warning for inputs <=100000 grains. Large-screen text instead
says 10% of the amount being sent. For example, 100 PRL input, 1 PRL recipient,
98.5 PRL change and 0.5 PRL fee has a fee 50% of the recipient payment but no
high-fee warning. The exact fee is still displayed and signed. This is a
warning-policy/wording mismatch, not an arithmetic-overflow or hidden-fee proof.
The arithmetic rewrite correctly avoids upstream's `10 * fee` overflow; the
denominator and low-value exemption are inherited. No UI/threshold change was
made ([prl.h:58-61](../../apps/ledger-bitcoin-prl/src/prl.h#L58),
[transaction_display.c:294-295](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/transaction_display.c#L294),
[display_nbgl.c:38-46](../../apps/ledger-bitcoin-prl/src/ui/display_nbgl.c#L38)).

### Exact BIP341 binding

Before review, `compute_tx_hashes` re-fetches committed maps and computes single
SHA256 digests of all prevouts, sequences, outputs, amounts and scriptPubKeys.
Amounts use LE64; outpoint indices/sequences use LE32; output and prevout
scripts use CompactSize length prefixes. `compute_sighash_segwitv1` adds the
TapSighash tagged-hash prefix, epoch 0, DEFAULT type 0, version 1, locktime 0,
those five hashes, spend type 0 and LE32 input index. Annex and tapscript branches
are unreachable in the accepted profile
([txhashes.c:109-281,575-694](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/txhashes.c#L109)).

Thus invented witness amounts can fool an offline display about chain reality,
but cannot independently produce a valid signature against different real
amounts under the same consensus rules. Network/genesis metadata is validated
before signing and the displayed network is compiled in; that metadata is not
a consensus domain in BIP341 and does not supply cryptographic replay protection
between compatible chains.

### UI approval and state lifetime

The persistent UI transaction state and tag/value pool are reset, strings are
copied with a halt-on-truncation helper, and all recipient/change/fee rows are
prepared before `nbgl_useCaseReview(TYPE_TRANSACTION, ...)`. No inherited
streaming or "amounts unavailable" route is reachable with one external output,
all internal inputs, and DEFAULT-only sighash
([display.c:43-46,357-417](../../apps/ledger-bitcoin-prl/src/ui/display.c#L43),
[display_nbgl.c:101-109,160-177,316-407](../../apps/ledger-bitcoin-prl/src/ui/display_nbgl.c#L101)).

The app waits for a fresh `g_ux_flow_ended` event. Approval/denial callbacks set
the result; stale response alone does not end the new loop. The inspected SDK
review implementations map approval to a terminal Nano accept step or a
touch-device final long-press page. The app does not set `SKIPPABLE_OPERATION`
([display.c:53-82](../../apps/ledger-bitcoin-prl/src/ui/display.c#L53),
[display_nbgl.c:238-240,303-308](../../apps/ledger-bitcoin-prl/src/ui/display_nbgl.c#L238),
[nbgl_use_case_nanos.c:1202,1241-1264,2008-2033](../../apps/ledger/vendor/ledger-secure-sdk/lib_nbgl/src/nbgl_use_case_nanos.c#L1202),
[nbgl_use_case.c:2936-2999](../../apps/ledger/vendor/ledger-secure-sdk/lib_nbgl/src/nbgl_use_case.c#L2936)).

During review, the custom heartbeat rejects APDU packets, malformed events,
reported USB power loss, PIN lock and expiry by exiting the app; it rechecks
PIN/deadlines after dispatching the event that could approve. Continuations do
not reset the whole-command tick budget. After review, SDK receive logic rejects
incoming APDUs while the PIN is locked, but this is not the same app-level
abort-on-review mechanism. Physical locking/unlocking and disconnect races,
queued events, rendering/pagination of full strings, and clock/event behavior
still need device-specific qualification
([prl_review_io.c:19-79](../../apps/ledger-bitcoin-prl/src/boilerplate/prl_review_io.c#L19),
[dispatcher.c:41-46,76-129](../../apps/ledger-bitcoin-prl/src/boilerplate/dispatcher.c#L41),
[os_io_legacy.c:397-424](../../apps/ledger/vendor/ledger-secure-sdk/io_legacy/src/os_io_legacy.c#L397)).

Browser cancellation is not proof of device cancellation; approval cannot revoke
already yielded signatures. Source text also cannot establish that a particular
binary/device actually implements this flow. The source-only corrections leave
all earlier native/physical qualification requirements open.
