# Implementation and verification status

Development checkpoint, 2026-10-09. This is conventional Ledger seed custody software, not an audited or vendor-approved release. No physical-device validation or real-funds transaction has been performed.

## Implemented software

- Rust no_std parser, exact monetary policy, BIP341 digest, ownership/change validation and fail-closed APDU session state
- Native Ledger SDK BIP32/BIP340 signer with clear account/address/transaction review, fee/path warnings and transport lifecycle hardening
- Exact bigint TypeScript protocol SDK, independent signature verification, transaction finalization and CLI
- Local watch-only GUI, public Blockbook discovery, exact previous-transaction checks, public/full watch-only backups, durable reservations, explicit identical-payment recovery after interrupted signing and optional authenticated node bridge
- Cross-language fixtures, pinned actual Pearl script-engine oracle and independent recurring code/security review

## Demonstrated so far

Native Nano S Plus, Nano X, Stax, Flex and Nano Gen5 firmware on stable API27 SDK runs in Speculos without an API override. Frozen release binaries passed local Pearl simnet signing, rejection, confirmation, wallet refresh and chain invalidation/reconsideration at the 16-input bound. Independent probes covered distinct keys and all tweak parity combinations. No software signer was substituted for the Ledger app. Exact source, binary and toolchain provenance is retained with the evidence.

The [native evidence](../apps/ledger/tests/evidence/README.md) includes five-model smoke/warning/lifecycle tests, trusted-display review, repeated-session stability, separate instrumented resource measurements and offline package verification. Retained builds cover mainnet/simnet on all five targets plus testnet/testnet2/regtest on Nano S Plus, not every model/network combination. The original Nano S is not implemented; retail Nano X physical testing still needs Ledger's distribution route.

Rust unit/property/differential/no_std checks and TypeScript SDK/wallet/bridge tests pass at recorded checkpoints. Host production build passes. Public backend HTTPS/genesis/raw transaction interfaces were checked read-only; backend pagination and mempool nuances are explicitly handled or fail closed. Actual built-desktop empty-state rendering/navigation was reviewed in a cloud browser; loaded-account imports, real IndexedDB interruption/recovery and hardware connection were not covered. See [test evidence](test-evidence.md), [node integration evidence](e2e-evidence.md) and [companion qualification limits](companion.md#verification-and-remaining-qualification) for scope.

## Ongoing and external gates

Five-model stable-SDK builds and adversarial emulator workflows have passed at the recorded snapshots; final release artifacts still require reproduction across every intended model/network and actual OS compatibility checks. Instrumented app-level memory measurements remain separate from release-binary host-observed timing. Public API behavior, full browser interruption/recovery, final exact-commit CI and dependency review continue. The 16-input cap remains a development bound pending physical worst-case measurements. Human audit, physical screen/signing/restore checks, Ledger functional/submission review, reproducible production packaging and project licensing remain release gates. No mainnet broadcast, physical app install, seed reset or firmware update has been performed.

Passing emulator tests does not imply hardware equivalence or guarantee Bitcoin-app security parity. The host trusts a selected backend's chain view; it is not an independent Pearl SPV proof verifier. XMSS/PQ-only signing remains outside this version.
