# Release and Ledger submission checklist

This is preparation, not a submission or approval. No agreement has been accepted on the owner's behalf; no app/OS has been installed on hardware; no custom CA, generic test seed, PIN, trust setting or provider has been changed. Pearl is not available in My Ledger.

Recorded [native/emulator evidence](../apps/ledger/tests/evidence/README.md) and [offline package verification](../apps/ledger/tests/evidence/packaging/README.md) already cover development snapshots. The unchecked reproduction items below apply to the final release artifacts and complete intended matrix; they do not mean those earlier checks were never run. The five modeled targets are Nano S Plus, Nano X, Stax, Flex and Nano Gen5. The original Nano S is unsupported.

## Source, packaging and publication configuration

- [ ] Owner selects a project license and approves any disclosure; preserve dependency/upstream notices. SDK-inherited workspace license metadata is not a license choice for Pearl.
- [ ] Freeze source, SDK/toolchain versions, dependency locks and a builder image digest; reproduce every required model/network.
- [ ] Record each device's actual retail OS/API and update eligibility separately from SDK tags. API-27 SDK mapping alone does not prove rollout or device compatibility.
- [ ] Review the root `ledger_app.toml`, effective install permissions, icons, exact app/network names and all generated ELF/HEX/APDU/application hashes.
- [ ] Independently reproduce offline packaging on all intended models/networks. `scripts/ledger-package.py` verifies existing ELF bytes and permissions without loading hardware; its checked file-only loader emits no deletion, CA or signed-commit operation.
- [ ] Review the SDK-added effective `0x200` settings privilege on Nano X/Stax/Flex/Gen5 and the explicit custom SDK patch with Ledger; do not infer vendor approval from the official base metadata or local tests.
- [ ] Resolve the pinned upstream workflow integration blockers recorded in `apps/ledger/publication/official-gates.json`, including mutable SDK/builder updates, preparation hooks, write permissions and the TypeScript-to-required-functional-test integration.
- [ ] Obtain actual passing official guidelines-enforcer, native build and accepted functional-test results. The manual read-only offline preflight is not a substitute or a submission-compliance badge.
- [ ] Keep `docs/apdu.md` linked to the canonical `docs/protocol-v1.md`, without maintaining inconsistent protocol copies.

## Software and dedicated-device validation

- [ ] Reproduce native Speculos account/address/signing/rejection/lifecycle tests on all five targets and every network/load-permission variant.
- [ ] Reproduce signing vectors and actual isolated Pearl acceptance/confirmation/reorg evidence against exact artifacts.
- [ ] Qualify loaded-account browser flows, imports, real IndexedDB persistence/cross-tab locking, interruption/reload recovery and supported viewport/OS combinations. The completed desktop empty-state rendering review and mocked host regressions do not establish these behaviors.
- [ ] Obtain a Ledger-controlled physical-test/distribution arrangement for **retail Nano X**, which cannot ordinarily sideload. A special-development-device host option is not a retail workaround. Pearl is not deployed to a vendor test provider.
- [ ] Separately authorize app installation on dedicated, no-value test devices for each supported route. Verify target/API, secure-display app identity and package hashes before use.
- [ ] Document a seed-preserving **app-install** procedure; never hide recovery-phrase entry, quick setup, factory reset, custom CA enrollment, provider changes or host security-warning bypasses in its prerequisites.
- [ ] Treat an OS firmware upgrade as a separate action with separate approval and reset/recovery risk. Do not promise that it cannot reset a device.
- [ ] Verify real-device full address, exact PRL amount, fee, change, warnings, approval and cancellation on every model.
- [ ] Measure physical app/OS stack, heap, fragmentation, code size, review duration and maximum-16-input signing latency. Preserve the distinction between release code and test instrumentation.
- [ ] Test physical disconnect, lock, timeout, restart, interrupted review, malformed/nested APDUs and repeated/partial button or touch events.

## Ledger review, audit and owner-controlled delivery

- [ ] An optional early independent human security preflight may precede vendor review; do not label AI/source review a required publication audit.
- [ ] Obtain Ledger functional validation and confirm the current five-model scope, including Nano Gen5, **before** commissioning the approved-partner publication audit required by Ledger's process.
- [ ] Obtain the required approved-partner human security audit, resolve findings, and have Ledger review the report. Audit commissioning/costs require the owner's separate approval.
- [ ] Prepare the approved source/PR, exact artifacts and CI evidence, icons, support/contact details, tutorial, companion and real-device demonstration video. Do not invent identity, contact or entity information.
- [ ] Owner specifically approves private-source sharing, vendor/auditor submission, public release and applicable publication/maintenance/liability terms before any such action. Preparation is not consent to send or agree.
- [ ] Confirm the actual catalog/test-provider deployment and its eligibility with Ledger. A My Ledger device-app listing does not automatically provide first-class Pearl asset support in Ledger Wallet; that is a separate vendor integration process.

Official references: [loading restrictions](https://developers.ledger.com/docs/device-app/beginner/vscode-extension), [development sideload model list](https://github.com/LedgerHQ/app-boilerplate-rust/blob/0f857a78085678a26b332cf99128e22c0e5a6bde/tools/sideload/README.md), [deployment process](https://developers.ledger.com/docs/device-app/submission-process/process), [functional-validation/audit order](https://developers.ledger.com/docs/device-app/submission-process/deliverables/security-audit), [submission form](https://developers.ledger.com/docs/device-app/submission-process/submission-form), [documentation](https://developers.ledger.com/docs/device-app/submission-process/deliverables/documentation), [publication terms](https://developers.ledger.com/docs/device-app/submission-process/deliverables/legal), [OS-update risk](https://support.ledger.com/fr/article/8458939792669-zd).

Public distribution must not describe this app as Ledger-approved, physically validated, professionally audited, quantum-safe or equal in security to the Bitcoin app merely because it uses Ledger primitives or passes software tests.
