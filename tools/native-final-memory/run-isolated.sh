#!/usr/bin/env bash
# Isolated, test-only measurements after the release matrix; no parent writes.
set -euo pipefail
python3 -c 'if not __debug__: raise SystemExit("Replay requires assertions; unset PYTHONOPTIMIZE")'
ROOT="${1:?Pass a frozen repository checkout}"
OUT="${2:?Pass a fresh measurement directory}"
SELF="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$ROOT" && pwd)"
OUT="$(python3 -c 'import pathlib,sys;print(pathlib.Path(sys.argv[1]).resolve())' "$OUT")"
python3 "$SELF/prepare-isolated.py" --source "$ROOT" --output "$OUT"
unset SPECULOS_INJECTOR
MIRROR="$OUT/mirror"
mkdir "$OUT/builds" "$OUT/memory" "$OUT/stability" "$OUT/artifacts"
for d in ledger-device-rust-sdk ledger-secure-sdk; do
 git -C "$ROOT/apps/ledger/vendor/$d" diff HEAD --binary > "$OUT/parent-$d-before.diff"
done
cd "$MIRROR"
for device in nanosplus nanox stax flex apex_p; do
 model="$device"; [[ "$device" != nanosplus ]] || model=nanosp
 echo "INSTRUMENTED_BUILD $device"
 timeout 600 bash scripts/ledger-build-instrumented.sh "$device" > "$OUT/builds/$device.log" 2>&1
 elf="apps/ledger/target/memory-measurement/pearl-$device-simnet-INSTRUMENTED.elf"
 cp -n "$elf" "$OUT/artifacts/"
 echo "INSTRUMENTED_BUILT $device $(sha256sum "$elf" | cut -d' ' -f1)"
 echo "MEMORY $model"
 SPECULOS_MODEL="$model" PEARL_EVIDENCE="$OUT/memory/$model" timeout 600 node --import tsx apps/ledger/tests/native-memory.ts > "$OUT/memory/$model.log" 2>&1
 echo "MEMORY_PASSED $model"
 echo "STABILITY $model"
 SPECULOS_MODEL="$model" PEARL_INSTRUMENTED=1 PEARL_STABILITY_SESSIONS=20 SPECULOS_API_PORT=5981 PEARL_EVIDENCE="$OUT/stability/$model" timeout 600 node --import tsx apps/ledger/tests/native-stability.ts > "$OUT/stability/$model.log" 2>&1
 echo "STABILITY_PASSED $model"
done
python3 scripts/ledger-build-manifest.py snapshot > "$OUT/mirror-native-source-after.json"
python3 "$ROOT/scripts/ledger-build-manifest.py" snapshot > "$OUT/parent-native-source-after.json"
python3 - "$OUT" <<'PY'
import json,pathlib,sys,hashlib
if not __debug__:
 raise SystemExit("Isolation checks require assertions; unset PYTHONOPTIMIZE")
r=pathlib.Path(sys.argv[1]); before=json.loads((r/'parent-native-source-before.json').read_text())
assert before==json.loads((r/'parent-native-source-after.json').read_text())==json.loads((r/'mirror-native-source-after.json').read_text())
for rel,h in json.loads((r/'mirror-input-hashes.json').read_text()).items():
 assert hashlib.sha256((r/'mirror'/rel).read_bytes()).hexdigest()==h,rel
print('MIRROR_AND_PARENT_INPUTS_UNCHANGED')
PY
for d in ledger-device-rust-sdk ledger-secure-sdk; do
 git -C "$ROOT/apps/ledger/vendor/$d" diff HEAD --binary > "$OUT/parent-$d-after.diff"
 cmp "$OUT/parent-$d-before.diff" "$OUT/parent-$d-after.diff"
done
sha256sum "$OUT"/artifacts/*.elf > "$OUT/artifact-sha256.txt"
echo ALL_INSTRUMENTED_MEASUREMENTS_PASSED
