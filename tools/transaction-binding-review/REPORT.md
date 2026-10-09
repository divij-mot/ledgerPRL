# Host transaction-binding review

## Result

No new exploitable transaction-binding defect was reproduced in the reviewed host paths. The 24 new targeted tests passed on three consecutive runs, the 148 selected existing tests passed, and the dedicated strict TypeScript check passed. No production source was changed by this review.

This is a bounded host-source and mocked-protocol review, not an audit, native-app qualification, physical-device test, or evidence of live-network spendability. Only the published BIP32 vector-one test seed is used. Never fund the test addresses.

Reviewed checkout: `ledger-bitcoin-prl`, HEAD `bef09f0550eda47956e5862a984a8d584a86fd30`, with pre-existing and concurrent worktree changes. `source-hashes.json` and `final-source-hashes.json` bind the reviewed source bytes; their contents match. A branch/commit identifier alone does not describe this dirty checkout.

## New checks and their purpose

1. **Independent exact-byte oracle, all five networks.** A separate implementation using Node SHA-256 and hand-written little-endian/CompactSize encodings constructs the BIP341 digest and witness transaction. It does not call the SDK's digest, serialization, hash, or Merkle helpers. For 16 inputs, aggregate `2100000000000000000` grains, P2MR recipient, and verified change, it agrees with the production digest, final raw bytes, txid, wtxid and vsize. Signature order is reversed before finalization. Test signatures use the independent digest and the published public test seed.
2. **Cross-input and output binding above 2^53.** Ten transaction mutations, each checked against all three original signatures, cover one-grain amount changes, another input's amount/outpoint/vout/key, recipient and change scripts/amounts, and input/output permutation. All 30 original-signature checks fail after alteration, and finalization refuses each altered transaction.
3. **Full mocked Merkle PSBT retrieval.** Instead of returning signatures immediately, the mock reads every committed global/input/output map through the actual client-command interpreter. It independently folds each domain-separated Merkle proof and hashes reconstructed preimages, including multi-APDU raw previous transactions. The three-input non-power-of-two tree, values, input order, recipient and change exactly match the original payment. Mutating caller-owned bundle and previous-transaction buffers after invocation cannot alter the served transaction. Out-of-order signatures are retained before a simulated final ACK loss.
4. **Hostile continuation timing.** Duplicate yields, unknown roots, noncanonical proof counts, empty GET_MORE_ELEMENTS, truncated/overlong yields and empty interrupts are injected after either a partial or complete signature set. The session becomes terminal and sends no retry. Partial sets never reach durable storage; complete, independently verified bytes are saved once and returned with the acknowledgement warning.
5. **Undrained continuation queue.** A hostile signature yield interrupts a long previous-transaction preimage before GET_MORE_ELEMENTS drains. The interpreter rejects the interleaving. If that yield completed a valid signature set, exact bytes remain recoverable; otherwise there is no false completion.
6. **Imported PSBT and recovery handoff.** Mutation of imported PSBT bytes and the caller's account buffers after invocation cannot change the approved payment. A simulated storage failure raises `VerifiedSigningResultError` carrying the exact complete transaction, from which the companion's standard emergency-backup helper produces an importable backup preserving raw bytes, txid and reserved outpoints.

These add independence and cross-layer state combinations beyond the existing isolated amount/parser/Merkle/yield tests. Cryptographic curve operations and BIP32 derivation still use the project's pinned libraries; this is an independent byte/digest oracle, not an independent elliptic-curve implementation.

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

- `transaction-binding.test.ts`: 24 new tests.
- `replay-1.log`, `replay-2.log`, `replay-3.log`: 24/24 passed each; no skips.
- `existing-regressions.log`: 148/148 passed; no skips. This includes SDK, adapter, CLI, companion DMK transport mocks, emergency recovery, and actual-main.ts PSBT/signing-recovery wrappers. The wrappers additionally report 10 + 18 + 19 mocked lifecycle subcases; these are not counted again as top-level tests.
- `typecheck.log`: empty successful strict typecheck output.
- `targeted-tests.log`: earlier successful 22-case run before the two queue-interleaving cases were added.
- `source-hashes.json`, `final-source-hashes.json`, `results.json`, `SHA256SUMS`: source and evidence bindings.

## Not executed or established

No native executable, emulator, firmware build/run, hardware signing, real account/secret access, live indexer request, network transaction, broadcast, deployment, or publication was performed. Local HTTP in the existing CLI tests is a public-fixture mock. UI tests selected here use mocked DOM/storage and do not establish browser rendering, actual IndexedDB crash durability, USB/HID behavior, trusted device display, chain inclusion, node relay policy, or finality. No external source or dependency was fetched for this review.
