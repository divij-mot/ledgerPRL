# Pearl Ledger

A Pearl (PRL) wallet with one interface for local SPV use and hosted Ledger Wallet Discover, backed by a narrowly adapted Ledger Bitcoin device app and exact-integer host adapter.

**Development software. Do not use with valuable funds.** Limited emulator and Nano S Plus physical tests have passed. The [local mainnet checkpoint](tools/local-mainnet-review/README.md) observed a real incoming payment and confirmations; later browser verification showed a confirmed outgoing payment in the sender wallet’s synced view. This is not independent observation in the recipient wallet. These tests do not establish Ledger approval, a human security audit or security equivalence to Ledger's Bitcoin app. Existing Ledger seeds must never be reset or imported into the companion.

## Two ways to use the same wallet

| Mode | Open | Chain data and connection |
| --- | --- | --- |
| Local | `python3 scripts/run-local.py` opens `http://127.0.0.1:5188/` | Native Pearl SPV on this computer; direct Ledger WebHID in desktop Chrome/Edge |
| Hosted | [Hosted Discover entry](https://pearl-ledger-wallet.vercel.app/live.html) inside Ledger Wallet Discover | Fixed Pearl public-indexer service; Ledger Wallet API on desktop/Android |
| Hosted browser | [Hosted browser wallet](https://pearl-ledger-wallet.vercel.app/) | Same public-indexer flow; direct WebHID in desktop Chrome/Edge |

**Hosted production is live.** Release [`fca78a8`](https://github.com/divij-mot/ledgerPRL/commit/fca78a828362ea2d65cfe10872ca57626c52b866) passed 17 live boundary checks and all 15 public files matched the reviewed build. See the [release evidence](tools/hosted-wallet-review/release.md). The [hosted Discover manifest](apps/companion/ledger-live.hosted.manifest.json) passed schema checks and was subsequently imported with owner approval into desktop Ledger Wallet; its exact hosted page opened at Add account. Hosted clients need no running Mac or native helper. Android is a source-supported target: responsive browser and simulated Wallet API checks do not qualify the real Android app, camera permissions, USB/BLE or device flows. Public Discover listing and device-app distribution still require Ledger's separate approval.

The UI is shared: Send/Receive, verified receive QR, camera/image payment-QR input, Max, fee choices, transaction history and recovery. Fast/Medium/Slow retain equal-priced options and show brief block-target time estimates; active Amount screens refresh anonymous fee quotes before their 120-second expiry. Hosted functions are stateless: no application database, account profile or server wallet cache. Public account metadata, cached display data and payment journals stay in the client browser. Cached balances never restore spend validation or a device approval.

Local mode validates chain data with the pinned official Pearl wallet/Neutrino implementation; hosted mode trusts the selected indexer's chain/history answers while checking genesis, raw transactions, ownership and consistency. These are different trust models. Both keep signing keys on Ledger. Fee estimates in either mode use address-free requests to the fixed public service; a fee-service outage does not invalidate the local SPV account.

## What is implemented

- Pinned Ledger Bitcoin 2.5.1 C baseline with explicit PRL networks, BIP86 ownership/change checks, PSBT validation and trusted device review
- Exact bigint PRL host adapter, independently verified signatures, transaction finalization and CLI
- Direct Ledger DMK/WebHID website; no MetaMask, seed entry or software signing required
- Local mainnet account discovery through pinned official Pearl wallet/Neutrino code, with native XMSS/ZK verification libraries
- Durable browser payment recovery/display cache, automatic Medium fees with Fast/Slow/Custom/Max, local QR decoding and an optional authenticated local-node bridge
- Public deterministic cross-language vectors, actual Pearl script-engine oracle, adversarial tests and ongoing security review

Only ordinary no-script BIP86 P2TR owned inputs/change, one P2TR or P2MR recipient, at most one change, at most 16 inputs and SIGHASH_DEFAULT are supported. The input cap still needs physical-device measurement. P2MR recipients do not imply P2MR/XMSS custody. No arbitrary hash/message signing, seed entry, hot-wallet fallback, XMSS, script-path signing, RBF or automated consolidation.

## Run the companion locally

Requirements: Node.js 24.19 or a newer compatible 24.x release, npm and Python 3. Building the native light client also requires Go (the build selects 1.26.6), Rust/Cargo with the 1.90.0 toolchain, a C compiler and make. The build downloads pinned upstream source and dependencies. Hardware connection requires the matching app already running on Ledger; installing it remains a separate user-approved step.

Intended build/test targets are Nano S Plus, Nano X, Stax, Flex and Nano Gen5. The original Nano S is not implemented. The current C source passed bounded mainnet/regtest Nano S Plus emulator tests, including P2MR recipients and 75 hostile-request rejections. The current Pearl 0.1.0 app was installed with owner approval on one Nano S Plus, OS 1.7.0; account and Receive verification passed in actual Ledger Discover, and existing funds were unchanged. The earlier synthetic HID signing pilot remains separate evidence for its recorded artifact. Current C firmware also passed the [16-check real regtest roundtrip](tools/hosted-wallet-review/simulator/README.md), including P2TR/P2MR signing, node acceptance and mined confirmation. Other models, physical P2MR review, restore, fault and maximum-input matrices remain unqualified. See the [native evidence](tools/live-app-native-review/README.md), [physical evidence](tools/live-app-physical-review/README.md) and [model-specific installation limits](docs/firmware.md#installation-is-a-separate-gate). Retail Nano X installation requires Ledger's distribution route; emulator support does not provide a sideloading workaround.

The current firmware has Bluetooth disabled. Standalone browser connection uses USB WebHID in desktop Chrome/Edge; Safari, Firefox and standalone mobile browsers are not qualified. Android Discover uses the host Wallet API and remains unqualified on an actual Android device. The website does not install the Ledger app or update Ledger OS.

**Publication route unresolved:** Ledger's [current policy](https://developers.ledger.com/docs/device-app/getting-started) requires Rust for new device apps. Its [Bitcoin clone guidance](https://developers.ledger.com/docs/device-app/integration/how-to/clone) describes Layer-2 extensions, which does not establish an exception for this separate-chain C fork. Ledger must confirm the accepted route. My Ledger app listing requires its review/audit process and does not itself provide Pearl asset management inside Ledger Wallet. See the [distribution review](tools/ledger-distribution-review/README.md).

```sh
python3 scripts/run-local.py
```

Keep the terminal running. After its server starts, the launcher opens **http://127.0.0.1:5188/** for a direct Ledger WebHID connection; use desktop Chrome or Edge. The separate **`/live.html`** entry is for Ledger Wallet Discover. Hosted Discover can run independently of this computer; [local manifest setup](docs/live-app.md) is a development option. The launcher checks Node, installs the exact npm lockfile with lifecycle scripts disabled, and rebuilds the native helper only when its manifest/source set/source hashes or executable identity are missing or stale. It then uses the existing `npm start` frontend build and foreground server. Stop an older local server before rerunning it; Ctrl-C stops the foreground app. No global tools or shell-profile configuration are installed. The explicit `npm run setup:light` and `npm start` commands remain available. The helper communicates over private standard I/O and runs no wallet RPC listener. No cloud deployment or separate wallet GUI is needed.

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

The Discover entry uses Ledger Wallet API and adapted Ledger Bitcoin views with Lumen UI; the local launcher opens the direct WebHID entry. See [setup and verification](docs/live-app.md). The same PRL wallet and Bitcoin-derived signing checks back both interfaces.
