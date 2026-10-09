# Independent wallet-recovery review

## Verdict

No blocking defect found in the backup-worker or reconciliation-budget changes. No additional production fix is recommended. The reviewer changed no parent source files.

## Reproduce the independent controls

Use the repository's supported Node 24 runtime and installed locked dependencies. From the repository root:

```sh
node --import tsx tools/wallet-recovery-review/independent/independent-controls.mjs
```

The script defaults to the current working directory as the repository. Set `PRL_ROOT=/absolute/path/to/ledgerPRL` to select another checkout; launch with that checkout's `tsx` available. It writes only stdout. Allow about one minute. No retained large fixture, generated binary, cache, isolated checkout, browser, hardware, credentials or external service is needed. Every synthetic test address is public test data and must never be funded.

The 14 controls execute actual `main.ts` reconciliation and real ownership/journal helpers. Signature verification, DOM, storage scheduling and RPC responses are explicitly modeled. They are not evidence of 2,000 valid transactions.

- Counts 0, 1 and 100: one batch, 80-second budget
- Count 101: two batches, 160 seconds
- Count 2,000: 20 batches, 1,600 seconds
- 2,000 archived-only records: one checkpoint batch, 80 seconds
- Count 2,001: rejection before any request or deadline timer
- Pre-abort, fetch error, fetch cancellation/deadline, queued-write cancellation/deadline, and storage error: unchanged exact saved journal; no owned deadline timer or forwarded abort listener remains

Successful controls preserve all non-archive fields and input reservations. `independent-controls.log` records the reviewed source SHA-256 and final 14-control result.

## Additional independently rerun checks

`focused-tests.log`: 24 focused tests passed across `backup-import*.test.ts`, `serving-policy.test.ts` and `node-reconciliation-ui.test.ts`. `typecheck.log`: every workspace TypeScript check passed. These were run against an isolated combination of the final patches before parent integration.

The genuine worker tests execute the unchanged backup validator under Node worker_threads. Worker transport, UI/DOM, device and atomic-storage boundaries are modeled. Serving-policy checks use actual Vite development HTTP responses and production build output.

Code review confirmed cancellation/account freshness before the queued import merge; post-commit cancellation preserves saved reservations; late worker replies cannot complete another operation. Reconciliation preserves per-request timeouts, RPC limits, response coverage, stable-tip requirements and the atomic saved-journal comparison. Its owned deadline timer and cancellation listener are cleaned up on success and failure.

## Separate parent verification

The parent reported a complete aggregate pass: 100 SDK, 71 wallet and 88 companion tests, type checks, build and secret-pattern scan. These are parent-owned results, not an independent rerun of the entire aggregate suite.

The parent also verified the final current-code capacity replay: 2,000 genuine 16-input records / 32,000 signatures; 296,701.384493 ms total; 20 batches; 2,180 modeled read-only RPC calls; exactly one journal commit; original exact bytes and locks retained. The retained `../reconcile-parent-final.json` reports source SHA-256 `f9b6a71c64799c59326352cf182b9ebbf975678c7efd684e4ea6b4233afa2f2f`, independently matched to the parent source when this report was packaged. That capacity replay is separate from this reviewer's synthetic 14-control harness. It uses actual UI/bridge validation with modeled RPC, not a live node.

## Historical reviewed patch identities

These identify the input patches reviewed before integration, not a current repository commit or standalone deliverable:

- Backup worker: `db5f83875c11aac54e8a0f73a21cefa93c4f8d105744de2395b624a7a5515fd7`
- Reconciliation budget/cleanup: `2f72c1e5ff951d9f00d40b1b2d5baf589770d0a86c0f57ed2380ba3f5f095971`

## Remaining boundaries

Actual browser import/upload, Worker/CSP execution, real IndexedDB scheduling/crash durability and physical Ledger behavior remain untested. Worker validation still performs every cryptographic check. The author measured a remaining synchronous atomic merge around 2.45 seconds; that residual is unchanged and is not this reviewer's measurement. A changed chain tip still requires a safe reconciliation retry.
