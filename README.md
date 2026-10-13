# Pearl for Ledger

A Pearl (PRL) wallet with transaction signing on your Ledger. Use the hosted wallet or run the same interface locally with Pearl’s native light client.

**[Open the web wallet](https://pearl-ledger-wallet.vercel.app/)** · **[Run locally](#run-locally)**

## Web wallet

Open **[pearl-ledger-wallet.vercel.app](https://pearl-ledger-wallet.vercel.app/)** in desktop Chrome or Edge with your Ledger connected by USB. The Pearl device app must already be installed.

1. Open Pearl on the Ledger and select **Add account** in the wallet.
2. Approve the public account, then select **Sync**.
3. Use **Receive** to verify an address or **Send** to enter a recipient and amount.
4. Check the address, amount and fee on the Ledger. Approve on the device, then select **Send payment** in the wallet.

On iPhone or Android, use Pearl through **Ledger Wallet Discover**. Follow the [Discover setup guide](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/docs/live-app.md#load-the-hosted-entry-in-discover) to import its manifest. Direct Safari access does not provide the Ledger Bluetooth connection.

The hosted wallet uses Pearl’s public network service. Account caches and payment records stay in your browser; the server has no wallet database. Never enter a recovery phrase or private key into the wallet.

## Run locally

Local setup supports **macOS and Linux** and does not require Codex.

[Download the source ZIP](https://github.com/divij-mot/ledgerPRL/archive/refs/heads/codex/pearl-ticker-review-fix.zip) and extract it. The repository is private, so your GitHub account needs access. This link selects the branch containing the current wallet updates.

Install **Python 3, Node.js 24.19+ within 24.x with npm, Go, Rust/Cargo with Rust 1.90.0, and C/C++ build tools**. See the [platform setup instructions](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/docs/live-app.md#local-setup).

From the extracted folder, run:

```sh
python3 scripts/run-local.py
```

The launcher prepares the dependencies and native helper, then opens **http://127.0.0.1:5188/**. Use Chrome or Edge. Keep the terminal open; **Ctrl-C** stops the wallet.

The first build and blockchain sync take time. Later runs reuse the helper and chain data. Local sync currently supports mainnet account 0; fee estimates use Pearl’s public service.

## Documentation

- [Device installation and supported models](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/docs/install-pearl.md)
- [Local setup and Ledger Wallet Discover](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/docs/live-app.md)
- [Features and limits](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/docs/prl-feature-coverage.md)
- [Security model](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/SECURITY.md)
- [Licensing](https://github.com/divij-mot/ledgerPRL/blob/codex/pearl-ticker-review-fix/docs/licensing.md)
