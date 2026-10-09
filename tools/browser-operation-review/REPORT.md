# Browser operation authority review

Scope: actual companion `main.ts`, `WatchStorage`, wallet reservation/recovery helpers, and the installed PSBT adapter. Pure host execution with public transaction/signature fixtures and injected DOM, file, storage, device-endpoint and HTTP boundaries. No browser launch/profile, external indexer, native firmware/emulator, physical device, upload, deployment, private key or real transaction was used.

## Confirmed gaps corrected

1. **Broadcast context across transaction completion.** Previously the account/payment/network/source check ran inside `store.mutate`'s synchronous updater, but not after the asynchronous transaction-completion wait. A context change in that interval still reached the submission call. A shared check now runs after the journal read, inside the update, after its completion and at the last synchronous point before sending. It includes public disclosure consent. Already persisted `broadcast-unknown` state and all locks remain when the final check rejects. Post-submission acceptance is still recorded against the captured original payment, so cancellation cannot erase evidence of an actual accepted submission.
2. **Public disclosure revocation.** Revoking consent while broadcast awaited the updater previously sent raw signed bytes to the same-origin proxy with `consent:false`. The production proxy independently rejects absent consent, so this review does not claim it would relay to the indexer. The client now rejects before any payload transmission in that case.
3. **Cancellation of public/snapshot imports and preparation.** The displayed Cancel action previously failed to prevent account replacement, recovery-range writes or creation of an unsigned draft while awaiting file reads or storage. The affected operations now capture their account/view and requested preparation fields, check cancellation before the update and before applying the view, and explicitly retain already-committed recovery paths/draft reservations if cancellation wins later. Demo/cache snapshot loading passes the same cancellation scope. No uncertain/signed record is unlocked.
4. **Verified signatures before persistence.** Previously the emergency copy and unload warning appeared only after storage failure or the adapter's durability timeout. During a pending signed write the verified bytes existed, but navigation did not request an unsaved-data warning. A verified recovery copy is now staged synchronously before the first storage await. A neutral “Saving signed payment” status is used while pending; actual failure/timeout changes it to the recovery warning. The copy remains downloadable, blocks replacement signing, survives Cancel/Close account, and clears only after independently verified durable read-back. A completed write whose read-back fails/mismatches rejects the persistence callback, shows the recovery warning, and cannot emit a final ACK or successful-save message; verification and failure marking stay bound to the exact staged recovery object. This requests the existing browser unload safeguard; it does not guarantee that a browser will show a dialog, or protect against process/power loss.

These are host correctness/defense-in-depth fixes, not demonstrated private-key extraction or changed-recipient exploits. Broadcast tests mutate context using synthetic queued-event/state hooks because normal controls are disabled while busy. Submitted bytes in the pre-fix probes remained the originally approved canonical payment. No evidence of a wrong recipient, amount, signature, account key or transaction replacement was found.

## Targeted coverage

The standard companion test wrapper runs 29 cases: 28 pass and one optional model-only probe is skipped by default. Coverage includes:

- Four broadcast context dimensions before update and after update
- Consent revocation before transmission, and Cancel after the `broadcast-unknown` update
- Cancel while reading public/snapshot files or waiting for their storage update
- Cancellation after updater/commit: persisted ranges and draft input locks survive, with no stale account/review opening
- Snapshotting preparation fields against later input events
- Real PSBT adapter plus frozen public endpoint: recovery copy/unload guard before persistence completion
- Storage-failure account closure retaining independently validated recovery and locks
- Actual `WatchStorage` against an explicit FIFO event model: competing same-input reservations, monotonic range updates, and rollback of a cancelled partial update

Existing companion suites retain independent failed/hung signed-write, lost final ACK, corrupted restore, backup worker cancellation, imported reservations, duplicate-click and stale-journal coverage. The review did not weaken those assertions.

Run the focused cases from the repository root:

```sh
node --import tsx --test tools/browser-operation-review/*.test.ts
node --import tsx --test apps/companion/test/browser-operation-boundaries.test.ts
```

## Model-only observations, not qualified browser defects

- **Superseded disconnect callback:** forcibly calling a saved old callback clears the current client. Real `DmkPearlTransport.close()` removes its HID listener. The probe bypasses that lifecycle and does not establish that an old listener can actually fire after reconnect. It is skipped by default; enable `REVIEW_MODEL_PROBES=1` for this observational check. No speculative transport change was made.
- **Unordered late persistence:** an earlier permissive mock allowed a late old write failure after an independent restore and newer signing failure. Real same-store IndexedDB serialization may prohibit that ordering. It is not counted as a confirmed defect. Immediate recovery staging removes the old late-catch replacement even in that stronger model; its test remains labeled model-only.
- **Two-tab storage:** the FIFO/rollback scheduler is an explicit model. Passing it does not verify IndexedDB's browser implementation, event timing, quota/eviction, crash persistence or power-loss behavior. The preexisting hung-storage mock also permits independent reads while a modeled write is outstanding; it is not a proof that a real blocked readwrite transaction permits those reads.

## Validation evidence

Final run: all workspace typechecks passed; all 421 workspace tests passed
(companion: 135, including the focused wrapper); the production build passed;
the tracked-file secret-pattern scan passed for 1,595 files. The focused suite
passed 28 cases with one optional unqualified callback probe skipped. Explicitly
enabling that probe runs all 29 cases; its observational success is not a browser
security qualification.

The generated website bundle is `apps/companion/dist/assets/index-CpBl0wyO.js`.
It was built locally and was not uploaded or deployed.

- `targeted-tests.log`: latest focused suite
- `targeted-and-independent-tests.log`: 52 combined cases, 51 pass and one optional probe skipped; includes the independent verifier’s 23 cases
- `affected-tests.log` / `wrapper-test.log`: directly affected existing suites and wrapper check
- `full-typecheck.log`, `full-host-tests.log`, `production-build.log`: complete workspace commands
- `source-and-build-hashes.json`: reviewed source/tests and generated companion build hashes

The initial nested-test wrapper inherited Node's test-runner context and skipped its child test files. Its child environment now removes only `NODE_TEST_CONTEXT`; the wrapper was rerun before final qualification. This was test plumbing, not an application failure.
