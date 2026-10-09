# Independent browser async-fix review

## Result

No remaining concrete defect found in the scoped host changes after one independently reproduced read-back status bug was corrected by the implementation owner. Review baseline: `03112c09890fb08c48a83e743d842fdbd791c29c`. Final reviewed `main.ts` SHA-256: `a1bfd6960626b1d397ffa4db5366da7633af6a47f656392319da650823bf12b7`.

This reviewer made no production edits. The independent probes use the actual bundled UI, installed PSBT adapter, frozen public endpoint/signature fixtures, and mocked DOM/storage/HTTP boundaries. No browser/profile, external network, upload, native executable/emulator, physical device, secret, real transaction, or deployment was used.

## Finding found and fixed

A successfully acknowledged signed write followed by a failed read-back left `emergencySignedRecovery.pending === true` after signing finished. The UI indefinitely said “Saving signed payment” although no storage work remained pending. The recovery bytes and input locks survived; the issue was misleading completion/recovery state, not demonstrated data loss.

- Reproduced on initial source SHA-256 `5b20820e8246f9526c487ac42520e5286e9ae6b08268703a6157eeed146cd1a7` with the actual adapter and normal write-then-read ordering.
- Initial independent runs: 9/10, then 22/23 passed; the read-back-failure assertion alone failed. See `independent-boundaries-initial.log` and `independent-boundaries-expanded.log`.
- The fix makes read-back verification return success/failure and rejects the signing-persistence callback on unconfirmed verification. It retains the verified backup, shows the recovery warning, and does not claim successful saving. It also passes the callback's captured recovery object into verification and uses object identity for failure marking and clearing (`main.ts:184–221, 1237–1329`).
- The implementation owner added this case to the ordinary companion test wrapper as regression E3.

## Reviewed boundaries

- Broadcast approval remains frozen to account, payment, network, source, raw bytes, and transaction ID. Rechecks run after journal read, inside mutation, after commit, and synchronously before the network call (`main.ts:1663–1747`). A changed context or revoked disclosure consent sends no signed payload. Already committed `broadcast-unknown` and reservations remain retained.
- Public/snapshot imports capture account ownership and cancellation across file/cache reads, queued updates, commit, and transport closure. A late cancellation does not open a stale account or roll back committed recovery ranges (`main.ts:553–610, 1028–1070`). New public imports clear former source consent/device state.
- Draft preparation captures the requested values and selection before storage awaits. Changed account/network/source or Cancel prevents stale review opening; a committed draft and its reservations remain available (`main.ts:920–962`).
- Complete signatures are independently checked by `signedRecoveryBackup` before recovery staging. The downloadable recovery object exists before the first storage await, so the existing `beforeunload` handler requests a warning during a stalled write (`main.ts:1238–1260, 1795–1800`). Partial/uncertain signatures do not fabricate a complete recovery transaction.
- Read-back clearing requires matching owner storage key, payment ID, canonical bundle, creation time, ordered outpoints, transaction ID, eligible signed state, and independently verified saved transaction bytes. The global copy must still be the same captured recovery object. Missing/partial/mismatched/corrupt rows preserve it. As intentionally supported by the existing concurrency logic, independently valid alternate witnesses for the identical canonical transaction may be retained; byte identity to the other tab's original witness is not required.
- No new wrong-account recovery clearing, stale callback replacement, reservation release, or signed-data-loss path was found in these changes. Real browser reachability of injected event hooks is not established by these tests.

## Verification

- `node --import tsx --test tools/browser-race-fix-review/independent-boundaries.test.ts`: 23/23 pass on the final reviewed source; see `independent-boundaries-final.log`.
- `node --import tsx --test apps/companion/test/browser-operation-boundaries.test.ts`: passes, running 29 focused cases with 28 passes and one optional model-only skip; see `wrapper-final.log`.
- `git diff --check -- apps/companion/src/main.ts`: passes.
- Exact source/test hashes are in `source-hashes.json`; `reviewed-main.diff` records the reviewed change against the requested baseline. Full-workspace checks are maintained by the implementation owner under `tools/browser-operation-review/` and were not rerun in full by this reviewer.

## Limits

No real IndexedDB event timing, power-loss durability, browser unload dialog behavior, physical transport timing, or deployment acceptance is established here. The permissive unordered late-write and superseded-disconnect probes remain model-only observations, not qualified real-browser defects. The synthetic FIFO storage model is conditional evidence for host invariants, not validation of a browser's IndexedDB implementation.
