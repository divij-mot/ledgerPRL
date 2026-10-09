# Full-backup import worker evidence

## Result and scope

The complete watch-wallet importer runs the existing `importWalletBackup`
validator in a one-shot same-origin module worker. Blob reading, parsing,
ownership validation and signature verification move off the UI thread. No
signature/ownership check, 16 MiB bound, or atomic merge rule is relaxed. There is
no software signing path, new dependency or main-thread fallback on worker error.

The client terminates the worker on success, error or cancellation and ignores
late messages. The actual import handler checks cancellation and account identity
before storage and inside its atomic update callback. If cancellation arrives
after the durable merge, reservations remain saved and the UI says so; stale
completion cannot switch the account view. Exact code and tests are retained in
the companion source tree, rather than duplicated here.

This packet contains source/text only. The large public journal, dependency tree,
bundled worker, binaries and HTML capture are deliberately excluded.

## Historical maximum-capacity result

`worker-performance-historical.json` preserves the original measurements:

- Input: 16,218,359 bytes, 2,000 records and 32,000 signatures
- Validation: 185,708.65 ms in an actual Node worker_threads instance
- Main thread: 7,374 callbacks on a 25 ms timer during worker validation
- Maximum observed timer interval: 35.27 ms
- Cancellation response to an active maximum-size import: 1.03 ms

Input SHA-256:
`54d70adaecb7ace97221ca34912c9c93e0a180d94195533605219a65e4ae96b3`.

The historical timer was cleared immediately when the import promise resolved.
Its interval statistic does not include a separately sampled result-transfer
tail or the later merge. The portable replay records the tail separately and
waits for Node worker exit after cancellation and completion.

`merge-performance-historical.json` records the unchanged synchronous merge of
the same 2,000-record / 32,000-outpoint journal into an empty journal: 2,454.94 ms.
That ~2.45 s residual remains on the main thread. The worker fixes the much longer
validation stall; it does not make verification cheaper or eliminate all UI work.

## Verification and source identity

The isolated worker patch passed `npm run check`: 100 SDK, 71 wallet and 88
companion tests, all workspace typechecks, production build and secret scan.
New controls exercise the actual worker entry/validator and actual UI handler
with clearly marked Worker/DOM/device/storage adapters. The production build
emitted one 72,478-byte same-origin worker. Vite HTTP/build controls checked the
module-worker route/asset and `worker-src 'self'`; no CSP relaxation was added.

`source-hashes.json` records SHA-256 for the historically measured code and the
current readable checkout. Worker, wrapper, wallet and SDK source bytes match;
the final main module additionally includes the separate reconciliation fix.
The exact backup handler region also matches between those two versions.
Source hashes are authoritative. The parent verified that local commit
`46975695397fc59c93cb4c6612e5cbb60276eb08` maps to published commit
`b98f7bd7834bb380d9a772e58a0d51dde22c8a70` with tree
`fa9b7321d543f0d4dcbff5814f03c43581d134d8`. This worker checked the local tree;
the published mapping is parent-reported, not independently fetched here.

`portable-smoke.json` is a fresh test of the parameterized replay using two
public generated records / 32 signatures. Its 0 ms cancellation delay tests an
active worker request and is not a maximum-size or browser timing claim.
Historical maximum results are not presented as a new replay of this script.

## Separate final-parent maximum replay

A fresh replay of the retained portable script against final parent source on
2026-10-09 passed all 2,000 records / 32,000 signatures. `final-parent-replay.json`
records the exact source/input hashes and owning process completed with exit 0.
Validation took 179,266 ms; 7,126 main-thread 25 ms callbacks ran with a maximum
30.54 ms observed interval, plus a separately measured 45.07 ms result tail.
Cancellation responded in 0.77 ms and the worker exited after 3.36 ms. Exactly one
termination was observed for cancellation and completion. Synchronous merge took
2,602 ms and remains outside the off-thread validation claim. These are Node
worker/API-adapter measurements, not a browser performance qualification.

## Portable replay

Use Node 24.19 and the repository's installed dependencies. Run from the
repository root. Output directories must be writable; use a fresh replay folder
because an existing `worker-replay.json` is never overwritten. Runtime worker
bundles are created under the OS temporary directory and cleaned up.

Generate the large journal with the separately retained public-only generator:

    export PRL_ROOT="$PWD"
    export PRL_REVIEW_OUTPUT="$(mktemp -d)"
    node --import tsx tools/wallet-recovery-review/backup-ceiling.mjs --expect-fixed
    export PRL_REVIEW_JOURNAL="$PRL_REVIEW_OUTPUT/backup-ceiling-journal.json"
    export PRL_EXPECTED_JOURNAL_SHA256=54d70adaecb7ace97221ca34912c9c93e0a180d94195533605219a65e4ae96b3
    export PRL_REVIEW_OUTPUT="$(mktemp -d)"
    node --import tsx tools/wallet-recovery-review/import-worker/replay-worker.mjs

The generator uses only the published deterministic BIP32 vector-one fixture.
Never use or fund those addresses. Generation and complete verification take
minutes. Reuse a separately generated journal by setting `PRL_REVIEW_JOURNAL`.
No journal is read implicitly from a personal wallet or browser profile.

Optional replay controls:

- `PRL_ROOT`: source checkout, defaults to the current directory
- `PRL_REVIEW_JOURNAL`: required path to the external public fixture JSON
- `PRL_REVIEW_OUTPUT`: evidence directory; default is an OS-temporary subdirectory
- `PRL_EXPECTED_JOURNAL_SHA256`: optional exact input digest assertion
- `PRL_EXPECTED_RECORDS`: default 2,000; must be 1 through 2,000
- `PRL_EXPECTED_SIGNATURES`: defaults to records × 16
- `PRL_CANCEL_DELAY_MS`: default 150 after the worker receives its request
- `PRL_WORKER_TIMEOUT_MS`: default 900,000, bounded from 1 second to 1 hour

For a quick smoke, generate with `COUNT=2`, unset the maximum-journal digest,
then replay with `PRL_EXPECTED_RECORDS=2 PRL_CANCEL_DELAY_MS=0`. A smoke does not
substitute for the maximum-capacity result. If validation completes before the
requested cancellation, the replay fails instead of claiming cancellation.
The script records current source hashes, input hash, timing, worker termination
counts and separate synchronous-merge timing. It bundles actual checkout source
with explicit SDK/wallet aliases, avoiding workspace-link ambiguity.

From this packet directory, verify its retained source/text files with:

    sha256sum -c SHA256SUMS

## Qualification limits

No actual browser import/upload, browser Worker/CSP execution, physical Ledger,
live node/indexer, broadcast, or real IndexedDB crash/rollback test was performed.
The browser permission gate remained closed. Node worker execution, modeled API
and UI/storage boundaries, and Vite HTTP/build checks are separate evidence and
must not be relabeled as actual browser qualification. The maximum-size merge's
~2.45 s synchronous residual remains explicitly unresolved by this patch.
