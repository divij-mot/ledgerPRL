# Pearl for Ledger

Send and receive Pearl (PRL) with your Ledger. Use the hosted wallet, or run the same interface locally with Pearl’s native light client.

**Trial software. Use small amounts until independent security review is complete.**

## 1. Install Pearl on your Ledger

Pearl builds for **Nano S Plus, Nano X, Stax, Flex and Nano Gen5**, with button or touchscreen layouts for each model. Account export, Receive and signing pass in the emulator on all five. **Nano S Plus is also verified on physical hardware**; the other models still need physical-device qualification. See the [model support and installation guide](docs/install-pearl.md).

Pearl is not yet available in the My Ledger app catalog. The step-by-step installation guide currently covers **Nano S Plus, Ledger OS 1.7.0 / API 27**. Each model needs its own build; retail Nano X installation requires Ledger’s distribution process.

1. Follow the [build and installation guide](docs/install-pearl.md).
2. Unlock your Ledger, leave it on the dashboard, and approve the installation prompts.
3. Open **Pearl** on the device. If it is already installed, skip installation.

Never enter your recovery phrase into this wallet or reset your Ledger to install it. Original Nano S is not supported.

## 2. Use the hosted wallet

Open **[pearl-ledger-wallet.vercel.app](https://pearl-ledger-wallet.vercel.app/)** in desktop Chrome or Edge, with your Ledger connected by USB.

1. Click **Add account** and approve the public account on your Ledger.
2. Click **Sync**.
3. Use **Receive** to verify an address on the device, or **Send** to enter a recipient and amount.
4. Review the address, amount and fee on your Ledger. After approving, choose **Send payment** in the wallet.

For Ledger Wallet’s Discover interface, follow the [Discover setup instructions](docs/live-app.md#load-the-hosted-entry-in-discover). This currently uses a locally imported app, not a public catalog listing. Android uses the Discover route; physical Android testing remains outstanding.

Keys stay on Ledger. The hosted service has no wallet database; account caches and payment records stay in your browser.

## 3. Or run it locally

The repository is currently **private**. Sign in to GitHub with an account that has access, then [download the latest source ZIP](https://github.com/divij-mot/ledgerPRL/archive/refs/heads/main.zip) and extract it.

Install these prerequisites first: **Python 3, Node.js 24.19+ within 24.x, npm, Go, Rust/Cargo with Rust 1.90.0, and C/C++ build tools**. See the [platform setup details](docs/live-app.md#local-setup).

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
- [Security model](SECURITY.md) and [release/test evidence](tools/hosted-wallet-review/release.md)
- [How to request a public Discover listing](docs/ledger-discover-submission.md)
- [Licensing and third-party notices](docs/licensing.md)

This is a community project, not a Ledger-approved app. Automated tests and AI reviews do not replace an independent security audit.
