# Pearl Ledger

A local Pearl (PRL) wallet in Ledger Wallet Discover, with a narrowly adapted Ledger Bitcoin device app, exact-integer host adapter and native watch-only light client.

**Development software. Do not use with valuable funds.** Limited emulator and Nano S Plus physical tests have passed. The [local mainnet checkpoint](tools/local-mainnet-review/README.md) observed a real incoming payment and confirmations; outgoing hardware signing, broadcast and destination confirmation remain unverified. These tests do not establish Ledger approval, a human security audit or security equivalence to Ledger's Bitcoin app. Existing Ledger seeds must never be reset or imported into the companion.

## What is implemented

- Pinned Ledger Bitcoin 2.5.1 C baseline with explicit PRL networks, BIP86 ownership/change checks, PSBT validation and trusted device review
- Exact bigint PRL host adapter, independently verified signatures, transaction finalization and CLI
- Direct Ledger DMK/WebHID website; no MetaMask, seed entry or software signing required
- Local mainnet account discovery through pinned official Pearl wallet/Neutrino code, with native XMSS/ZK verification libraries
- Durable local payment recovery, optional watch cache and optional local-only authenticated node bridge
- Public deterministic cross-language vectors, actual Pearl script-engine oracle, adversarial tests and ongoing security review

Only ordinary no-script BIP86 P2TR owned inputs/change, one P2TR or P2MR recipient, at most one change, at most 16 inputs and SIGHASH_DEFAULT are supported. The input cap still needs physical-device measurement. P2MR recipients do not imply P2MR/XMSS custody. No arbitrary hash/message signing, seed entry, hot-wallet fallback, XMSS, script-path signing, RBF or automated consolidation.

## Run the companion locally

Requirements: Node.js 24.19 or a newer compatible 24.x release, npm and Python 3. Building the native light client also requires Go (the build selects 1.26.6), Rust/Cargo with the 1.90.0 toolchain, a C compiler and make. The build downloads pinned upstream source and dependencies. Hardware connection requires the matching app already running on Ledger; installing it remains a separate user-approved step.

Intended build/test targets are Nano S Plus, Nano X, Stax, Flex and Nano Gen5. The original Nano S is not implemented. The current C source passed bounded mainnet/regtest Nano S Plus emulator tests, including P2MR recipients and 75 hostile-request rejections. One physical Nano S Plus on OS 1.7.0 passed Live App account/receive verification and a separate synthetic HID signing pilot. Other models, physical P2MR review, restore, fault and maximum-input matrices remain unqualified. See the [native evidence](tools/live-app-native-review/README.md), [physical evidence](tools/live-app-physical-review/README.md) and [model-specific installation limits](docs/firmware.md#installation-is-a-separate-gate). Retail Nano X installation requires Ledger's distribution route; emulator support does not provide a sideloading workaround.

The current app and companion are **USB-only**: Bluetooth is disabled in the C app and the website uses WebHID. Desktop Chrome/Edge on HTTPS or loopback are intended test targets; mobile, Safari and Firefox are not qualified. The website does not install the Ledger app or update Ledger OS.

**Publication route unresolved:** Ledger's [current policy](https://developers.ledger.com/docs/device-app/getting-started) requires Rust for new device apps. Its [Bitcoin clone guidance](https://developers.ledger.com/docs/device-app/integration/how-to/clone) describes Layer-2 extensions, which does not establish an exception for this separate-chain C fork. Ledger must confirm the accepted route. My Ledger app listing requires its review/audit process and does not itself provide Pearl asset management inside Ledger Wallet. See the [distribution review](tools/ledger-distribution-review/README.md).

```sh
npm ci --ignore-scripts
npm run setup:light
npm start
```

Keep the terminal running and open Pearl in Ledger Wallet → Discover using the [local manifest setup](docs/live-app.md). The app is served only at **http://127.0.0.1:5188/live.html**. `npm start` builds the frontend and starts its local server; `setup:light` builds the native helper once, and must be repeated after helper source changes. The helper communicates over private standard I/O and runs no wallet RPC listener. No cloud deployment or separate wallet GUI is needed.

The default local flow supports **mainnet account 0**. After account approval it remembers the public account, starts synchronization, and resumes on reopening. Initial header/filter synchronization can take substantial time; an incomplete account shows unavailable balance instead of a synthetic zero. Blockchain peers are still required: local means processing and storage on this computer, not offline operation. Optional public-indexer and configured-node paths remain advanced compatibility options, not dependencies of local synchronization. See [companion instructions](docs/companion.md) and [mainnet testing](docs/mainnet-testing.md) for the bounded scope and remaining funded-transfer gates.

Private keys remain on Ledger. The browser keeps receive/change recovery ranges and payment reservations, including already-signed bytes. Local account remembering and the native watch database contain the account public key and chain code. Optional balance snapshots contain public watch data. These records contain no private signing keys but are financially sensitive; do not publish backups. If optional public-indexer mode is used, its proxy sees requested addresses/transaction IDs, not account derivation keys. The default local path uses no hosted relay.

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

The primary local interface is the developer-loaded Live App using Ledger Wallet API and adapted Ledger Bitcoin views with Lumen UI. See [setup and verification](docs/live-app.md). The same PRL wallet and Bitcoin-derived signing checks back both interfaces.
