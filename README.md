# Pearl for Ledger

**Hardware use and installation paused:** a Gen5 freeze followed by a reported factory reset is under investigation. Do not install or use Pearl on hardware until resolved. See the [incident record](tools/gen5-reset-incident/README.md).

Send and receive Pearl (PRL) with your Ledger. Use the hosted wallet, or run the same interface locally with Pearl’s native light client.

**Trial software. Hardware use remains paused regardless of balance.**

## 1. Hardware installation is paused

Pearl builds for **Nano S Plus, Nano X, Stax, Flex and Nano Gen5**, with button or touchscreen layouts for each model. Earlier emulator and bounded physical checks did not cover the later reported Gen5 freeze/reset. No version is currently recommended for hardware use.

The [model support and installation guide](docs/install-pearl.md) is retained as reference. Pearl is not in the My Ledger app catalog. Never enter your recovery phrase into this wallet or reset your Ledger to install it. Original Nano S is unsupported.

The wallet setup below is reference for after the hardware hold is resolved.

## 2. Use the hosted wallet

Open **[pearl-ledger-wallet.vercel.app](https://pearl-ledger-wallet.vercel.app/)** in desktop Chrome or Edge, with your Ledger connected by USB.

1. Click **Add account** and approve the public account on your Ledger.
2. Click **Sync**.
3. Use **Receive** to verify an address on the device, or **Send** to enter a recipient and amount.
4. Review the address, amount and fee on your Ledger. After approving, choose **Send payment** in the wallet.

For Ledger Wallet’s Discover interface, follow the [Discover setup instructions](docs/live-app.md#load-the-hosted-entry-in-discover). This currently uses a locally imported app, not a public catalog listing. iPhone and Android use the Discover route; [iPhone Bluetooth setup](docs/live-app.md#iphone-with-nano-gen5-or-flex-over-bluetooth) requires Pearl 0.1.4. Earlier Gen5/iPhone account approval passed; it does not resolve the later hardware incident.

Keys stay on Ledger. The hosted service has no wallet database; account caches and payment records stay in your browser.

## 3. Or run it locally

The repository is currently **private**. Sign in to GitHub with an account that has access, then [download the latest source ZIP](https://github.com/divij-mot/ledgerPRL/archive/refs/heads/main.zip) and extract it.

Install these prerequisites first: **Python 3, Node.js 24.19+ within 24.x, npm, Go, Rust/Cargo with Rust 1.90.0, and C/C++ build tools**. Install Node using its [normal installer](https://nodejs.org/en/download), then open a new terminal. See the [platform setup details](docs/live-app.md#local-setup).

In Terminal, enter the extracted folder and run:

```sh
cd /path/to/extracted-folder
python3 scripts/run-local.py
```

The launcher prepares the locked dependencies and native helper, then opens **http://127.0.0.1:5188/**. Use Chrome or Edge. Keep the terminal open; **Ctrl-C** stops the wallet.

First build and blockchain synchronization take time. Later runs reuse the verified native helper and saved chain data in the same folder. Stop an older instance before starting another. Local sync currently supports mainnet account 0; fee estimates still use Pearl’s public service.

## More information

- [Local setup and Discover configuration](docs/live-app.md)
- [Supported features and limits](docs/prl-feature-coverage.md)
- [Security model](SECURITY.md) and [release/test evidence](tools/ux-event-review/README.md)
- [How to request a public Discover listing](docs/ledger-discover-submission.md)
- [Licensing and third-party notices](docs/licensing.md)

This is a community project, not a Ledger-approved app. Automated tests and AI reviews do not replace an independent security audit.
