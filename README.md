# Pearl Ledger

A Ledger-backed wallet website for Pearl (PRL), with a narrowly adapted Ledger Bitcoin device app and exact-integer PRL host adapter.

**Development software. Do not use with valuable funds.** Limited emulator and Nano S Plus physical tests have passed; funded sending and live-chain confirmation remain unverified. These tests do not establish Ledger approval, a human security audit or security equivalence to Ledger's Bitcoin app. Existing Ledger seeds must never be reset or imported into the companion.

## What is implemented

- Pinned Ledger Bitcoin 2.5.1 C baseline with explicit PRL networks, BIP86 ownership/change checks, PSBT validation and trusted device review
- Exact bigint PRL host adapter, independently verified signatures, transaction finalization and CLI
- Direct Ledger DMK/WebHID website; no MetaMask, seed entry or software signing required
- Browser-side public-account discovery and validation; same-origin fixed-endpoint public indexer proxy
- Durable local payment recovery, optional watch cache and optional local-only authenticated node bridge
- Public deterministic cross-language vectors, actual Pearl script-engine oracle, adversarial tests and ongoing security review

Only ordinary no-script BIP86 P2TR owned inputs/change, one P2TR or P2MR recipient, at most one change, at most 16 inputs and SIGHASH_DEFAULT are supported. The input cap still needs physical-device measurement. P2MR recipients do not imply P2MR/XMSS custody. No arbitrary hash/message signing, seed entry, hot-wallet fallback, XMSS, script-path signing, RBF or automated consolidation.

## Run the companion locally

Requirements: Node.js 24.19 or newer compatible 24.x release and npm. Use a WebHID-capable desktop browser such as current Chromium. Hardware connection requires a compatible app already running on the Ledger; development installation is a separate gated step.

Intended build/test targets are Nano S Plus, Nano X, Stax, Flex and Nano Gen5. The original Nano S is not implemented. The current C source passed bounded mainnet/regtest Nano S Plus emulator tests, including P2MR recipients and 75 hostile-request rejections. One physical Nano S Plus on OS 1.7.0 passed Live App account/receive verification and a separate synthetic HID signing pilot. Other models, physical P2MR review, restore, fault and maximum-input matrices remain unqualified. See the [native evidence](tools/live-app-native-review/README.md), [physical evidence](tools/live-app-physical-review/README.md) and [model-specific installation limits](docs/firmware.md#installation-is-a-separate-gate). Retail Nano X installation requires Ledger's distribution route; emulator support does not provide a sideloading workaround.

The current app and companion are **USB-only**: Bluetooth is disabled in the C app and the website uses WebHID. Desktop Chrome/Edge on HTTPS or loopback are intended test targets; mobile, Safari and Firefox are not qualified. The website does not install the Ledger app or update Ledger OS.

**Publication route unresolved:** Ledger's [current policy](https://developers.ledger.com/docs/device-app/getting-started) requires Rust for new device apps. Its [Bitcoin clone guidance](https://developers.ledger.com/docs/device-app/integration/how-to/clone) describes Layer-2 extensions, which does not establish an exception for this separate-chain C fork. Ledger must confirm the accepted route. My Ledger app listing requires its review/audit process and does not itself provide Pearl asset management inside Ledger Wallet. See the [distribution review](tools/ledger-distribution-review/README.md).

```sh
npm ci --ignore-scripts
npm run dev
```

Open http://127.0.0.1:5188. The public-indexer option requires an explicit privacy choice before derived addresses are queried. Mainnet and Testnet2 use distinct, genesis-checked backends. Original testnet, regtest and simnet require an appropriate node. Public account import/offline inspection does not prove spendability or sign anything.

The frontend and narrow proxy can run locally together or behind HTTPS using the production host described in [website hosting](docs/website-hosting.md). The public website does not expose the local-node bridge. The latest mainnet and Testnet2 checks timed out before TCP/TLS connection or address queries; no live balance was established. See [mainnet testing](docs/mainnet-testing.md) for the intended small user-run trial, and [companion instructions](docs/companion.md) for recovery metadata and limitations.

Private keys remain on Ledger. The browser keeps receive/change recovery ranges and payment reservations, including already-signed bytes. Optional watch-cache saves also contain the account public key and chain code. These records contain no private signing keys but are financially sensitive; do not publish backups. The hosted proxy sees requested addresses/transaction IDs, not account derivation keys.

## Verify source and fixtures

Host Rust tests use Rust 1.99.0 with Clippy and rustfmt, matching CI. The core library declares Rust 1.81, but its locked test dependencies need newer Rust; that library minimum is not a supported host-test toolchain. Native firmware uses its separate pinned nightly described below.

```sh
npm run check
cargo +1.99.0 test --locked --workspace
cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings
(cd tools/pearl-oracle && go run -mod=readonly . ../../fixtures/protocol-v1.json)
```

The oracle requires Go 1.26.6 and pins the upstream Pearl implementation. The wallet has no software-signing workflow, private-key input or software-signing fallback. General-purpose cryptographic dependencies also contain signing APIs, but production wallet flows do not call them; deterministic test signing stays in test-only fixture generation. Never fund published test addresses.

The current device port is documented in [Ledger Bitcoin PRL port](apps/ledger-bitcoin-prl/README.md), with [redesign boundaries](docs/ledger-bitcoin-redesign.md). The earlier Rust app, its protocol and historical evidence remain in the repository as a reference; those results do not qualify the new C app. Native builds are separate from host tests. See [historical firmware build and verification](docs/firmware.md). No command in the default host test/build flow installs an app on a physical Ledger, updates firmware or broadcasts money.

## Documentation

- [Security model and boundaries](SECURITY.md)
- [Current C-port protocol](apps/ledger-bitcoin-prl/README.md)
- [Historical Rust canonical protocol](docs/protocol-v1.md)
- [Recorded test evidence](docs/test-evidence.md)
- [Historical Rust native qualification](tools/native-release-qualification/README.md)
- [Exact-build reproduction and limits](tools/build-reproducibility/README.md)
- [Implementation and release gates](docs/implementation-status.md)
- [Recovery and safe migration](docs/recovery.md)
- [Current lite-client feature coverage](docs/prl-feature-coverage.md#current-desktoplite-parity)
- [Mainnet trial and current blockers](docs/mainnet-testing.md)
- [FP8 compatibility](docs/fp8-compatibility.md)
- [Public backend evidence and limitations](docs/backend-evidence.md)
- [Submission preparation](docs/submission-checklist.md)
- [Licensing status](docs/licensing.md)

This provides conventional secure-element custody. It does not claim quantum resistance. A project license has not yet been selected; preserve all third-party licenses and notices.

## Ledger Wallet integration

The companion also has an explicit developer-loaded Live App entry using Ledger Wallet API and Ledger Lumen UI. See [setup and verification](docs/live-app.md). The same PRL wallet and Bitcoin-derived signing checks back both interfaces.
