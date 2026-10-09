#!/usr/bin/env python3
"""Bind each local firmware build to its network, source inputs and tool versions."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parent.parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def inputs():
    files = [ROOT / p for p in (
        "Cargo.toml", "apps/ledger/Cargo.toml", "apps/ledger/Cargo.lock",
        "apps/ledger/rust-toolchain.toml", "crates/pearl-core/Cargo.toml",
        "apps/ledger/patches/strict-transport.patch",
        "scripts/ledger-build.sh", "scripts/ledger-prepare-sdk.sh",
        "scripts/ledger-build-manifest.py",
    )]
    for folder in ("apps/ledger/src", "apps/ledger/icons", "apps/ledger/.cargo", "crates/pearl-core/src"):
        files += [p for p in (ROOT / folder).rglob("*") if p.is_file()]
    return {str(p.relative_to(ROOT)): sha(p) for p in sorted(files)}


def run(*command):
    return subprocess.check_output(command, text=True).strip()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("action", choices=("snapshot", "record", "verify"))
parser.add_argument("--before", type=Path)
parser.add_argument("--device")
parser.add_argument("--network")
parser.add_argument("--elf", type=Path)
args = parser.parse_args()
if args.action == "snapshot":
    print(json.dumps(inputs(), sort_keys=True))
elif args.action == "record":
    before = json.loads(args.before.read_text())
    if before != inputs():
        raise SystemExit("Source inputs changed while building; refusing build provenance")
    manifest = {
        "device": args.device, "network": args.network,
        "elfSha256": sha(args.elf), "sources": before,
        "rustSdk": run("git", "-C", str(ROOT / "apps/ledger/vendor/ledger-device-rust-sdk"), "rev-parse", "HEAD"),
        "secureSdk": run("git", "-C", str(ROOT / "apps/ledger/vendor/ledger-secure-sdk"), "rev-parse", "HEAD"),
        "rustc": run("rustc", "+nightly-2025-12-05", "-Vv"),
        "clang": run("clang", "--version"),
        "armGcc": run("arm-none-eabi-gcc", "--version"),
        "buildEnvironment": {key: os.environ.get(key) for key in (
            "HEAP_SIZE", "APP_STORAGE_SIZE", "LEDGER_SDK_EXTRA_DEFINES",
            "LEDGER_SDK_EXTRA_CFLAGS", "RUSTFLAGS", "CARGO_ENCODED_RUSTFLAGS",
            "CFLAGS", "CC", "AR", "LEDGER_APP_PACKAGE",
        )},
        "cargoArguments": ["build", "--locked", "--release", "--target", args.device]
            + ([] if args.network == "mainnet" else ["--features", args.network]),
        "scope": "Development software build; no physical device compatibility or release approval implied",
    }
    destination = args.elf.with_suffix(".build.json")
    with tempfile.NamedTemporaryFile(mode="w", dir=destination.parent, delete=False) as output:
        json.dump(manifest, output, indent=2)
        output.write("\n")
        temporary = output.name
    os.replace(temporary, destination)
else:
    manifest = json.loads(args.elf.with_suffix(".build.json").read_text())
    if manifest["device"] != args.device or manifest["network"] != args.network:
        raise SystemExit("Refusing to mislabel firmware built for a different target/network")
    if manifest["elfSha256"] != sha(args.elf):
        raise SystemExit("ELF no longer matches its build manifest")
