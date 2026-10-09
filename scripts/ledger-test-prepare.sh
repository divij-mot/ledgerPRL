#!/usr/bin/env bash
# Local regression: fresh --no-checkout clone, idempotent rerun, reject edits.
# Requires the official pinned SDK repositories from ledger-prepare-sdk.sh.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/project/scripts" "$TMP/project/apps/ledger/patches" "$TMP/bin"
cp "$ROOT/scripts/ledger-prepare-sdk.sh" "$TMP/project/scripts/"
cp "$ROOT/apps/ledger/patches/strict-transport.patch" "$TMP/project/apps/ledger/patches/"
export LEDGER_TEST_GIT="$(command -v git)" LEDGER_TEST_SOURCE="$ROOT/apps/ledger/vendor"
cat > "$TMP/bin/git" <<'SH'
#!/usr/bin/env bash
set -euo pipefail
if [[ "$1" = clone && "$2" = --no-checkout ]]; then
  name="${3##*/}"; name="${name%.git}"
  exec "$LEDGER_TEST_GIT" clone --no-checkout "$LEDGER_TEST_SOURCE/$name" "$4"
fi
exec "$LEDGER_TEST_GIT" "$@"
SH
chmod +x "$TMP/bin/git"
PATH="$TMP/bin:$PATH" "$TMP/project/scripts/ledger-prepare-sdk.sh"
PATH="$TMP/bin:$PATH" "$TMP/project/scripts/ledger-prepare-sdk.sh"
echo '# reject unreviewed changes' >> "$TMP/project/apps/ledger/vendor/ledger-secure-sdk/README.md"
if PATH="$TMP/bin:$PATH" "$TMP/project/scripts/ledger-prepare-sdk.sh"; then
  echo 'FAIL: accepted modified secure SDK' >&2; exit 1
fi
git -C "$TMP/project/apps/ledger/vendor/ledger-secure-sdk" restore README.md
echo '# staged edit must be rejected' >> "$TMP/project/apps/ledger/vendor/ledger-device-rust-sdk/README.md"
git -C "$TMP/project/apps/ledger/vendor/ledger-device-rust-sdk" add README.md
if PATH="$TMP/bin:$PATH" "$TMP/project/scripts/ledger-prepare-sdk.sh"; then
  echo 'FAIL: accepted staged Rust SDK edit' >&2; exit 1
fi
printf '%s\n' 'PASS: fresh checkout, pinned patch, idempotence, dirty-tree and staged-edit rejection'
