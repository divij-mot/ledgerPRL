# Host transaction-binding review

## Result

No new exploitable transaction-binding defect was reproduced in the reviewed host paths. The initial 24 targeted tests passed on three consecutive runs. An additional source-review follow-up added 11 targeted device-error defense cases; the expanded 35-case suite passed on three consecutive runs. The 148 selected existing tests passed, and the dedicated strict TypeScript check passed. No production source was changed by this review.

This is a bounded host-source and mocked-protocol review, not an audit, native-app qualification, physical-device test, or evidence of live-network spendability. Only the published BIP32 vector-one test seed is used. Never fund the test addresses.

Reviewed checkout: `ledger-bitcoin-prl`, HEAD `bef09f0550eda47956e5862a984a8d584a86fd30`, with pre-existing and concurrent worktree changes. `source-hashes.json`, `final-source-hashes.json` and `device-defense-source-hashes.json` bind the reviewed host source bytes; their contents match. A branch/commit identifier alone does not describe this dirty checkout.

## New checks and their purpose

1. **Independent exact-byte oracle, all five networks.** A separate implementation using Node SHA-256 and hand-written little-endian/CompactSize encodings constructs the BIP341 digest and witness transaction. It does not call the SDK's digest, serialization, hash, or Merkle helpers. For 16 inputs, aggregate `2100000000000000000` grains, P2MR recipient, and verified change, it agrees with the production digest, final raw bytes, txid, wtxid and vsize. Signature order is reversed before finalization. Test signatures use the independent digest and the published public test seed.
2. **Cross-input and output binding above 2^53.** Ten transaction mutations, each checked against all three original signatures, cover one-grain amount changes, another input's amount/outpoint/vout/key, recipient and change scripts/amounts, and input/output permutation. All 30 original-signature checks fail after alteration, and finalization refuses each altered transaction.
3. **Full mocked Merkle PSBT retrieval.** Instead of returning signatures immediately, the mock reads every committed global/input/output map through the actual client-command interpreter. It independently folds each domain-separated Merkle proof and hashes reconstructed preimages, including multi-APDU raw previous transactions. The three-input non-power-of-two tree, values, input order, recipient and change exactly match the original payment. Mutating caller-owned bundle and previous-transaction buffers after invocation cannot alter the served transaction. Out-of-order signatures are retained before a simulated final ACK loss.
4. **Hostile continuation timing.** Duplicate yields, unknown roots, noncanonical proof counts, empty GET_MORE_ELEMENTS, truncated/overlong yields and empty interrupts are injected after either a partial or complete signature set. The session becomes terminal and sends no retry. Partial sets never reach durable storage; complete, independently verified bytes are saved once and returned with the acknowledgement warning.
5. **Undrained continuation queue.** A hostile signature yield interrupts a long previous-transaction preimage before GET_MORE_ELEMENTS drains. The interpreter rejects the interleaving. If that yield completed a valid signature set, exact bytes remain recoverable; otherwise there is no false completion.
6. **Imported PSBT and recovery handoff.** Mutation of imported PSBT bytes and the caller's account buffers after invocation cannot change the approved payment. A simulated storage failure raises `VerifiedSigningResultError` carrying the exact complete transaction, from which the companion's standard emergency-backup helper produces an importable backup preserving raw bytes, txid and reserved outpoints.

These add independence and cross-layer state combinations beyond the existing isolated amount/parser/Merkle/yield tests. Cryptographic curve operations and BIP32 derivation still use the project's pinned libraries; this is an independent byte/digest oracle, not an independent elliptic-curve implementation.

## Device-error defense follow-up

The parent supplied two source-review findings as the threat model: a postapproval derivation-error path potentially returns account `/0/0` key/signature while the approved input belongs to `/0/7` or `/1/7`; an account-key re-fetch failure potentially returns final `SW_OK` without any signatures. This review does not independently execute or reproduce those native failure paths. It models only their returned host-protocol bytes, using public test keys and no network or device.

Eleven added tests pass:

- Eight wrong-path cases combine approved `/0/7` or `/1/7`, no prior signature or one earlier valid signature, and either the actual fallback `/0/0` public key or a falsely relabeled approved public key. The fallback signature is independently verified as a genuine signature under `/0/0` over the **unchanged approved transaction digest**; it is not an all-zero/malformed signature or a signature over a substituted payment. It fails under the approved input key.
- The adapter rejects both the wrong returned key and the relabeled wrong signature with `Device signature failed independent verification`. It does not acknowledge the faulty yield, never calls `onVerifiedSigned`, closes the transport, leaves the session failed, and refuses a later command without sending another APDU.
- Three completion cases return literal final status `0x9000` with zero signatures, only signature 0, or only signature 1 for a two-input `/0/7` + `/1/7` payment. All reject with `Missing native signature`, close the transport, and never call durable completion. An earlier valid signature therefore creates no false complete-transaction result, including out-of-order partial input 1.
- Every rejection is an ordinary incomplete-signing failure, not `VerifiedSigningResultError`, and carries no `signedTransaction`. A caller must retain its pre-signing uncertainty/reservations; it cannot infer that no device-side signature exists or automatically retry. The already-selected companion lifecycle tests exercise that incomplete-signing reservation behavior.

