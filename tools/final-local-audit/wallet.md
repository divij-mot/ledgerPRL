# Independent host wallet review — 2026-10-10

This is a fresh AI code review and bounded host test pass, not a professional security audit or a guarantee of mainnet safety. No hardware approval, seed, signing key, real transaction submission, or funds were used. The separate native review covers the official light-client implementation.

## Result

One independently identified P2 account lifecycle defect and two subsequent parent-identified discovery/review defects were reproduced and fixed. No additional unresolved P0–P2 issue was established in the reviewed host flows. The conclusion is limited to the recorded source hashes and the tests below.

### Resolved P2: account replacement stranded the old local profile

Before the fix, the real public-account import handler changed `account` and reset `sourceMode` without closing the old local process. The backend correctly rejected a different account while that old process was running. The subsequent Close account handler also skipped `/api/local/close` because `sourceMode` had become `node`, leaving no ordinary UI recovery path for the new account. Backup import, snapshot replacement, and a different Ledger account had equivalent ownership gaps.

The reproduction executed bundled `main.ts` handlers with mocked DOM/storage/device boundaries and observed zero local-close calls across public import and subsequent account closure. This was an availability failure; no funds loss or unauthorized broadcast was demonstrated.

The fix introduces `apps/companion/src/local-session.ts`, called by `main.ts` account transitions. It remembers exact local ownership independently of the selected source, retains and awaits a bounded startup request when the view is cancelled, closes only that owner, and retains ownership when shutdown fails. Reloaded public account identity can close an already-running matching server profile before this page starts its first scan. Failed shutdown prevents account replacement. The server permits an idempotent close when no account is bound, without loading or starting the native runtime; an active foreign owner is still rejected.

Successful first-mainnet public/backup imports now remember and resume local sync. Journal merge/reservations/exact signed bytes are unchanged. Submission copy says confirmation remains pending. Mainnet accounts other than account 0 use the ordinary explicit public-sync consent path; they no longer offer unsupported local sync. The optional minimum-fee action was not added; the existing exact minimum hint and manual fee remain.

Regression evidence: `apps/companion/test/local-session.test.ts`, `apps/companion/test/local-session-ui.test.ts`, `apps/companion/test/local-light.test.ts`, and `tools/final-local-audit/wallet-switch-regression.test.ts`.

### Resolved P2: retained native address history was outside a fresh browser gap

The parent identified that `waitForLocalSource` respected native `lastUsed`, but `startLocalSync` still passed the original browser journal range to SDK discovery. An independent actual-main regression with native use at receive index 50, registered through 70, and a fresh browser journal reproduced a zero-coin result. The fix uses the maximum browser/native recovery bound for both SDK discovery and the atomic journal coverage guard. The regression now finds the exact funding output and preserves index 50 in recovery metadata.

### Resolved review interruption: background discovery could replace a live view

The parent identified receive-index movement during a physical address review. Actual-main scheduling regressions independently reproduced background snapshot replacement while busy, sending, or receiving. Application now defers at entry, inside the queued journal callback, and after commit when a flow is active. The regular timer obtains fresh data after the flow closes. Tests cover busy/Send/Receive plus Receive entered before the journal callback and after its commit. Existing guards already prevented copying the wrong address; this fix avoids unnecessary review invalidation.

### Final build identity hardening

The delta review also identified that checking only listed helper-source hashes would miss a newly added Go source file. The parent added exact sorted source-set equality before individual hashes. A read-only check confirmed that the final local manifest lists all seven current Go/module files and every recorded source hash matches. This reviewer did not launch or modify the native sync process.

## Reviewed boundaries

- SDK transaction parsing, exact grain values, bundle ownership and signature verification; Bitcoin-derived PSBT adapter account policy, continuation protocol, terminal failures and verified-signature persistence before final ACK.
- Durable reservation transitions, recovery merging, raw-byte retries, confirmed archival without reservation release, and fresh spendability preflight before signing.
- Local source account/genesis/source identity, bounded gap/coverage, complete transaction bytes, same-tip history/unspent changes, and stable block lookups. The native reviewer separately found the peer-ahead readiness gap; the coordinated native/browser readiness guards address it.
- Loopback HTTP exact origin/host/custom-header/body framing, fixed method allowlist, bounded JSON, validated signed broadcast payloads, and rejection of arbitrary RPC/paths/configuration.
- Helper executable identity, owned private profile/lock paths, child shutdown, cancellation, bounded native protocol replies, and background read cancellation without silently abandoning native response ownership.
- Browser account restore/switch, background discovery versus device operations, stale journal/input checks and exact broadcast approval context.

