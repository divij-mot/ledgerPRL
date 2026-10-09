# Companion boundary tests

Run from the repository root:

```sh
npm run test --workspace @pearl-ledger/companion
node --import tsx --test apps/companion/test/disconnect-regression.test.ts
```

The disconnect regression is a Node-only, isolated test process. It uses the real
installed Ledger DMK `DeviceConnectionStateMachine`, actual Pearl DMK adapter,
actual PSBT adapter/host SDK and actual `main.ts` payment flow, with the repository's frozen,
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
2. Disconnect while a signature yield is pending remains an uncertain signing record through
   backup/restore. Late old responses, reconnect and a separate new-account
   connection cannot revive the old command.
3. Disconnect after the first partial signature prevents the continuation that would yield the second.
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
between PSBT continuation commands, including after a 2.2-second busy SIGN_PSBT,
and expose a deliberately strict modeled fault. They show that the DMK queue
serializes individual commands, not the complete multi-command payment. Allow about 20 seconds for this test.

The verbatim `fixtures/dmk-idle-info.json` and `dmk-receiving-info.json` are separate
**historical PRL1-protocol evidence**, not evidence for the new PSBT firmware,
from **one actual Nano S Plus simnet native ELF** under
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

## Bitcoin-based PSBT and direct website lifecycle

The current signing, cancellation, recovery, disconnect and refresher probes run
`LedgerBitcoinPrlClient`, never a legacy-client alias or fake client. The shared
`psbt-endpoint.mjs` is an explicitly mocked device endpoint. It checks the complete
SIGN_PSBT APDU against the independently frozen adapter fixture, including exact
PSBTv2 map roots and unnamed BIP86 wallet policy. Before yielding the existing
public fixture signatures it issues 122 preimage/proof/index requests and checks
every host continuation byte against the hash-pinned official Ledger Python host
oracle. Receive verification additionally replays six wallet-policy requests and
checks the displayed-address request's policy, branch, and index.

`psbt-endpoint.test.ts` reproduces those frozen responses using the read-only
Python oracle. Regenerate deliberately with:

```sh
node --import tsx apps/companion/test/generate-psbt-endpoint-fixture.mjs
```

`psbt-lifecycle.test.ts` exercises actual `main.ts` with mocked DOM, atomic-storage
scheduling, backend checks and the shared device endpoint. Its ten scenarios cover
signed persistence before final ACK, cancellation and timeout at that boundary,
three final-ACK failures, an independently validated downloadable emergency
backup, re-sign and unload guards, exact canonical-record and signature-verified
restore, successful commit with lost acknowledgement, and a bounded hung write.
The test never treats a completed download as proof that storage was restored.

`direct-wallet-ui.test.ts` exercises the actual website event handlers for direct
Ledger connection, receive verification/copy, preparation, signing and explicit
broadcast. It forbids MetaMask access and unexpected source calls, checks that
ordinary flows do not opt into optional snapshot caching, and preserves the
required transaction journal on disconnect/reopen. It checks storage-before-display
receive issuance, rejection/cancellation, stale account/index changes, duplicate
clicks, late disconnect results, monotonic cross-tab recovery bounds and repeated
verification failure. It also dispatches unchecked broadcast events, requires fresh
retry approval and changes owner, network, destination, payment and signed bytes
while the approved operation is pending. These changes must prevent submission.
All backend submissions are local in-process fixtures; none are real broadcasts.

`public-source.test.ts` checks fixed supported networks, explicit disclosure
consent, narrow address/transaction/height proxy requests, disabled credentials,
cache and redirects, and cancellation. Captured wire bodies contain no account,
xpub, fingerprint, public key, chain code or recovery range. The actual main UI
recovery probe now derives addresses locally through this source and still tests
fresh durable ranges and another tab extending them during discovery.

`public-lifecycle.test.ts` retains the real main UI and wallet discovery/validation
while modeling source and storage scheduling. Four cases assert that discovery
requests its 300-second total budget and input checking its 90-second budget, then
reject late source success after a controlled deadline abort. They also reject
cancellation while discovery awaits its atomic storage update and while an input
check awaits a late unspent response. They do not claim real-time timer accuracy.

Generic SIGN_PSBT rejection retains the signing lock. Unlike historical PRL1
REVIEW assumptions, these tests do not infer that a generic status proves no
signature could have been created. Both independent recovery probes still require
fresh matching device-approved identity, source freshness, identical canonical
payment and all input reservations; concurrent valid witness sets cannot replace
the first saved completion.

All of this is host-side modeled-boundary evidence. It does not establish a real
browser's WebHID, clipboard, CSP, IndexedDB rollback/quota/power-loss behavior,
trusted-screen/native firmware correctness, or physical-device qualification.

## Async authority and pre-commit signed recovery

`browser-operation-boundaries.test.ts` runs the focused pure-host probes in
`tools/browser-operation-review`. They test actual `main.ts` against injected
DOM, storage completion and public fixture device boundaries. Frozen broadcast
approval is rechecked both inside the atomic update and after its completion;
revoked disclosure consent cannot send the signed payload. Public/snapshot
imports and preparation honor cancellation before mutation and retain already
committed recovery ranges or reservations after cancellation. Preparation uses a
snapshot of the requested inputs/amount/fee/change rather than later DOM events.

A real PSBT adapter/public endpoint fixture also verifies that the signed recovery
copy and unload warning exist before signed storage completes. The ordinary
lifecycle suite separately retains failed/hung write, final-ACK loss, independent
backup validation and exact durable read-back coverage. Signed copies are cleared
only after verified read-back, never merely after clicking Download.

The focused `WatchStorage` tests use an explicit FIFO transaction/rollback model
for two-tab reservation competition and monotonic recovery ranges. They establish
host behavior conditional on that model, not actual browser scheduling, rollback,
quota or crash durability. An optional stale-callback injection probe is disabled
by default; it is not evidence that a closed real WebHID listener can fire. No
browser, physical device, native firmware, remote service or real broadcast runs.
