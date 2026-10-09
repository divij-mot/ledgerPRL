# Implementation and verification status

Development checkpoint, 2026-10-09, approximately 22:42 UTC. This is conventional Ledger seed custody software, not an audited or vendor-approved release. No physical-device validation or real-funds transaction has been performed. The current device application is the [Ledger Bitcoin-based C port](../apps/ledger-bitcoin-prl/README.md); the previous Rust device application and its qualification records are historical reference only.

## Implemented software

- Restricted Ledger Bitcoin 2.5.1 C adaptation with PRL network/monetary policy, committed PSBT validation, BIP86 ownership/change checks and Ledger SDK BIP32/BIP340 signing after trusted review
- Exact bigint TypeScript PSBT adapter, independent signature verification, transaction finalization and CLI
- Standalone seedless DMK/WebHID wallet website, browser-side public-account discovery/validation, a fixed-endpoint same-origin indexer proxy and an optional local authenticated node bridge
- Public/full watch-only backups, durable payment reservations and signed-byte recovery, bounded stored-journal validation, atomic merge-on-success, optional watch-cache deletion and account-context form reset
- Cross-language fixtures, pinned actual Pearl script-engine oracle and bounded independent software/source reviews; the optional MetaMask experiment is outside the direct website flow

## Current C-port and website evidence

- [Host integrity/privacy checkpoint](../tools/host-checkpoint-review/README.md): workspace typechecks, 415 tests (27 adapter, 64 optional Snap, 103 SDK, 86 wallet, 6 CLI and 129 companion), production builds and the tracked-file secret-pattern scan passed on the working source. This is local evidence for the recorded build, not final published-commit CI or native-device qualification.
- [Wallet recovery/storage review](../tools/wallet-property-review/REPORT.md): malformed stored reservations and non-atomic direct merge rejection were reproduced and fixed. One campaign passed 12,447 seeded cases with unchanged observed source hashes. A second 12,447-case run records a concurrent UI edit and is not a frozen whole-tree result. Very large journals can still pause on their first structural validation; modeled storage tests do not prove browser crash durability.
- [Website privacy review](../tools/website-privacy-review/REPORT.md): no production private-key input/export or software-signing workflow/fallback was found. Generic dependency signing APIs remain bundled. Account material, journals and signed bytes remain sensitive; no privacy guarantee against same-origin code, extensions or profile access is claimed.
- [Actual browser public-fixture review](../apps/companion/test/evidence/website-qa/astra-real-browser-2026-10-09.md): 12 bounded cases passed on main bundle `index-B9WJtHC4.js`, SHA-256 `4062ec6b173da7cb05dbc27a91928225571530a88171b47d2fbde8f1b4b671e0`. Coverage includes explicit restore, form clearing, optional-cache deletion and preservation of existing draft/range state across reload. It does not establish file imports, cross-tab races, crash/eviction recovery, WebHID/device signing, live-chain behavior or public TLS hosting.
- [Public-indexer review](../tools/public-indexer-review/README.md): 18 existing and six independent offline cases passed. The fresh production-client live probe was cancelled and produced zero usable observations; current service availability and deployed proxy integration remain unverified. Earlier backend observations are historical.
- [C-port source review](../tools/device-source-review/README.md): two low-severity continuation-body validation gaps remain unfixed. This static review did not establish a private-key export, approval bypass or transaction-substitution defect, and does not prove their absence.
- [Earlier C-port emulator checkpoint](../tools/bitcoin-prl-independent-review/README.md): narrow native/oracle results bind to Nano S Plus ELF `8e45823f822fbc675dcd2e2c0868667905e4e26e64a711dc62fec0392febf737`. Later ELF/source candidates require their own evidence; the observed source-hash list is not a build-to-source proof. Native/emulator execution is currently paused after a blocked test. No final current-source native matrix is claimed.

## Historical previous-Rust application evidence

The following retained results describe `apps/ledger`, its historical protocol and the source/artifact identities in the linked reports. They do not qualify `apps/ledger-bitcoin-prl`, its PSBT protocol or any later C-port ELF.

Native Nano S Plus, Nano X, Stax, Flex and Nano Gen5 firmware on stable API27 SDK runs in Speculos without an API override. Frozen release binaries passed local Pearl simnet signing, rejection, confirmation, wallet refresh and chain invalidation/reconsideration at the 16-input bound. Independent probes covered distinct keys and all tweak parity combinations. No software signer was substituted for the Ledger app. Exact source, binary and toolchain provenance is retained with the evidence.

The [native evidence](../apps/ledger/tests/evidence/README.md) includes five-model smoke/warning/lifecycle tests, trusted-display review, repeated-session stability, separate instrumented resource measurements and offline package verification. The later [final-source qualification](../tools/native-release-qualification/README.md) covers all 25 model/network builds, all 25 offline packages, and 30 simnet runtime suites across the five models. The original Nano S is not implemented; retail Nano X physical testing still needs Ledger's distribution route.

Rust unit/property/differential/no_std checks and TypeScript SDK/wallet/bridge tests passed at recorded earlier checkpoints. Historical public-backend and empty-state browser observations retain their original scope. See [test evidence](test-evidence.md), [node integration evidence](e2e-evidence.md) and [companion qualification limits](companion.md#verification-and-remaining-qualification).

## Ongoing and external gates

The previous Rust application's 25 artifacts/packages were independently reproduced byte-for-byte under its [canonical logical-path build recipe](../tools/build-reproducibility/README.md); this is not C-port reproducibility evidence. Final C-port source-linked build/package reproduction, authorized native replay and resolution of the two source-review findings remain open. Each historical ELF keeps its own evidence; results cannot be combined into qualification of a later artifact.

Actual supported retail devices/OS combinations, physical screens/signing/restore and worst-case resource/16-input measurements remain unqualified. Complete loaded-browser/import/cross-tab/interruption coverage, public TLS deployment, fresh live-indexer compatibility, final exact-published-commit CI for the new changes, independent human/dependency review, Ledger functional/distribution review, production packaging and project licensing remain release gates. No mainnet broadcast, physical app install, seed reset or firmware update has been performed.

Passing emulator tests does not imply hardware equivalence or guarantee Bitcoin-app security parity. The host trusts a selected backend's chain view; it is not an independent Pearl SPV proof verifier. XMSS/PQ-only signing remains outside this version.