There is no production software key/signing fallback in the inspected host modules. The local service does not expose a generic RPC or accept browser-supplied executable, data paths, peer URLs or native configuration.

## Verification

Supported runtime: Node 24.19.0 from the bundled Codex runtime. Tests used loopback-only mock HTTP/native/device boundaries. The existing full-sync public fixture process was not started, stopped or modified by this reviewer.

- SDK: 103/103 passed.
- Wallet: 99/99 passed.
- Bitcoin-derived adapter: 27/27 passed, including pinned upstream Python oracle/continuation checks.
- Initial focused host suite: 52/52 passed (runtime, local HTTP/source, Wallet API, browser authority and device identity boundaries).
- Frozen companion suite: 213/214 passed; all 15 payment sequences passed with unchanged production source hashes. Its sole failure was the snapshot-import test mock lacking the newly required owner-bound close reply. The test now asserts that exact local-close route and account in both mock fetch phases.
- Targeted lifecycle/recovery rerun after that mock update: 5/5 passed, including the actual public import/Close account handlers, in-flight startup shutdown, failed close retry, reload ownership, and snapshot recovery ranges.
- Extended discovery/lifecycle suite: 13/13 passed after the final recovery-range and review-deferral fixes.
- Companion TypeScript check and `git diff --check` passed.
- The deleted production demo fixture was relocated byte-for-byte from HEAD to `apps/companion/test/fixtures/example-watch.json`; SHA-256 `cc8948926914db72ace789ccae84ae75ca24154faec5cef341fc2e9858a2ef5d`. Four existing review-test references were updated. No production demo was restored.

The final overall build/check is coordinated by the parent task and is not claimed here until separately recorded. Local test logs are retained alongside this report. The final host source manifest is `wallet-source-hashes.json`, recorded after the final production freeze. Subsequent code changes require a new delta review/hash snapshot.

## Final display-only delta

Automatic local discovery now leaves the success notification empty because the account card already displays sync status. Error and signed-recovery handling were not changed. The same 13 focused discovery/lifecycle/recovery cases passed again; `git diff --check` passed. Only `apps/companion/src/main.ts` differed from the prior 78-file host snapshot, and its hash has been refreshed. Evidence: `wallet-display-delta.log`.

The parent's separately reported read-only Ledger Wallet/SPV and unsigned-draft smoke checks are outside this reviewer's executed tests. No private wallet data was copied into this report or its evidence.

## Final inline-connection delta

A restored account's unsigned draft now offers the existing **Connect Ledger** action directly in its summary while no ready device session exists. Once connected, the primary action becomes **Confirm on Ledger**. Connection performs account approval only and never invokes signing. A matching account retains the draft and all reservations; a different account clears the visible draft/watch context but retains the old journal. Matching Send/Receive reconnection schedules the normal background refresh for after the flow closes instead of launching an immediate rescan. The independent input preflight before every signature remains mandatory.

The final focused suite passed 16/16 cases. New actual-main tests use the real PSBT adapter against frozen public test vectors: connecting emits no `SIGN_PSBT`, changes no reservation, and requires a separate explicit Sign action that first performs input validation; mainnet matching connection sends no sync request; foreign account connection retains the original journal. Four adjacent wrapper suites (browser operation authority, device identity, direct wallet UI, PSBT persistence/recovery) also passed. The focused suite was rerun after the final refresh-scheduling adjustment. TypeScript and diff checks passed. Only `main.ts` and the existing audit regression test changed relative to the prior snapshot; the 78-file hash manifest has been refreshed. Evidence: `wallet-inline-connect.log` and `wallet-inline-connect-adjacent.log`.

No real hardware or chain transaction was signed or submitted by this reviewer.

## Remaining qualification limits

These finite host tests do not exhaust asynchronous interleavings or establish real IndexedDB crash durability. Mock endpoint signatures and public fixtures are not a physical Ledger trial. Installation of the final Pearl 0.1.0 device application, actual user-confirmed address/account/signing flows inside Ledger Discover, and any small mainnet send remain later physical-user work. The old installed PearlDev application does not establish compatibility with the final app identity.

## CI portability follow-up

Reviewed the test-only `light-runtime.test.ts` delta replacing the macOS-specific `/private/tmp` prefix with `path.join(await fs.realpath(tmpdir()), "pearl-light-runtime-test-")`. This chooses the platform temporary directory while preserving the canonical-path invariant required by the runtime ownership checks. No production code or test assertions changed. Independently reran all 15 cases on Node 24.19.0: 15 passed; Ubuntu CI remains the parent task’s next verification. The existing `wallet-runtime-portability.log` records the parent’s matching local run. Added this previously unlisted test file’s SHA-256 to the manifest; every existing reviewed hash and metadata field was preserved.
