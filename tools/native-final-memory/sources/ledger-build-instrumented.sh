#!/usr/bin/env bash
# Test-only memory measurement. Never modifies or publishes release artifacts.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:-nanox}"
case "$DEVICE" in nanosplus|nanox|stax|flex|apex_p) ;; *) echo 'Unsupported device' >&2; exit 2;; esac
"$ROOT/scripts/ledger-prepare-sdk.sh"
BASE="$ROOT/apps/ledger/target/memory-measurement"
SOURCE="$BASE/source"
mkdir -p "$SOURCE/apps/ledger/vendor" "$SOURCE/crates"
cp "$ROOT/Cargo.toml" "$SOURCE/Cargo.toml"
# Every invocation refreshes immutable build inputs from reviewed source.
# Do not run this script concurrently with itself.
cp -a "$ROOT/apps/ledger/Cargo.toml" "$ROOT/apps/ledger/Cargo.lock" "$SOURCE/apps/ledger/"
cp -a "$ROOT/apps/ledger/src" "$ROOT/apps/ledger/icons" "$ROOT/apps/ledger/.cargo" "$SOURCE/apps/ledger/"
cp -a "$ROOT/crates/pearl-core" "$SOURCE/crates/"
SDK="$SOURCE/apps/ledger/vendor/ledger-device-rust-sdk"
mkdir -p "$SDK"
# Copy only tracked files, then apply precisely the release patch plus test patch.
git -C "$ROOT/apps/ledger/vendor/ledger-device-rust-sdk" archive HEAD | tar -x -C "$SDK"
patch --batch --forward -d "$SDK" -p1 < "$ROOT/apps/ledger/patches/strict-transport.patch"
patch --batch --forward -d "$SDK" -p1 < "$ROOT/apps/ledger/patches/memory-instrumentation.patch"
export LEDGER_SDK_PATH="$ROOT/apps/ledger/vendor/ledger-secure-sdk"
export RUST_TARGET_PATH="$SDK/ledger_secure_sdk_sys/devices/$DEVICE"
export PATH="$SDK/ledger_secure_sdk_sys:$PATH"
export CARGO_TARGET_DIR="$SOURCE/apps/ledger/target"
cd "$SOURCE/apps/ledger"
cargo +nightly-2025-12-05 build --locked --release --target "$DEVICE" --features simnet,ledger_device_sdk/stack_usage
OUT="$BASE/pearl-$DEVICE-simnet-INSTRUMENTED.elf"
TEMP="$(mktemp "$OUT.XXXXXX")"
cp "$CARGO_TARGET_DIR/$DEVICE/release/pearl-ledger" "$TEMP"
mv "$TEMP" "$OUT"
sha256sum "$OUT"
# BOLOS B0/57 has a test-only extended 16-byte response in these binaries.
