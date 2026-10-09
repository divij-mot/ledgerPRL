#!/usr/bin/env bash
# Software-only builds for supported API27 devices; never loads physical hardware.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT="$ROOT/apps/ledger/target/artifacts"
mkdir -p "$OUT"
# Preserve network-labelled ELFs so a later build cannot change a running test's input.
for network in mainnet simnet; do
  for device in nanosplus nanox stax flex apex_p; do
    "$ROOT/scripts/ledger-build.sh" "$device" "$network" > "$OUT/build-$device-$network.log" 2>&1 || {
      tail -80 "$OUT/build-$device-$network.log" >&2; exit 1;
    }
    cp "$ROOT/apps/ledger/target/$device/release/pearl-ledger" "$OUT/pearl-$device-$network.elf"
    printf 'PASS %s %s ' "$device" "$network"
    sha256sum "$OUT/pearl-$device-$network.elf" | cut -d' ' -f1
  done
done
