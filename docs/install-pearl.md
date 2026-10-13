# Install Pearl on your Ledger

The installer builds Pearl from source and verifies the image for your device before loading it. Installation uses USB, including on devices that will later connect over Bluetooth.

## Requirements

Install **Python 3.11 or later**, **Git**, and **Docker**, then start Docker. Open Terminal in the repository folder.

| Model | SDK API-27 OS mapping | Connection | Installer target |
| --- | --- | --- | --- |
| Nano S Plus | 1.7.0 | USB | `nano-s-plus` |
| Nano X | 2.8.0 | USB / Bluetooth | Build only; retail installation requires Ledger distribution |
| Stax | 1.11.0 | USB / Bluetooth | `stax` |
| Flex | 1.7.0 | USB / Bluetooth | `flex` |
| Nano Gen5 | 1.2.0 | USB / Bluetooth | `gen5` |

Check your device’s **Settings → About** against the [SDK compatibility mapping](https://github.com/LedgerHQ/ledger-secure-sdk#about-api_level-branches). Original Nano S is unsupported.

## Version selection

[release.json](../apps/ledger-bitcoin-prl/release.json) pins the source, device targets and image hashes used by the installer. It currently specifies **0.1.4**, while this branch’s app source is **0.1.5**. The commands below stop at source verification until the release manifest and source match.

## Install

For Nano Gen5:

```sh
python3 scripts/install-pearl.py gen5 --install
```

Replace `gen5` with `nano-s-plus`, `flex` or `stax` for your device.

1. Close Ledger Wallet and any browser connection to the device.
2. Connect the Ledger by USB, unlock it and leave it on the dashboard.
3. Run the command and approve the Manager and Pearl installation prompts.
4. Open Pearl and check that its version matches `release.json`.

The command downloads the pinned SDK and builder, builds in an isolated temporary folder, verifies the image, and prepares a Python loader environment. The first build can take several minutes. Installation does not require your recovery phrase or a device reset.

## Replace an existing installation

To replace only the installed Pearl app:

```sh
python3 scripts/install-pearl.py gen5 --install --replace
```

The replacement image is checked before the existing Pearl app is removed. If loading fails afterward, rerun the installation after resolving the reported error. Plain `--install` does not delete an existing app.

## Open the wallet

- **Desktop:** open [pearl-ledger-wallet.vercel.app](https://pearl-ledger-wallet.vercel.app/) in Chrome or Edge and connect by USB.
- **iPhone or Android:** use Pearl in Ledger Wallet Discover. Follow the [Discover setup guide](live-app.md#load-the-hosted-entry-in-discover).
- **Local instance:** run `python3 scripts/run-local.py` from the repository folder. It opens the wallet at `http://127.0.0.1:5188/`.

Use **Receive** to verify an address on the Ledger. When sending, review the recipient, amount and fee on the device before approving.

If a device review remains open after disconnecting or closing the wallet, reject it on the Ledger before reconnecting.

## Build without installing

Omit `--install`:

```sh
python3 scripts/install-pearl.py gen5
```

The command prints the verified image location. Use `--sdk /path/to/ledger-secure-sdk` to reuse a clean checkout of the pinned SDK. The same source and image checks apply to build-only commands.
