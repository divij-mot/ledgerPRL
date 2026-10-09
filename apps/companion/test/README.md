# Companion boundary tests

Run from the repository root:

```sh
npm run test --workspace @pearl-ledger/companion
node --import tsx --test apps/companion/test/disconnect-regression.test.ts
```

The disconnect regression is a Node-only, isolated test process. It uses the real
installed Ledger DMK `DeviceConnectionStateMachine`, actual Pearl DMK adapter,
actual host SDK and actual `main.ts` payment flow, with the repository's frozen,
public deterministic signature fixture. It bundles browser-oriented modules for
Node and uses DMK's supported CommonJS export because the pinned ESM barrel is
not directly loadable by Node. Production imports are unchanged.

## Explicit mock boundaries

The APDU endpoint sender, physical HID events, DOM, browser-storage scheduler and
network are mocks. No private seed, physical Ledger, real browser profile,
external indexer, live node or actual broadcast is accessed. The fake backend
verifies exact signed bytes through the real `verifyBroadcastPayload` function.
The fixture's addresses and signatures are public test data and must never be
funded.

The five assertions cover:

1. Disconnect after signed persistence retains independently verifiable bytes
   and both input reservations.
2. Disconnect during signature fetch remains an uncertain signing record through
   backup/restore. Late old responses, reconnect and a separate new-account
   connection cannot revive the old command.
3. Disconnect after the first partial signature prevents requesting the second.
4. The real UI module preserves signed bytes and locks if disconnect occurs
   between signature return and a simulated signed-storage commit. It clears
   the device client and does not broadcast automatically.
5. Only an explicit later broadcast call sends the exact signed bytes to the
   fake backend, without sending another device command.

These tests do not establish actual IndexedDB power-loss durability, browser
WebHID behavior, physical USB/event timing, trusted-screen UX or network
acceptance. Those remain separate integration/release checks. Test-only fake
transports and helpers must never be imported into the production companion or
used as a hardware fallback.

## Recovery and indexer consistency regressions

`recovery-ui.test.ts` bundles the actual UI module and exercises imported owned
paths, subset imports, invalid paths, exhausted change indexes, and stale-tab
backup/public exports. It also checks fresh discovery bounds and an interleaved
bounds increase while discovery is in flight. DOM, IndexedDB, file downloads and the unused device
connector are isolated stubs. Generated download contents remain in memory;
the test does not upload files or access a browser profile. Wallet recovery tests
also cover canonical backup validation and preserved high-water bounds.

`blockbook.test.ts` uses bounded local HTTP-response fixtures. Its spend checks
cover both input orders, stable confirmed and pending controls, and changes in
history IDs, pending spends or UTXOs during a check. Passing these checks only
establishes rejection of observed inconsistent responses. It does not prove an
indexer's honesty, consensus validity or an atomic snapshot of a live mempool.

## DMK refresher timing and native response captures

`dmk-refresher.test.ts` runs the actual bundled `connectLedger` adapter, installed
DMK `DeviceSession`, intent queue, initial pinger, periodic refresher and device
connection state machine. Test-only discovery/builder plumbing connects them to
an in-process APDU endpoint with frozen public signatures. Production's explicit
`isRefresherDisabled: true` option is asserted. Five DMK model IDs (Nano S Plus,
Nano X, Stax, Flex and Apex) complete the verified payment across real timer gaps
without periodic B0 traffic. Two enabled-refresher negative controls inject B0
between signing commands, including after a 2.2-second busy REVIEW, and expose the
modeled strict fault. They show that the DMK queue serializes individual commands,
not the complete multi-command payment. Allow about 20 seconds for this test.

The verbatim `fixtures/dmk-idle-info.json` and `dmk-receiving-info.json` are separate
historical evidence from **one actual Nano S Plus simnet native ELF** under
Speculos 0.27.1, using the public BIP32 vector-one seed. Both identify the same ELF
SHA-256 `016a24fb3dce05d48a08118575802a44d561c29781572fbeab9d037bda77a661`:
idle B0 app-info returned the encoded `Pearl Sim Dev` / `0.1.0` response; after
BEGIN returned `9000`, the B0 intruder returned `6986` and the native app exited.
The installed DMK parser is exercised on the captured idle response. The test
also checks the fault response and shared provenance. Historical absolute snapshot
paths are metadata only; the portable test never reads them or executes firmware.

These are five **model-ID timing simulations**, plus one **recorded native-model
control**. They do not establish physical USB/HID behavior or native firmware
behavior on the other four models. No native ELF, emulator, browser, hardware,
private user seed or network listener is used by this host regression. The public
capture seed and signature fixtures must never be funded. Test-only facades are
not imported by production and do not provide a signer or transport fallback.

## Request scopes and stale account views

`middleware-lifecycle.test.ts` exercises actual node/light middleware over local
HTTP sockets. Public-indexer responses and node RPC are isolated fixtures. Only
the explicit operation-deadline timers are shortened to 500 ms in the child
process; timers and fetch are restored afterward. It checks unfinished-body
termination, subsequent successful requests, malformed JSON, failed-discovery
sibling cancellation and completed-discovery cleanup. `operation.test.ts` adds
stream byte limits, cancellation, completion and listener-cleanup controls.

`stale-journal.test.ts` runs actual UI code with deferred storage and DOM mocks.
Late reads cannot repopulate a closed account, cross an account/session switch,
or replace a newer journal/change-index view. `serving-policy.test.ts` resolves
the pinned Vite configuration and checks anti-framing headers in development and
preview, including the inherited node-bridge proxy. These checks do not establish
browser clickjacking resistance or real IndexedDB crash durability.

`storage.test.ts` exercises the actual `WatchStorage` class with a modeled
IndexedDB event source. Public-cache saves wait for transaction completion and
reject an abort even when no error event precedes it, preserving the transaction
error when one is available. Journal reads use readonly transactions and export
signed/uncertain records without writes under an imposed write-failure fixture;
they retain normalization and reject validation, request, transaction and abort
failures. This does not claim that a real browser rejects unchanged-row writes at
its quota. These handler checks do not establish real browser scheduling,
cross-tab serialization, quota behavior, rollback or crash durability.

## Backup validation worker boundaries

`backup-import-worker.test.ts` runs the actual one-shot browser-worker entry and
unchanged wallet validator in a Node worker_threads adapter. It verifies exact
public fixture transaction bytes, signature/account/reservation tamper rejection,
Blob and decoded UTF-8 size bounds, structured-clone types and worker self-exit.
`backup-import.test.ts` models the Worker API to exercise immediate cancellation,
late replies, listener cleanup, startup/runtime/message/clone errors and the
absence of a main-thread validation fallback. `backup-import-ui.test.ts` runs the
actual import event handler with worker, DOM, device and atomic-storage mocks;
it checks repeat clicks, cancellation before commit, stale account completion,
cross-tab state preservation, conflicting reservations and post-commit
cancellation. A completed merge is never rolled back or represented as unsaved.

The serving-policy tests check Vite's same-origin development worker route and
production worker asset, preserving the strict CSP without blob workers or
inline scripts. These are Node and build/HTTP checks, not an actual browser
upload, browser-worker/CSP execution test, physical Ledger test or IndexedDB
crash-durability claim. Full-backup validation still performs every existing
ownership and signature check; moving it off the UI thread does not make large
backups cryptographically cheaper. Cancellation terminates the worker and is
checked again inside the atomic storage update before any merge.
