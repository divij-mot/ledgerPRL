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
fi
# A caller-supplied checkout must meet the same immutable source requirement.
test "$(git -C "$SOURCE" rev-parse HEAD)" = "$PIN" || {
 echo "Pearl source does not match the pinned commit" >&2; exit 1;
}
test -z "$(git -C "$SOURCE" status --porcelain --untracked-files=all)" || {
 echo "Pearl source contains local changes" >&2; exit 1;
}
# Compile an archive of the pinned object, not a mutable caller working tree.
SNAPSHOT="$(mktemp -d "$WORK/pearl-source.XXXXXX")"
git -C "$SOURCE" archive "$PIN" | tar -x -C "$SNAPSHOT"
SNAPSHOT="$(cd "$SNAPSHOT" && pwd)"
mkdir -p "$WORK/oracle"
cp "$ROOT/tools/pearl-oracle/main.go" "$WORK/oracle/"
cat > "$WORK/oracle/go.mod" <<MOD
module pearl-ledger-oracle

go 1.26.6

require github.com/pearl-research-labs/pearl v0.0.0
MOD
cd "$WORK/oracle"
go mod edit "-replace=github.com/pearl-research-labs/pearl=$SNAPSHOT"
go mod tidy
go run . "$ROOT/fixtures/protocol-v1.json"
