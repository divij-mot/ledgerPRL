# Implementation and verification status

This is development software for conventional Ledger seed custody. It has not passed an independent human audit, Ledger review, physical-device validation or production-release acceptance.

## Workstreams

- Rust no-std canonical transaction parser, policy, BIP341 digest and APDU session state.
- Native Ledger Rust SDK app, SDK BIP340 signing boundary and physical clear-signing screens.
- Exact-integer TypeScript protocol/transaction SDK and CLI.
- Minimal local watch-only companion, explicit public snapshot import and narrow node bridge.
- Independent recurring security review, differential vectors, CI and dependency/secret checks.

## Explicit gates

Tests and results will be recorded as they run. At this initial protocol checkpoint, implementation unit tests, firmware builds, Speculos, local Pearl acceptance and physical-device checks have not run. The 16-input cap is a development bound, not a hardware benchmark result. Full address-history discovery, human audit, vendor review, physical-device installation, and mainnet fund movement must never be inferred from host tests.

Only deterministic public test fixtures may appear in this repository. The runtime companion has no mnemonic, private-key or software-signing fallback. An already securely initialized Ledger must keep its existing recovery material solely under the owner's control.
