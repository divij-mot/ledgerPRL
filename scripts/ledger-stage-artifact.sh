#!/usr/bin/env bash
# Publish through rename, never overwrite an ELF inode mapped by a running emulator.
set -euo pipefail
command -v flock >/dev/null || { echo "Missing flock (util-linux); use the official Linux Ledger builder" >&2; exit 1; }
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:?device required}"
NETWORK="${2:?network required}"
case "$DEVICE" in nanosplus|nanox|stax|flex|apex_p) ;; *) exit 2;; esac
case "$NETWORK" in mainnet|testnet|testnet2|regtest|simnet) ;; *) exit 2;; esac
mkdir -p "$ROOT/apps/ledger/target"
exec 9>"$ROOT/apps/ledger/target/.build-$DEVICE.lock"
flock 9
OUT="$ROOT/apps/ledger/target/artifacts"
mkdir -p "$OUT"
ELF="$ROOT/apps/ledger/target/$DEVICE/release/pearl-ledger"
python3 "$ROOT/scripts/ledger-build-manifest.py" verify --device "$DEVICE" --network "$NETWORK" --elf "$ELF"
TEMP="$(mktemp "$OUT/.stage.XXXXXX")"
META="$(mktemp "$OUT/.manifest.XXXXXX")"
trap 'rm -f "$TEMP" "$META"' EXIT
cp "$ELF" "$TEMP"
cp "$ELF.build.json" "$META"
# Refuse a concurrent rebuild/copy race rather than publish mismatched bytes.
python3 - "$TEMP" "$META" "$DEVICE" "$NETWORK" <<'PYTHON'
import hashlib, json, sys
from pathlib import Path
actual = hashlib.sha256(Path(sys.argv[1]).read_bytes()).hexdigest()
manifest = json.loads(Path(sys.argv[2]).read_text())
if manifest["device"] != sys.argv[3] or manifest["network"] != sys.argv[4]:
    raise SystemExit("Build generation changed target/network during staging; retry")
expected = manifest["elfSha256"]
if actual != expected:
    raise SystemExit("ELF changed during staging; retry after the build completes")
PYTHON
chmod 755 "$TEMP"
mv -f "$TEMP" "$OUT/pearl-$DEVICE-$NETWORK.elf"
mv -f "$META" "$OUT/pearl-$DEVICE-$NETWORK.build.json"
