#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENDOR="$ROOT/apps/ledger/vendor"
RUST_REV=4123d2dc85a2085115e6a36826460a9fe742cfb1
SECURE_REV=6709cd2bdfebb224ee070f7c1211b54254262579
mkdir -p "$VENDOR"
checkout() {
  local name="$1" revision="$2"
  if [[ ! -d "$VENDOR/$name/.git" ]]; then
    git clone --no-checkout "https://github.com/LedgerHQ/$name.git" "$VENDOR/$name"
    # A fresh --no-checkout clone has deliberately absent working-tree files.
    # Materialize the pin before applying the existing-checkout dirty safeguard.
    git -C "$VENDOR/$name" checkout --detach "$revision"
  fi
  # Never reset a developer's modified dependency checkout.
  if [[ $(git -C "$VENDOR/$name" rev-parse HEAD 2>/dev/null || :) != "$revision" ]]; then
    if [[ -n $(git -C "$VENDOR/$name" status --porcelain) ]]; then
      echo "Refusing to overwrite modified SDK: $VENDOR/$name" >&2; exit 1
    fi
    git -C "$VENDOR/$name" fetch origin "$revision"
    git -C "$VENDOR/$name" checkout --detach "$revision"
  fi
  test "$(git -C "$VENDOR/$name" rev-parse HEAD)" = "$revision"
}
checkout ledger-device-rust-sdk "$RUST_REV"
checkout ledger-secure-sdk "$SECURE_REV"
PATCH="$ROOT/apps/ledger/patches/strict-transport.patch"
if git -C "$VENDOR/ledger-device-rust-sdk" apply --check "$PATCH" 2>/dev/null; then
  git -C "$VENDOR/ledger-device-rust-sdk" apply "$PATCH"
elif git -C "$VENDOR/ledger-device-rust-sdk" apply --reverse --check "$PATCH"; then
  : # exact patch already applied
else
  echo "SDK does not match the reviewed transport patch" >&2; exit 1
fi
# Verify the entire tracked SDK delta, not just the patched hunk's presence.
test "$(git -C "$VENDOR/ledger-device-rust-sdk" diff HEAD --binary | sha256sum | cut -d' ' -f1)" = \
     "$(sha256sum "$PATCH" | cut -d' ' -f1)"
test -z "$(git -C "$VENDOR/ledger-device-rust-sdk" ls-files --others --exclude-standard)"
test -z "$(git -C "$VENDOR/ledger-secure-sdk" status --porcelain)"
printf 'Pinned SDKs verified in %s\n' "$VENDOR"
