#!/usr/bin/env python3
"""Isolated replay/negative controls. Creates no files in the supplied inputs."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

p = argparse.ArgumentParser(description=__doc__)
for name in ("repo", "qualification-dir", "reproduction-dir", "output"):
    p.add_argument("--" + name, required=True, type=Path)
a = p.parse_args()
repo, run, repro = (x.resolve() for x in (a.repo, a.qualification_dir, a.reproduction_dir))
output = a.output.resolve()
if output.exists() or any(output.is_relative_to(x) for x in (repo, run, repro)):
    p.error("Output must be new and outside the inputs")
validator = Path(__file__).with_name("validate.py")
results = []

def overlay(source, destination):
    destination.mkdir()
    for child in source.iterdir():
        (destination / child.name).symlink_to(child, target_is_directory=child.is_dir())

def replace_json(path, update):
    value = json.loads(path.read_text())
    if path.is_symlink():
        path.unlink()
    update(value)
    path.write_text(json.dumps(value) + "\n")

def check(name, r, q, b, destination, success, expected_message=None):
    command = [sys.executable, str(validator), "--repo", str(r), "--qualification-dir", str(q), "--reproduction-dir", str(b), "--output", str(destination)]
    child = subprocess.run(command, text=True, capture_output=True)
    ok = child.returncode == 0 if success else child.returncode != 0 and not destination.exists()
    if expected_message:
        ok = ok and expected_message in child.stderr
    results.append({"name": name, "passed": ok, "exitCode": child.returncode, "failureMessage": child.stderr.strip() if not success else None})
    if not ok:
        raise RuntimeError(f"Control failed: {name}: {child.stderr}")

with tempfile.TemporaryDirectory(prefix="prl portable validation ", dir=output.parent) as temp:
    t = Path(temp)
    copied = t / "source with spaces"
    copied.mkdir()
    # Copy only validator-required source/test files; no vendor/build data.
    for folder in ("apps/ledger/src", "apps/ledger/icons", "apps/ledger/.cargo", "crates/pearl-core/src", "packages/sdk/src", "packages/wallet/src", "apps/ledger/tests"):
        for source in (repo / folder).iterdir():
            if source.is_file():
                target = copied / source.relative_to(repo)
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, target)
    for name in ("Cargo.toml", "apps/ledger/Cargo.toml", "apps/ledger/Cargo.lock", "apps/ledger/rust-toolchain.toml", "crates/pearl-core/Cargo.toml", "apps/ledger/patches/strict-transport.patch", "scripts/ledger-build.sh", "scripts/ledger-prepare-sdk.sh", "scripts/ledger-build-manifest.py", "apps/companion/src/bridge.ts", "apps/companion/src/operation.ts", "fixtures/protocol-v1.json", "package-lock.json", "tests/e2e/native-node-roundtrip.ts", "tests/e2e/parity-vectors.json", "tests/e2e/retain-evidence.py", "tools/compiled-cleanup-review/identities.json"):
        target = copied / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(repo / name, target)
    check("full replay with source/output paths containing spaces", copied, run, repro, t / "success output.json", True)
    crypto = copied / "apps/ledger/src/crypto.rs"
    original = crypto.read_bytes()
    crypto.write_bytes(original + b"\n")
    check("changed crypto rejected", copied, run, repro, t / "wrong-source.json", False, "Wrong crypto source")
    crypto.write_bytes(original)
    q = t / "duplicate matrix"
    overlay(run, q)
    replace_json(q / "qualification-report.json", lambda x: x["buildNetworkPackageMatrix"].append(x["buildNetworkPackageMatrix"][0]))
    check("duplicate model/network entry rejected", copied, q, repro, t / "duplicate-output.json", False, "Missing/duplicate/unexpected matrix entries")
    q = t / "runtime failure"
    overlay(run, q)
    (q / "runtime").unlink()
    overlay(run / "runtime", q / "runtime")
    (q / "runtime/nanosp-canonical").unlink()
    overlay(run / "runtime/nanosp-canonical", q / "runtime/nanosp-canonical")
    evidence = q / "runtime/nanosp-canonical/evidence.json"
    replace_json(evidence, lambda x: x.update(status="failed"))
    digest = hashlib.sha256(evidence.read_bytes()).hexdigest()
    replace_json(q / "qualification-report.json", lambda x: next(row for row in x["runtimeMatrix"] if row["model"] == "nanosp" and row["suite"] == "canonical").update(evidenceSha256=digest))
    check("failed underlying case rejected despite rebound summary hash", copied, q, repro, t / "failed-case-output.json", False, "underlying status/artifact mismatch")
    q = t / "missing test source"
    overlay(run, q)
    (q / "runtime").unlink()
    overlay(run / "runtime", q / "runtime")
    (q / "runtime/nanosp-canonical").unlink()
    overlay(run / "runtime/nanosp-canonical", q / "runtime/nanosp-canonical")
    for name in ("test-source-hashes-before.json", "test-source-hashes-after.json"):
        replace_json(q / "runtime/nanosp-canonical" / name, lambda x: x.pop("packages/sdk/src/device.ts"))
    check("matching but incomplete test inventories rejected", copied, q, repro, t / "missing-source-output.json", False, "test source inventory/hash mismatch")
    b = t / "changed canonical package"
    overlay(repro, b)
    (b / "control-packages").unlink()
    overlay(repro / "control-packages", b / "control-packages")
    (b / "control-packages/apex_p-mainnet").unlink()
    overlay(repro / "control-packages/apex_p-mainnet", b / "control-packages/apex_p-mainnet")
    apdu = b / "control-packages/apex_p-mainnet/pearl-apex_p-mainnet.apdu"
    content = apdu.read_bytes()
    apdu.unlink()
    apdu.write_bytes(content + b"00\n")
    check("changed canonical APDU bytes rejected", copied, run, b, t / "changed-package-output.json", False, "canonical rebuild bytes differ")
with output.open("x") as f:
    json.dump({"status": "PASS", "controls": results}, f, indent=2)
    f.write("\n")
print(f"PASS: {len(results)} controls")