**Security boundary:** these tests establish a defense in this adapter against the modeled error outputs. They do not fix the native derivation-error behavior, establish native reachability, show that every other host is safe, qualify the device, or justify ignoring an on-device signing invariant violation. No theft or payment substitution is demonstrated by these host tests.

## Source findings

- `packages/sdk/src/transaction.ts:30` hashes all input outpoints, amounts, scripts, sequences and outputs under DEFAULT key-path BIP341. `:114` verifies every signature before serialization. `:161` independently parses raw transactions and preserves bigint output values.
- `packages/sdk/src/bundle.ts:54` bounds the profile and sums, rejects duplicate input outpoints, and binds owned input/change scripts to their account paths when an account is supplied (`:109`, `:136`).
- `packages/bitcoin-prl-adapter/src/psbt.ts:98` checks optional raw prevtx txid/vout/value/script. `:125` and `:252` apply the same narrow construction/import profile and exact origin/network metadata.
- `packages/bitcoin-prl-adapter/src/client.ts:529` checks each yielded input index, expected tweaked key and signature. `:543` retains the complete result and awaits a separate-copy durability callback before the final continuation. `:582` preserves complete bytes on later protocol failure; durability failures carry the typed signed result. Both `signBundle` and `signPsbt` snapshot caller-owned inputs before the first await.
- `packages/bitcoin-prl-adapter/src/upstream/clientCommands.ts:352` blocks interleaved commands while a continuation queue is pending. The adapter intentionally verifies/retains a complete valid signature set before this later protocol check, preserving already-spendable bytes rather than discarding them.
- `apps/cli/src/index.ts:215` syncs the reserved private output file from the durability callback, compares the final exact bytes (`:226`), and emits exact recovery bytes on storage failure (`:246`). The existing CLI tests exercise loopback mocked APDU HTTP only and verify save-before-ACK and lost/rejected-ACK behavior.
- `apps/companion/src/main.ts:1157` re-verifies callback bytes against the reserved bundle and atomically retains signed journal data or emergency backup. `:1238` passes this callback into the adapter. `:1553` binds the separate broadcast approval to account/payment/network/source/raw bytes and re-verifies the stored transaction. Existing actual-main.ts tests use mocked DOM/storage/source/device boundaries.

### Compatibility boundary, not a newly reproduced vulnerability

The adapter accepts the full non-hardened derivation range, including branch-1 index `0x7fffffff`. The wallet journal deliberately rejects that last change index because it cannot represent a subsequent change allocation (`packages/wallet/src/journal.ts:298`, `:332`). Existing recovery tests explicitly cover this fail-closed limit. The recovery-handoff test therefore uses an in-profile wallet path; the independent adapter tests still exercise maximum indices. A future integration must respect the wallet's narrower recovery profile before signing. The current companion reserves the payment before invoking the signer, so this mismatch did not expose a post-signing loss path in the reviewed integration.

## Evidence

- `transaction-binding.test.ts`: 35 new tests, including 11 device-error defense cases.
- `replay-1.log`, `replay-2.log`, `replay-3.log`: original 24/24 passed each; no skips.
- `device-error-defense.log`: the 11 targeted fault-output defenses passed; no skips.
- `defense-full-replay-1.log`, `defense-full-replay-2.log`, `defense-full-replay-3.log`: expanded 35/35 passed each; no skips.
- `existing-regressions.log`: 148/148 passed; no skips. This includes SDK, adapter, CLI, companion DMK transport mocks, emergency recovery, and actual-main.ts PSBT/signing-recovery wrappers. The wrappers additionally report 10 + 18 + 19 mocked lifecycle subcases; these are not counted again as top-level tests.
- `typecheck.log`: empty successful strict typecheck output.
- `targeted-tests.log`: earlier successful 22-case run before the two queue-interleaving cases were added.
- `source-hashes.json`, `final-source-hashes.json`, `device-defense-source-hashes.json`, `results.json`, `SHA256SUMS`: source and evidence bindings.

## Not executed or established

No native executable, emulator, firmware build/run, hardware signing, real account/secret access, live indexer request, network transaction, broadcast, deployment, or publication was performed. Local HTTP in the existing CLI tests is a public-fixture mock. UI tests selected here use mocked DOM/storage and do not establish browser rendering, actual IndexedDB crash durability, USB/HID behavior, trusted device display, chain inclusion, node relay policy, or finality. No external source or dependency was fetched for this review.
