#!/usr/bin/env bash
# Local provenance regression; never executes the copied or tampered ELF.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DEVICE="${1:-nanosplus}"
NETWORK="${2:-regtest}"
SOURCE="$ROOT/apps/ledger/target/artifacts/pearl-$DEVICE-$NETWORK"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
cp "$SOURCE.elf" "$TMP/pearl-ledger"
cp "$SOURCE.build.json" "$TMP/pearl-ledger.build.json"
VERIFY=(python3 "$ROOT/scripts/ledger-build-manifest.py" verify --device "$DEVICE" --elf "$TMP/pearl-ledger")
"${VERIFY[@]}" --network "$NETWORK"
if "${VERIFY[@]}" --network invalid >/dev/null 2>&1; then
  echo 'FAIL: accepted wrong network label' >&2; exit 1
fi
python3 - "$TMP/pearl-ledger" <<'PY'
from pathlib import Path
import sys
p = Path(sys.argv[1]); data = bytearray(p.read_bytes()); data[-1] ^= 1; p.write_bytes(data)
PY
if "${VERIFY[@]}" --network "$NETWORK" >/dev/null 2>&1; then
  echo 'FAIL: accepted changed ELF bytes' >&2; exit 1
fi
python3 "$ROOT/scripts/ledger-build-manifest.py" snapshot > "$TMP/before.json"
python3 - "$TMP/before.json" <<'PY'
from pathlib import Path
import json, sys
p = Path(sys.argv[1]); data = json.loads(p.read_text()); data[next(iter(data))] = "changed"; p.write_text(json.dumps(data))
PY
if python3 "$ROOT/scripts/ledger-build-manifest.py" record --before "$TMP/before.json" \
    --device "$DEVICE" --network "$NETWORK" --elf "$TMP/pearl-ledger" >/dev/null 2>&1; then
  echo 'FAIL: accepted changed source snapshot' >&2; exit 1
fi
echo 'PASS: exact artifact accepted; wrong network, changed ELF, and changed source rejected'
