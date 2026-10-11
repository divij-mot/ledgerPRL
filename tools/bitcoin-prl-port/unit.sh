#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
: "${BOLOS_SDK:?Set BOLOS_SDK to ledger-secure-sdk v27.1.2}"
OUT="${PRL_UNIT_OUTPUT:-$(mktemp -d)}"
mkdir -p "$OUT"
for NETWORK in 0 1 2 3 4; do
  cc -std=c11 -Wall -Wextra -Werror -fsanitize=address,undefined -fno-omit-frame-pointer \
    -DPRL_NETWORK_ID="$NETWORK" '-DCOIN_NATIVE_SEGWIT_PREFIX="prl"' \
    -I"$ROOT/apps/ledger-bitcoin-prl/src" -I"$BOLOS_SDK/lib_standard_app" \
    -I"$BOLOS_SDK/target/nanos2/include" \
    "$ROOT/apps/ledger-bitcoin-prl/prl-tests/prl-unit.c" "$ROOT/apps/ledger-bitcoin-prl/src/ui/display_utils.c" \
    -o "$OUT/prl-unit-$NETWORK"
  ASAN_OPTIONS=detect_leaks=0 "$OUT/prl-unit-$NETWORK"
done
