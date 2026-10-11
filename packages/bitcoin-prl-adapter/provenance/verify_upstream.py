#!/usr/bin/env python3
"""Verify the exact retained upstream files and local, reviewable adaptation patch."""
import difflib
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
PACKAGE = HERE.parent
ROOT = PACKAGE.parent.parent
manifest = json.loads((HERE / "upstream.json").read_text())
patch = []
for name, expected in manifest["files"].items():
    source = PACKAGE / manifest["originals"] / name
    adapted = PACKAGE / "src/upstream" / name
    original_bytes, adapted_bytes = source.read_bytes(), adapted.read_bytes()
    assert hashlib.sha256(original_bytes).hexdigest() == expected["upstreamSha256"], f"Upstream source changed: {name}"
    assert hashlib.sha256(adapted_bytes).hexdigest() == expected["adaptedSha256"], f"Adapted source changed: {name}"
    patch.extend(difflib.unified_diff(original_bytes.decode().splitlines(keepends=True), adapted_bytes.decode().splitlines(keepends=True),
        fromfile=f"a/{manifest['upstreamPath']}/{name}", tofile=f"b/packages/bitcoin-prl-adapter/src/upstream/{name}"))
assert "".join(patch) == (HERE / "upstream.patch").read_text(), "Upstream adaptation patch differs"
assert hashlib.sha256((HERE / "LICENSE.app-bitcoin").read_bytes()).hexdigest() == manifest["licenseSha256"]
print(f"PASS: {len(manifest['files'])} Ledger host source files, Apache license, and exact local patch match pinned {manifest['revision']}.")
