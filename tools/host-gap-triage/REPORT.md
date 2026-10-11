# Independent host gap triage and CLI interruption correction

Scope: source and retained host evidence on branch `ledger-bitcoin-prl`, local
baseline `75a1c6026bd3c8e485c1ac6588d9d78eb656bcb2`, 2026-10-10 UTC.
This review used only public synthetic fixtures and local TypeScript/filesystem
operations. No browser/profile, network endpoint, native firmware/emulator,
physical device, live account, secret, real transaction or deployment was used.

## Result

One new actionable recovery defect was reproduced and narrowly corrected after
coordinator authorization: the development CLI erased its sole durable
uncertainty record while replacing it with signed bytes. No second newly
demonstrated security-critical host defect was established in this pass.
Existing browser/transport/deployment qualification limits remain limits, not
new findings or failures that more of the same mocks can resolve.

## Ranked gap map

### 1. CLI signed-file replacement interruption — reproduced, corrected

**Location before correction:** `apps/cli/src/index.ts:97–111` truncated the
sole output before replacement; `:203–218` called this from the signing
persistence callback. Source SHA-256 was
`fe12f56530ba3ce1d048d45f29628445decbba6ab486f70594386dd436ce308e`.

**Claim versus evidence:** the source said the canonical uncertainty record
"survives interruption". The existing six CLI tests covered happy-path sync,
private/exclusive creation, existing/symlink paths, pre-sign rejection and
lost/rejected final ACK. They did not interrupt replacement or inject a
post-truncation write failure. The transaction-binding report accurately
claimed callback sync and stderr fallback, not crash atomicity.

**New reproduction:** actual CLI source and actual PSBT adapter/independent
signature verification used frozen `fixtures/protocol-v1.json` signatures.
Only the APDU transport and selected file-I/O fault boundary were injected;
creation, writes, truncation and reads used real temporary files.

- Control: complete independently verified bytes were stored before final ACK.
- ENOSPC-style write failure after the second real truncation: the output was
  empty, the old intent was lost, and exact signed recovery survived only on
  stderr. No final ACK or successful-save output occurred.
- Child SIGKILL immediately after that real truncation: the output was empty,
  with neither the old intent nor a stderr recovery record. Complete public
  signatures had reached the adapter; no final ACK had been sent.

This is a meaningful conservative-recovery loss, not a demonstrated theft,
changed-recipient transaction, hardware signing defect or browser-wallet bug.
The CLI was never a global wallet/input lock; using another output path was
already outside its reservation protection.

**Correction:** current `index.ts:184–189, 212–223` reserves deterministic
`<output>.intent.json` with `wx`/0600, writes its canonical uncertainty record
once and syncs it before signing. `:104–117` performs this initial write without
truncation. The sidecar is never overwritten, renamed, removed or reused, even
after success. The original primary descriptor still receives the signed
replacement (`:227–230`) and must sync before the adapter's final ACK. Cleanup
at `:271–280` closes both owned descriptors even if one close throws. Account
export remains single-file. Exact signed-byte stderr recovery is retained.

An atomic path-replacing rename was deliberately avoided: it would weaken the
existing descriptor-only behavior and could replace an unrelated entry moved
into the output path. Trusted parent directories remain necessary; no change
claims protection from an attacker who can remove or rename directory entries.

**Current evidence:** the same real-filesystem ENOSPC and SIGKILL boundaries now
leave an intact canonical 0600 sidecar; the primary may still be empty and must
not be trusted. The sidecar preserves reconciliation intent, not lost
signatures or proof of spendability. Full storage-device/power-loss guarantees
and Windows directory durability were not tested.

Frozen corrected production SHA-256:
`556ed61699371f1696c265f00356ac30447e95f84ff181ab1206765bae26893c`.
The independent broader file-I/O matrix passed 26/26 cases plus its standalone
typecheck on this exact source. Its separately maintained evidence is in
[`../cli-durability-review/README.md`](../cli-durability-review/README.md).

