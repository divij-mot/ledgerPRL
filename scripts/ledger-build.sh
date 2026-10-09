#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:-nanosplus}"
NETWORK="${2:-regtest}"
case "$DEVICE" in nanosplus|nanox|stax|flex|apex_p) ;; *) echo 'Use nanosplus, nanox, stax, flex, or apex_p (Nano Gen5)' >&2; exit 2;; esac
case "$NETWORK" in mainnet|testnet|testnet2|regtest|simnet) ;; *) echo 'Unsupported network' >&2; exit 2;; esac
"$ROOT/scripts/ledger-prepare-sdk.sh"
SDK="$ROOT/apps/ledger/vendor/ledger-device-rust-sdk/ledger_secure_sdk_sys"
export LEDGER_SDK_PATH="$ROOT/apps/ledger/vendor/ledger-secure-sdk"
export RUST_TARGET_PATH="$SDK/devices/$DEVICE"
export PATH="$SDK:$PATH"
# Ledger SDK invokes clang and ARM GCC; install official build tools first.
for tool in cargo rustc clang arm-none-eabi-gcc; do command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }; done
cd "$ROOT/apps/ledger"
FEATURES=()
if [[ "$NETWORK" != mainnet ]]; then FEATURES=(--features "$NETWORK"); fi
cargo +nightly-2025-12-05 build --locked --release --target "$DEVICE" "${FEATURES[@]}"
# This is a build only. No device is installed, reset, upgraded, or connected.
