# Combined-build browser smoke: interrupted, not verified

Recorded: 2026-10-09, 23:55 UTC. Reviewer: Astra.

**Superseded for current qualification:** After the parent authorized a fresh bounded supported-browser check, direct observations were successfully collected at 23:56 UTC. See `astra-real-browser-combined-smoke-2026-10-09.md`. This file preserves only the earlier interruption/evidence-availability status.

## Status

The parent reported that this review was stuck in `pending_init`, interrupted it, and requested a bounded evidence report without repeating browser work. On resumption, the reviewer could execute ordinary tools normally. However, no browser action, returned page state, or actual browser-tool failure for the requested combined build is present in the reviewer's available task history. The existing website-QA evidence directory also contains no observation for this build.

Consequently, this report makes **no browser-pass claim for the combined build**. A parent progress summary referring to completed checks is not substituted for the underlying observation.

## Intended build (parent-supplied, not independently observed in this pass)

- Bundle: `index-d0S-5XX6.js`
- Bundle SHA-256: `4202b471db46fbd8b8f0d58136ea54994775d34eb7e5a2bded55c606267e7ea1`
- `main.ts` SHA-256: `ce0b26e6520f210bf57f633469da5ab1821f18e423926422ffc5c4568cce3292`
- `discovery.ts` SHA-256: `4f003ef5792ef1088f5fcd60f895d0ae7c787e80e9276a1787dc194ba07df8a2`

## Unverified for this build

- Exact served bundle/DOM script identity
- Explicit Restore and public fixture rendering
- Receive verification controls
- Normal navigation and fixture journal preservation
- Close and reload behavior
- Application console/render-error sample

## Preserved earlier evidence

`astra-real-browser-final-smoke-2026-10-09.md` records actual observations for the earlier `index-CpBl0wyO.js` bundle, SHA-256 `84e04058b1565b0fa73d84360ada84868c32b2e7e5637e6b2dcca4a8131236d3`: explicit Restore, unverified Receive, one retained fixture draft, Close/Back, notices, and the bounded error sample. Those observations remain valid only for that earlier bundle; they are not automatically extended to the combined build.

No further browser actions, tool retries, uploads, hardware/native work, indexer calls, transactions, or journal mutations were performed after resumption. No restriction was bypassed. Actual failed-device-session cleanup, live discovery consistency, storage races, and physical hardware behavior remain outside this report's observed coverage.