### 2. Loaded-browser recovery integration — important known gate, still open

**Locations:** `apps/companion/src/storage.ts:56–84` relies on real IndexedDB
strict readwrite transactions and completion/abort events;
`apps/companion/src/backup-import.ts:15–62` relies on a real same-origin module
Worker, structured-cloned Blob/result and termination semantics.

**Actual evidence:** existing storage/race tests execute the real host logic
against explicit schedulers or injected DOM/storage/Worker boundaries. The
serving-policy test checks an emitted external worker URL and worker code
(`apps/companion/test/serving-policy.test.ts:120–150`), not browser execution.
The final Chrome smoke is normal-flow coverage; the earlier browser report
explicitly says file import was not attempted. Neither demonstrates the full
real file-picker → CSP/module worker → validated merge → actual IndexedDB
commit → interrupted/reloaded or competing-tab recovery path.

This limitation is already disclosed in `docs/implementation-status.md` and
`tools/browser-operation-review/REPORT.md`. Existing host regressions are
meaningful, but another synthetic pass cannot promote them to browser
crash/cross-tab qualification. No browser route was attempted during this
review and no claim of a new browser defect is made.

### 3. Initial device-connect failure cleanup — narrow host regression gap

**Location:** `apps/companion/src/ledger.ts:177–221`, especially the
`startDiscovering`/`stopDiscovering`/`connect` rejection catch that calls both
DMK close and WebHID factory destroy.

**Actual evidence:** `ledger.test.ts` directly covers already-created transport
closure/listener destruction, terminal exchange races and cleanup failures.
`dmk-refresher.mjs` exercises successful `connectLedger` with a replaced
builder/discovery facade and installed real DMK session/timer components.
The reviewed test inventory did not contain a targeted initial-discovery,
stop-discovery or connect-failure case that establishes factory cleanup and
prevents a returned usable session. The broad "DMK timing" pass should not be
read as evidence for those distinct startup rejection branches.

A bounded injected startup-failure regression would improve coverage without
native or live-device work. This is lower priority than the confirmed recovery
loss and loaded-browser release gate; no resource leak, approval bypass or
reachable hardware defect was reproduced, and no transport source was changed.

## Artifacts and verification

- `cli-recovery-gap-before.log`: three passing **characterization** cases on
  the original implementation; two assert the reproduced unsafe persistence
  result. This is not a historical security pass.
- `before-source-sha256.txt` and the `*-before.*.txt` sources: exact initial
  production/probe hash bindings. Archived probe source hashes were checked
  against the initial recorded values.
- `cli-recovery-gap.test.ts`, `cli-storage-child.mts`: fixed-code regression
  and in-memory CLI bundling/fault harness. No production test hook or
  software-signing path was introduced.
- `cli-recovery-gap-after.log`: all three fixed-code cases pass.
- `standard-regressions.log`: all three also pass via
  `apps/cli/test/intent-durability.test.ts`, which imports them into normal CI.
- `cli-typecheck.log`, `probe-typecheck.log`: CLI and strict independent-probe
  typechecks pass. The isolated probe initially needed an explicit generic
  Uint8Array annotation; that test-only typing correction was rerun successfully.
- `cli-intent-fix.diff`: narrow source and recovery documentation changes.
- `source-sha256.txt`: final production, documentation and regression bindings.

Commands used for the fixed-code checks:

```sh
node --import tsx --test tools/host-gap-triage/cli-recovery-gap.test.ts
node --import tsx --test apps/cli/test/intent-durability.test.ts
npm run typecheck --workspace @pearl-ledger/cli
node node_modules/typescript/bin/tsc --project tools/host-gap-triage/tsconfig.json
```

No broad host-suite, live endpoint, native artifact or physical-device
qualification is claimed by this report. Aggregate/final-commit checks remain
coordinator-owned. In particular, all current C source corrections remain
subject to their separate uncompiled/unexecuted-native caveat.
