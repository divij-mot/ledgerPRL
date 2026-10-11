# Ledger models and installation

Pearl targets these five models, with device-specific screens. Build and emulator checks do not replace testing on a physical device.

| Model | Mainnet build | Account, Receive and signing emulator | Physical test |
| --- | --- | --- | --- |
| Nano S Plus | Passed | Passed; button layout | Recorded on OS 1.7.0 |
| Nano X | Passed | Passed; button layout | Not tested |
| Stax | Passed | Passed; touchscreen layout | Not tested |
| Flex | Passed | Passed; touchscreen layout | Not tested |
| Nano Gen5 | Passed | Passed; touchscreen layout | Not tested |

The original **Nano S is not supported**. Current firmware uses USB; Bluetooth is disabled. Ordinary **Nano X sideloading is unavailable** ([Ledger documentation](https://developers.ledger.com/docs/device-app/beginner/vscode-extension)); a compiled image does not bypass its vendor installation gate. [Model evidence and screen examples](../tools/install-guide-review/README.md).

## Nano S Plus installation recipe

This guide is for **Nano S Plus with Ledger OS 1.7.0 / API 27**, using **Pearl 0.1.0 mainnet**. It was verified on macOS with Docker Desktop on Apple silicon. Do not use this image for another Ledger model or OS/API.

Pearl is not in My Ledger's public app catalog. You build it below, then approve installation on the device. No recovery phrase, reset, OS update or app deletion is needed.

## 1. Prepare a separate build folder

You need Git, Python 3.11 or later and a running Docker Desktop. Start in the downloaded/extracted repository folder. Run these blocks in the **same terminal**; stop if a command fails.

```sh
set -e
PEARL_BUILD="$(mktemp -d /tmp/pearl-build.XXXXXX)"
mkdir -p "$PEARL_BUILD/workspace/apps" "$PEARL_BUILD/workspace/tools/bitcoin-prl-port"
cp -R apps/ledger-bitcoin-prl "$PEARL_BUILD/workspace/apps/"
cp tools/bitcoin-prl-port/build.sh tools/bitcoin-prl-port/provenance.py \
  "$PEARL_BUILD/workspace/tools/bitcoin-prl-port/"
git init "$PEARL_BUILD/workspace"
```

The empty Git repository is required by Ledger's build system even when the source came from a ZIP. It has no remote and does not publish anything. Your downloaded source and existing wallet data stay outside the build folder.

## 2. Download the pinned SDK and build tools

```sh
GIT_LFS_SKIP_SMUDGE=1 git clone --depth 1 --branch v27.1.2 \
  https://github.com/LedgerHQ/ledger-secure-sdk.git "$PEARL_BUILD/sdk"
test "$(git -C "$PEARL_BUILD/sdk" rev-parse HEAD)" = \
  6709cd2bdfebb224ee070f7c1211b54254262579
test -z "$(git -C "$PEARL_BUILD/sdk" status --porcelain)"

PEARL_BUILDER=ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools@sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2
docker pull --platform linux/arm64 "$PEARL_BUILDER"
```

The LFS setting skips unused SDK screenshot downloads. It also keeps the SDK clean when checked inside the offline builder. Both downloads happen before the build; the build container itself has no network or device access.

## 3. Build and check the files

```sh
docker run --rm --platform linux/arm64 \
  --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --user "$(id -u):$(id -g)" \
  --tmpfs /tmp:rw,size=512m \
  -v "$PEARL_BUILD/workspace:/workspace" \
  -v "$PEARL_BUILD/sdk:/sdk:ro" -w /workspace \
  -e BOLOS_SDK=/sdk -e PRL_SYSROOT=/usr/lib/arm-none-eabi \
  --entrypoint /bin/bash "$PEARL_BUILDER" \
  -c 'export PATH=/usr/lib/llvm-21/bin:$PATH; bash tools/bitcoin-prl-port/build.sh nanos2 mainnet'

PEARL_IMAGE="$PEARL_BUILD/workspace/apps/ledger-bitcoin-prl/build-artifacts/nanos2-mainnet"
python3 tools/pearl-name-review/inspect-metadata.py mainnet "$PEARL_IMAGE/app.elf"
python3 - "$PEARL_IMAGE" <<'PY'
from pathlib import Path
import hashlib, sys
folder = Path(sys.argv[1])
expected = {
    "app.hex": "04c121196c75d71776921e78425d3b8b972d3921aa19acbac7d690c546e98174",
    "app.elf": "0f58a289227ccd78a6e66735cb3b7db95f849b9890d454299e83ef15edbd3271",
}
for name, wanted in expected.items():
    actual = hashlib.sha256((folder / name).read_bytes()).hexdigest()
    if actual != wanted:
        raise SystemExit(f"STOP: {name} does not match this installation guide")
    print(f"Verified {name}: {actual}")
PY
```

Continue only when both hashes match and metadata reports **Pearl**, **0.1.0**, **nanos2**, **API 27**, and **0x40** flags. `bash build.sh` works even if your ZIP extractor removed executable permissions. The `/workspace` and `/sdk` container paths are intentional: they reproduce the qualified build layout.

No prebuilt firmware is included in the repository download. Older `.tools/firmware` files on a development machine are not a substitute for these checks.

## 4. Install with the device in front of you

Create a Python environment just for the loader:

```sh
python3 -m venv "$PEARL_BUILD/loader"
"$PEARL_BUILD/loader/bin/python" -m pip install 'ledgerblue==0.1.58'
"$PEARL_BUILD/loader/bin/python" -c \
  'import importlib.metadata as m; assert m.version("ledgerblue") == "0.1.58"'
```

Close Ledger Wallet to release USB. Connect and unlock the matching Nano S Plus, leaving it on its dashboard. Then run:

```sh
"$PEARL_BUILD/loader/bin/python" -m ledgerblue.loadApp \
  --targetId 0x33100004 --targetVersion '' --apiLevel 27 \
  --fileName "$PEARL_IMAGE/app.hex" \
  --appName Pearl --appFlags 0x40 --tlv \
  --dataSize 512 --installparamsSize 61
```

Approve the installation on the Ledger screen. These loader sizes and flags apply only to the exact image checked above. The command does not delete another app. If it reports an existing app or insufficient space, stop and resolve that separately; do not add a delete option automatically. Check that the installed app is **Pearl 0.1.0**. It is independently built, not Ledger-approved.

## 5. Open the wallet

Open **Pearl** on the Ledger. Then choose one route:

- **Hosted:** open [the Pearl wallet](https://pearl-ledger-wallet.vercel.app/) in desktop Chrome/Edge, or load its [hosted manifest](../apps/companion/ledger-live.hosted.manifest.json) into Ledger Wallet's developer Discover list. [Discover setup](live-app.md) explains the latter; it is not a public catalog listing.
- **Local:** from the repository folder, run `python3 scripts/run-local.py` and open the address it prints.

Connect the Ledger, sync, and compare a **Receive** address on the device before sending. The existing seed/account still derives the same addresses at `86'/808276'/0'`. Installation does not import a seed or replace browser history.

## Verification record

The build-only recipe was rerun from a fresh GitHub ZIP source copy in an isolated workspace; both output hashes match the previously installed candidate. No USB was exposed during this verification. See [fresh-build evidence](../tools/install-guide-review/build-only.json).

The earlier owner-present installation on 10 October 2026 reported installed-app hash `22c0f2fd025c73c9713ea39b3ecf525b4e617d0ff74a9213d51800543ecbbda7`; account export and Receive verification passed in Ledger Discover. That installed-app hash is different from the ELF/HEX file hashes. Broader device compatibility is not implied. [Mainnet observations](mainnet-testing.md) and [emulator evidence](../tools/pearl-name-review/README.md) retain their own scope.
