# Install Pearl on your Ledger

Current firmware: **Pearl 0.1.1, mainnet, API 27**. Gen5, Flex, Stax and Nano X now enable the official Ledger SDK Bluetooth transport. Nano S Plus stays USB-only.

| Model | SDK-mapped Ledger OS | Build / USB emulator | Bluetooth in 0.1.1 | Physical testing |
| --- | --- | --- | --- | --- |
| Nano S Plus | 1.7.0 | Passed | No radio | Earlier 0.1.0 tested on OS 1.7.0 |
| Nano X | 2.8.0 | Passed | Enabled | Not tested; retail sideloading unavailable |
| Stax | 1.11.0 | Passed | Enabled | Not tested |
| Flex | 1.7.0 | Passed | Enabled | Not tested |
| Nano Gen5 | 1.2.0 | Passed | Enabled | Not tested |

Compare your device’s **Settings → About** version with the table. These are the [official SDK API-27 mappings](https://github.com/LedgerHQ/ledger-secure-sdk#about-api_level-branches), checked on 10 October 2026, not a latest-OS or retail-rollout guarantee. The installer does not update Ledger OS.

The original Nano S is unsupported. Emulator tests do **not** test Bluetooth radio pairing or a real iPhone. Pearl is independently built and is not listed in My Ledger's public catalog.

## Install on Gen5 or Flex

On your Mac, install **Python 3.11 or later**, **Git**, and **Docker Desktop**, then start Docker. Download/extract this repository and open Terminal in that folder.

For **Nano Gen5**:

```sh
python3 scripts/install-pearl.py gen5 --install
```

For **Flex**:

```sh
python3 scripts/install-pearl.py flex --install
```

The command downloads the pinned SDK and builder if needed, builds in a separate temporary folder, verifies the source and image hashes, and prepares its own Python loader environment. It does not install global packages or modify wallet data. Initial downloads/building can take several minutes.

Before the loader step, **close Ledger Wallet**, connect the matching device by **USB**, unlock it and leave it on its dashboard. Approve installation on the Ledger screen. Installation uses USB even when you plan to use Bluetooth afterward. Check that the installed app says **Pearl 0.1.1**.

No recovery phrase, reset, OS update or automatic app deletion is part of this command. If an existing Pearl app, insufficient space, or incompatible OS/API prevents installation, stop and resolve that separately. Do not substitute another model's image or loader flags.

For Stax use `stax`; for Nano S Plus use `nano-s-plus`. **Nano X cannot use this installer’s `--install` route**: ordinary retail sideloading is unavailable according to [Ledger's guide](https://developers.ledger.com/docs/device-app/beginner/vscode-extension). Its build target remains available for development.

## Use the wallet

- **Mac + Chrome/Edge + USB:** open [the hosted Pearl wallet](https://pearl-ledger-wallet.vercel.app/), open Pearl on the Ledger, and connect directly. Ledger Wallet is optional for this route.
- **iPhone + Gen5/Flex Bluetooth:** pair through Ledger Wallet, open Pearl on the signer, and launch the hosted Pearl app through Ledger Wallet's Discover integration. The Safari website alone cannot provide the native Bluetooth bridge. See [Discover setup](live-app.md) for the developer-loaded app; a public catalog listing is separate.
- **Local wallet:** from the repository folder, run `python3 scripts/run-local.py` and open the address it prints.

Verify a Receive address on the device before sending. Keys and the account derivation (`86'/808276'/0'`) remain unchanged.

If the phone cancels or Bluetooth drops during review, **reject the old review on the Ledger before reconnecting or starting again**. The SDK's Bluetooth-on flag describes radio power, not link connectivity. A review may remain until rejection, lock, or its 120-second expiry; closing the phone screen is not a device rejection.

## Build without touching a device

Omit `--install`:

```sh
python3 scripts/install-pearl.py gen5
```

No USB loader or device call runs in this mode. The command prints the verified image location. Advanced users can reuse an existing clean SDK with `--sdk /path/to/ledger-secure-sdk`.

The installer reuses the existing `tools/bitcoin-prl-port/build.sh` and provenance/ELF checks. [release.json](../apps/ledger-bitcoin-prl/release.json) pins each model's source, binary hashes, API, target ID and linker-derived sizes. The SDK is `6709cd2bdfebb224ee070f7c1211b54254262579` (`v27.1.2`); the official Linux ARM64 builder is pinned to `sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2`. Compilation runs offline with a read-only SDK and no device mounts. Git LFS screenshot skipping, an empty isolated Git repository, and ZIP executable-bit handling are built into the setup.

Bluetooth-capable models use flags **0x240**: the existing **0x40** plus the SDK-required **0x200 settings-write permission**, following the official Bitcoin Bluetooth setup. Nano S Plus remains **0x40**. No master-seed or library permission is added.

[0.1.1 evidence and test limits](../tools/ble-review/README.md) records all five builds, emulator checks, synthetic event tests, and the installer replay. No physical 0.1.1 installation or radio test was performed by the agent. The earlier [0.1.0 build/installation checkpoint](../tools/install-guide-review/README.md) remains historical; its files and previously installed Nano S Plus image were preserved. Do not use that USB-only version to test the new Bluetooth route.
