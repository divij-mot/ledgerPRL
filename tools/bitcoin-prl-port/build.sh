#!/usr/bin/env bash
# Build only. Never loads a device, changes its OS, or creates a seed.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="$ROOT/apps/ledger-bitcoin-prl"
TARGET="${1:-nanos2}"
NETWORK="${2:-regtest}"
case "$TARGET" in nanosp|nanosplus) TARGET=nanos2;; nanos2|nanox|stax|flex|apex_p) ;; *) echo 'Unsupported target' >&2; exit 2;; esac
case "$NETWORK" in mainnet) COIN=pearl;; testnet|testnet2|regtest|simnet) COIN=pearl_$NETWORK;; *) echo 'Unsupported network' >&2; exit 2;; esac
: "${BOLOS_SDK:?Set BOLOS_SDK to an unmodified official ledger-secure-sdk v27.1.2 checkout}"
SDK_REV=6709cd2bdfebb224ee070f7c1211b54254262579
[[ "$(git -C "$BOLOS_SDK" rev-parse HEAD)" == "$SDK_REV" ]] || { echo 'Wrong SDK revision' >&2; exit 1; }
[[ -z "$(git -C "$BOLOS_SDK" status --porcelain)" ]] || { echo 'SDK checkout is modified' >&2; exit 1; }
for command in clang ld.lld llvm-objcopy arm-none-eabi-gcc python3 flock; do command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }; done
OUT="${PRL_BUILD_OUTPUT:-$APP/build-artifacts/$TARGET-$NETWORK}"
mkdir -p "$OUT" "$APP/build-artifacts"
exec 9>"$APP/build-artifacts/.build-$TARGET.lock"
flock 9
python3 "$ROOT/tools/bitcoin-prl-port/provenance.py" snapshot > "$OUT/source-before.json"
# Network defines are not make dependencies. Clean only this target to avoid stale network objects.
make -C "$APP" TARGET="$TARGET" COIN="$COIN" clean_target > "$OUT/build.log" 2>&1
ARGS=()
if [[ -n "${PRL_SYSROOT:-}" ]]; then ARGS+=("SYSROOT=$PRL_SYSROOT"); fi
make -C "$APP" TARGET="$TARGET" COIN="$COIN" "${ARGS[@]}" -j"${PRL_BUILD_JOBS:-4}" bin/app.elf >> "$OUT/build.log" 2>&1
python3 "$ROOT/tools/bitcoin-prl-port/provenance.py" snapshot > "$OUT/source-after.json"
cmp "$OUT/source-before.json" "$OUT/source-after.json" || { echo 'Source changed during build; refusing artifact attribution' >&2; exit 1; }
cp "$APP/build/$TARGET/bin/app.elf" "$OUT/app.elf"
cp "$APP/build/$TARGET/bin/app.hex" "$OUT/app.hex"
cp "$APP/build/$TARGET/dbg/app.map" "$OUT/app.map"
python3 "$ROOT/tools/bitcoin-prl-port/provenance.py" record "$TARGET" "$NETWORK" "$OUT"
printf 'Built %s %s: %s\n' "$TARGET" "$NETWORK" "$OUT/app.elf"
