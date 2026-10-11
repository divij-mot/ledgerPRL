# Offline QR investigation

This exercises a hash-pinned ELF in Speculos 0.27.1. It cannot simulate retail BLE, the device power menu, protection mode, or seed erasure. The candidate corrects the app's handling of an SDK power-button event; the reported physical freeze/reset remains unexplained. Keep hardware and release activity halted.

`qr-modal.ts` reuses the existing emulator and wallet client with the public vector-one fixture. It forbids SIGN_PSBT. Each case starts a fresh emulator. A separate established `native-pilot.ts` regression signs only fabricated public-fixture transactions; those results are identified separately in `candidate-evidence.json`.

## Prerequisites

Use an already cached official ARM64 builder image, repository dependencies, a Linux ARM64 Node 24 runtime directory, and a matching Linux ARM64 esbuild package directory. Prepare these outside the isolated test; the test container has no network, published ports, device mounts, or Docker socket. Do not attach a Ledger. The original ELF remains in ignored incident evidence; binaries are not distributed with this recipe.

The held candidate is built from the reviewed source using the existing `tools/bitcoin-prl-port/build.sh apex_p mainnet` with clean SDK commit `6709cd2bdfebb224ee070f7c1211b54254262579` and the pinned builder below. Build only in an isolated workspace mounted at `/workspace`, SDK at `/sdk`, `BOLOS_SDK=/sdk`, `PRL_SYSROOT=/usr/lib/arm-none-eabi`, and LLVM 21 first in PATH. No installer is involved. Its unchanged version label does not make it a release: the unchanged release manifest rejects the candidate source/image.

## Bounded test command

Set `QR_NODE` and `QR_ESBUILD` to the prepared Linux directories, and `QR_ELF` to the absolute retained baseline or candidate ELF path. Set `QR_EXPECTED` to its exact SHA-256. For the held candidate, the tested hash is `3580dfbd6871b77d3d5dacbb162ccd7c885503affd835b0176bdf708922b346c`.

```sh
QR_REPO="$PWD"
QR_OUT="$(mktemp -d)"
QR_IMAGE='ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools@sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2'
QR_CASES='qr-close,host-timeout,tcp-close,synthetic-power-tag,qr-review-expiry,qr-close-near-expiry,host-timeout-near-expiry,fresh-emulator-after-expiry'
QR_POWER_EXIT=0

docker run --rm --platform linux/arm64 --network none --read-only --tmpfs /tmp:rw,size=256m \
  -v "$QR_REPO:/work:ro" -v "$QR_OUT:/out" \
  -v "$QR_ELF:/firmware/app.elf:ro" \
  -v "$QR_NODE:/runtime:ro" -v "$QR_ESBUILD:/esbuild:ro" \
  -w /work -e ESBUILD_BINARY_PATH=/esbuild/bin/esbuild \
  -e SPECULOS_INJECTOR=/work/apps/ledger/tests/speculos-injector.py \
  -e PEARL_EXPECTED_SHA256="$QR_EXPECTED" \
  -e PEARL_QR_CASES="$QR_CASES" -e PEARL_EXPECT_POWER_EXIT="$QR_POWER_EXIT" \
  "$QR_IMAGE" timeout --signal=TERM --kill-after=5s 600s \
  /runtime/bin/node --import tsx tools/gen5-reset-incident/qr-modal.ts
```

For the preserved baseline, use hash `2737ecae15f14727ea0b1c5dcd3044da249eb04df3280294087ba9950e86f707`, `QR_CASES=synthetic-power-tag`, and `QR_POWER_EXIT=1`. The injected bytes are `RAW!` followed by tag `0x1B` with an empty body; the retail event body is unknown. This comparison concerns app dispatch, not a physical side-button sequence.

The first full candidate run used the primary-eight harness hash recorded in `candidate-evidence.json`. Two host-timeout cases were then rerun under the strengthened tracked harness, which checks received status words after QR opens and rejects any late `9000`. Do not attribute that later assertion to the original eight runs. To repeat those two cases, set `QR_CASES=host-timeout,host-timeout-near-expiry`.

Output includes result metadata and screenshots of public-fixture screens. A failed assertion stops the run and preserves its first failure. Reuse neither its output directory nor its emulator process. The 90/180-second per-case watchdogs and 600-second outer limit are test bounds; a watchdog failure is not natural review expiry. The three natural deadline cases take roughly six minutes in total. Closing QR near expiry must restore the original pixels without restarting the review clock. Host-only timeout is a logical waiter failure; TCP-close evidence cannot observe replies after its socket closes. The final fresh-emulator case demonstrates only a new process, not recovery of a real device or the same running process.
