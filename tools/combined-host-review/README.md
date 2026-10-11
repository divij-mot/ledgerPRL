# Combined host validation, 2026-10-09 23:42 UTC

This check binds the independently reviewed device-session and account-discovery corrections together. It is host software evidence, not current native firmware, physical device, deployed TLS or live-chain qualification.

## Verified

- `npm run check`: all six workspace typechecks, **435 tests** (27 adapter, 64 optional Snap, 103 SDK, 99 wallet, 6 CLI, 136 companion), host builds and tracked-file secret-pattern scan passed. The 136 companion total includes wrappers executing the 29 browser-operation cases (one optional model-only skip) and 35 device-identity/session cases.
- The four production/regression hashes in `source-before.sha256` were checked unchanged after the command. Review reports retain their independent source identities and limitations.
- Fresh dependency graph: 419 checks; distributed third-party notices match exact generated content for this build.
- Final main bundle: `index-d0S-5XX6.js`, SHA-256 `4202b471db46fbd8b8f0d58136ea54994775d34eb7e5a2bded55c606267e7ea1`.

`check.log`, `dependencies.log` and `notices.log` retain command output. The aggregate scan preceded staging newly added reports; `staged-secret-scan.log` records the separate final tracked-file scan. Pattern scans are limited checks, not proof that no secret can exist.

## Independent reviews

- [Exact-build real-browser smoke](../../apps/companion/test/evidence/website-qa/astra-real-browser-combined-smoke-2026-10-09.md): final bundle identity, public-fixture restore/navigation, preserved draft and disabled unverified receive controls, Close/reload. No hardware, live discovery or timing-race claim.
- [Device identity and session owner](../device-identity-review/REPORT.md)
- [Independent session verification](../device-session-review/README.md): 10 cases, including stalled storage after terminal signing results
- [Discovery owner](../account-discovery-review/REPORT.md)
- [Independent discovery verification](../discovery-consistency-review/report.md): 32 offline cases

No real funds, mainnet broadcast, seed handling, native firmware execution, physical installation or external indexer request was performed by this combined validation. Local public fixtures and mock transport/storage boundaries cannot qualify actual device screens, browser crash durability or backend truth. The exact published checkpoint `766a3f7ff1d61c7ff0e60d5484ef7c4250545aad` passed [host/oracle/Rust CI](https://github.com/divij-mot/ledgerPRL/actions/runs/38006393030), verified at 23:55 UTC. That workflow does not build or qualify the current C firmware.
