# Implementation and verification status

Development checkpoint, 2026-10-09. This is conventional Ledger seed custody software, not an audited or vendor-approved release. No physical-device validation or real-funds transaction has been performed.

## Implemented software

- Rust no_std parser, exact monetary policy, BIP341 digest, ownership/change validation and fail-closed APDU session state
- Native Ledger SDK BIP32/BIP340 signer with clear account/address/transaction review, fee/path warnings and transport lifecycle hardening
- Exact bigint TypeScript protocol SDK, independent signature verification, transaction finalization and CLI
- Local watch-only GUI, public Blockbook discovery, exact previous-transaction checks, recovery metadata, reservations and optional authenticated node bridge
- Cross-language fixtures, pinned actual Pearl script-engine oracle and independent recurring code/security review

## Demonstrated so far

Native Nano S Plus firmware on stable API27 SDK runs in Speculos without an API override. An integrated test used real native-app account export/address review/signing, mined 101 blocks on an isolated actual Pearl simnet node, signed two inputs with recipient and change, rejected a changed witness, accepted and confirmed the genuine transaction, refreshed wallet state and exercised chain invalidation/reconsideration. No software signer was substituted for the Ledger app.

Rust unit/property/differential/no_std checks and TypeScript SDK/wallet/bridge tests pass at recorded checkpoints. Host production build passes. Public backend HTTPS/genesis/raw transaction interfaces were checked read-only; backend pagination and mempool nuances are explicitly handled or fail closed. See test-evidence.md and e2e-evidence.md for exact version-specific evidence.

## Ongoing and external gates

Five-model stable-firmware matrix and adversarial emulator tests are ongoing. Public API behavior, full UI interruption/recovery, final exact-commit CI, resource/latency bounds and dependency review continue. The 16-input cap is a development bound pending physical worst-case measurements. Human audit, physical screen/signing/restore checks, Ledger functional/submission review, production packaging and project licensing remain release gates. No mainnet broadcast, physical app install, seed reset or firmware update has been performed.

Passing emulator tests does not imply hardware equivalence or guarantee Bitcoin-app security parity. The host trusts a selected backend's chain view; it is not an independent Pearl SPV proof verifier. XMSS/PQ-only signing remains outside this version.
