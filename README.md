# Pearl Ledger

A native Rust Ledger signer and minimal watch-only companion for Pearl (PRL).

**Development software. Do not use with valuable funds.** Software and emulator tests do not establish Ledger approval, physical-device validation, human audit, or security equivalence to Ledger's Bitcoin app. Existing Ledger seeds must never be reset or imported into the companion.

## What is implemented

- Bounded no_std transaction parser and APDU state machine with strict network/path/amount policy
- Native Ledger SDK BIP32/BIP340 integration, independently derived ownership/change and trusted transaction review
- Exact bigint TypeScript SDK, signature verification, transaction finalization and CLI
- Local watch-only GUI, fixed-endpoint public indexing and optional authenticated local-node bridge
- Public deterministic cross-language vectors, actual Pearl script-engine oracle, adversarial tests and ongoing security review

Only ordinary no-script BIP86 P2TR owned inputs/change, one recipient, at most one change, at most 16 inputs and SIGHASH_DEFAULT are supported. The input cap still needs physical-device measurement. No arbitrary hash/message signing, seed entry, hot-wallet fallback, XMSS, script-path signing, RBF or automated consolidation.

## Run the companion locally

Requirements: Node.js 24.19 or newer compatible 24.x release and npm. Use a WebHID-capable desktop browser such as current Chromium. Hardware connection requires a compatible app already running on the Ledger; development installation is a separate gated step.

```sh
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:5173. The public-indexer option requires an explicit privacy choice before derived addresses are queried. Mainnet and Testnet2 use distinct, genesis-checked backends. Original testnet, regtest and simnet require an appropriate node. Public account import/offline inspection does not prove spendability or sign anything.

The frontend and narrow light-service proxy run locally together. No public web deployment is needed. See [companion instructions](docs/companion.md) for node-backed mode, recovery metadata and limitations.

## Verify source and fixtures

Host Rust tests use Rust 1.99.0 with Clippy and rustfmt, matching CI. The core library declares Rust 1.81, but its locked test dependencies need newer Rust; that library minimum is not a supported host-test toolchain. Native firmware uses its separate pinned nightly described below.

```sh
npm run check
cargo +1.99.0 test --locked --workspace
cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings
(cd tools/pearl-oracle && go run -mod=readonly . ../../fixtures/protocol-v1.json)
```

The oracle requires Go 1.26.6 and pins the upstream Pearl implementation. Runtime code has no software signer; deterministic test signing stays in test-only fixture generation. Never fund published test addresses.

Native builds are separate from host tests. See [firmware build and verification](docs/firmware.md). No command in the default host test/build flow installs an app on a physical Ledger, updates firmware or broadcasts money.

## Documentation

- [Security model and boundaries](SECURITY.md)
- [Canonical protocol](docs/protocol-v1.md)
- [Recorded test evidence](docs/test-evidence.md)
- [Implementation and release gates](docs/implementation-status.md)
- [Recovery and safe migration](docs/recovery.md)
- [FP8 compatibility](docs/fp8-compatibility.md)
- [Public backend evidence and limitations](docs/backend-evidence.md)
- [Submission preparation](docs/submission-checklist.md)
- [Licensing status](docs/licensing.md)

This provides conventional secure-element custody. It does not claim quantum resistance. A project license has not yet been selected; preserve all third-party licenses and notices.
