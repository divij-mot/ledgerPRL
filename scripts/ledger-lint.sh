#!/usr/bin/env bash
# Lint the frozen native implementation without rewriting reviewed source.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:-nanosplus}"
case "$DEVICE" in nanosplus|nanox|stax|flex|apex_p) ;; *) echo 'Unsupported device' >&2; exit 2;; esac
command -v flock >/dev/null || { echo 'Missing flock (util-linux)' >&2; exit 1; }
mkdir -p "$ROOT/apps/ledger/target"
exec 9>"$ROOT/apps/ledger/target/.build-$DEVICE.lock"
flock 9
"$ROOT/scripts/ledger-prepare-sdk.sh"
SDK="$ROOT/apps/ledger/vendor/ledger-device-rust-sdk/ledger_secure_sdk_sys"
export LEDGER_SDK_PATH="$ROOT/apps/ledger/vendor/ledger-secure-sdk"
export RUST_TARGET_PATH="$SDK/devices/$DEVICE"
export PATH="$SDK:$PATH"
cd "$ROOT/apps/ledger"
# Only syntax-style suggestions are exempted: keep the reviewed nested warning
# branch and explicit overflow-safe quotient/remainder threshold calculation.
# All other Clippy/Rust warnings remain errors.
cargo +nightly-2025-12-05 clippy --locked --release --target "$DEVICE" \
  --features simnet --no-deps -- -D warnings \
  -A clippy::collapsible_if -A clippy::manual_is_multiple_of
