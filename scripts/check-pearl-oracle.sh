#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PIN=2f8b770cac8f8b74be05c1fc51c2baeb76ce0701
WORK="${PEARL_ORACLE_WORK:-$(mktemp -d)}"
mkdir -p "$WORK"
if [[ -n "${PEARL_SOURCE:-}" ]]; then
 SOURCE="$PEARL_SOURCE"
else
 SOURCE="$WORK/pearl"
 git clone --no-checkout https://github.com/pearl-research-labs/pearl.git "$SOURCE"
 git -C "$SOURCE" checkout --detach "$PIN"
 test "$(git -C "$SOURCE" rev-parse HEAD)" = "$PIN"
fi
mkdir -p "$WORK/oracle"
cp "$ROOT/tools/pearl-oracle/main.go" "$WORK/oracle/"
cat > "$WORK/oracle/go.mod" <<MOD
module pearl-ledger-oracle

go 1.26.6

require github.com/pearl-research-labs/pearl v0.0.0
replace github.com/pearl-research-labs/pearl => $SOURCE
MOD
cd "$WORK/oracle"
go mod tidy
go run . "$ROOT/fixtures/protocol-v1.json"
