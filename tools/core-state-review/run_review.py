#!/usr/bin/env python3
"""Portable, fail-closed replay of the separately archived Session campaign."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parent.parent
ORIGINAL_RUSTC = "rustc 1.99.0 (b940084d7 2026-09-28)"
CANONICAL_INPUTS = {
    "Cargo.toml", "Cargo.lock", "crates/pearl-core/Cargo.toml",
    *{f"crates/pearl-core/src/{name}.rs" for name in
      ("address", "amount", "error", "lib", "network", "session", "transaction")},
}
ORIGINAL_RUNS = [
    ("53544154455f5632", "200", "all"),
    ("0000000000000002", "50000", "walks"),
    ("9e3779b97f4a7c15", "50000", "walks"),
    ("deadbeef20261009", "50000", "walks"),
    ("ffffffffffffffff", "50000", "walks"),
]


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_manifest(path: Path) -> dict[str, str]:
    manifest: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        match = re.fullmatch(r"([0-9a-f]{64})  ([A-Za-z0-9_./-]+)", line)
        if match is None:
            raise RuntimeError(f"invalid source-manifest line in {path.name}")
        checksum, relative = match.groups()
        candidate = Path(relative)
        if candidate.is_absolute() or ".." in candidate.parts or relative in manifest:
            raise RuntimeError("invalid or duplicate source-manifest path")
        manifest[relative] = checksum
    return manifest


def verify_files(base: Path, manifest: dict[str, str]) -> None:
    for relative, expected in manifest.items():
        path = base / relative
        # Refuse symlinks in both file and parent components; do not follow a
        # production-source path outside the selected checkout.
        chain = [path, *path.parents]
        if any(part.is_symlink() for part in chain if part != base.parent):
            raise RuntimeError(f"source mismatch: symlink at {relative}")
        if not path.is_file() or digest(path) != expected:
            raise RuntimeError(f"source mismatch: {relative}")


def preflight() -> dict[str, str]:
    expected = read_manifest(HERE / "provenance/production-source.sha256")
    if set(expected) != CANONICAL_INPUTS:
        raise RuntimeError("source manifest has an unexpected file inventory")
    sources = REPOSITORY / "crates/pearl-core/src"
    if not sources.is_dir():
        raise RuntimeError("place this package at <checkout>/tools/core-state-review")
    actual_sources = {
        str(path.relative_to(REPOSITORY)).replace(os.sep, "/")
        for path in sources.rglob("*") if not path.is_dir() or path.is_symlink()
    }
    expected_sources = {p for p in expected if p.startswith("crates/pearl-core/src/")}
    if actual_sources != expected_sources:
        raise RuntimeError("source mismatch: pearl-core/src file inventory differs")
    if os.path.lexists(REPOSITORY / "crates/pearl-core/build.rs"):
        raise RuntimeError("source mismatch: unreviewed pearl-core/build.rs exists")
    for directory in (REPOSITORY, HERE.parent, HERE):
        for filename in ("config", "config.toml"):
            if os.path.lexists(directory / ".cargo" / filename):
                raise RuntimeError("source mismatch: unreviewed checkout-local Cargo configuration")
    verify_files(REPOSITORY, expected)
    harness = read_manifest(HERE / "provenance/harness-source.sha256")
    if set(harness) != {"src/main.rs"}:
        raise RuntimeError("unexpected harness source inventory")
    actual_harness = {str(path.relative_to(HERE)).replace(os.sep, "/")
                      for path in (HERE / "src").rglob("*")
                      if not path.is_dir() or path.is_symlink()}
    if actual_harness != {"src/main.rs"} or os.path.lexists(HERE / "build.rs"):
        raise RuntimeError("source mismatch: unreviewed harness build input")
    verify_files(HERE, harness)
    build = read_manifest(HERE / "provenance/portable-build.sha256")
    if set(build) != {"Cargo.toml", "Cargo.lock"}:
        raise RuntimeError("unexpected portable build manifest inventory")
    verify_files(HERE, build)
    verify_files(HERE, read_manifest(HERE / "provenance/original-harness-source.sha256"))
    return expected


def tool(name: str) -> str:
    chosen = os.environ.get(name.upper(), name)
    resolved = shutil.which(chosen)
    if resolved is None:
        raise RuntimeError(f"{name} is unavailable; put the required toolchain on PATH")
    return resolved


def run_logged(command: list[str], log: Path, env: dict[str, str]) -> None:
    with log.open("w", encoding="utf-8") as output:
        process = subprocess.Popen(command, cwd=HERE, env=env,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                   text=True, encoding="utf-8", errors="replace")
        assert process.stdout is not None
        for line in process.stdout:
            output.write(line)
            print(line, end="", flush=True)
        code = process.wait()
    if code:
        raise RuntimeError(f"command failed with exit {code}; see {log.name}")


def execute(mode: str, output: Path) -> None:
    preflight()  # Must precede toolchain invocation or build.
    cargo, rustc = tool("cargo"), tool("rustc")
    version = subprocess.check_output([rustc, "--version"], text=True).strip()
    if version != ORIGINAL_RUSTC:
        raise RuntimeError(f"toolchain mismatch: need {ORIGINAL_RUSTC}; found {version}")
    output.mkdir(parents=True, exist_ok=False)
    env = os.environ.copy()
    temporary = None
    if not env.get("CARGO_TARGET_DIR"):
        temporary = tempfile.TemporaryDirectory(prefix="prl-state-review-target-")
        env["CARGO_TARGET_DIR"] = temporary.name
    else:
        env["CARGO_TARGET_DIR"] = str(Path(env["CARGO_TARGET_DIR"]).expanduser().resolve())
    try:
        runs = (ORIGINAL_RUNS if mode == "replay" else ORIGINAL_RUNS[:1] if mode == "directed"
                else [("504f525441424c45", "40", "walks")])
        metadata = {
            "kind": f"hardened-v2-portable-{mode}",
            "started_utc": datetime.now(timezone.utc).isoformat(),
            "compiler": version,
            "original_snapshot_commit": (HERE / "provenance/original-production-head.txt").read_text().strip(),
            "harness_source_sha256": digest(HERE / "src/main.rs"),
            "runner_sha256": digest(HERE / "run_review.py"),
            "production_manifest_sha256": digest(HERE / "provenance/production-source.sha256"),
            "runs": runs,
            "note": "Live checkout dependency verified before build and after each run. Hardened v2 evidence is separate from the original campaign; repeated counts are not added to original totals.",
        }
        print("PASS exact source preflight. Building against the live checkout's pearl-core.")
        print("Hardened v2 harness: dependency is checkout/crates/pearl-core, never a bundled snapshot.")
        resolved = json.loads(subprocess.check_output(
            [cargo, "metadata", "--format-version", "1", "--locked", "--offline",
             "--manifest-path", str(HERE / "Cargo.toml")], cwd=HERE, env=env, text=True))
        core = [entry for entry in resolved["packages"] if entry["name"] == "pearl-core"]
        expected_core = (REPOSITORY / "crates/pearl-core/Cargo.toml").resolve()
        if len(core) != 1 or Path(core[0]["manifest_path"]).resolve() != expected_core:
            raise RuntimeError("source mismatch: Cargo resolved a different pearl-core dependency")
        metadata["resolved_core_manifest"] = "crates/pearl-core/Cargo.toml"
        metadata["resolved_core_matches_preflight"] = True
        run_logged([cargo, "build", "--locked", "--offline", "--release", "--manifest-path", str(HERE / "Cargo.toml")], output / "build.log", env)
        preflight()
        executable = Path(env["CARGO_TARGET_DIR"]) / "release" / ("prl-core-state-review.exe" if os.name == "nt" else "prl-core-state-review")
        metadata["portable_executable_sha256"] = digest(executable)
        for seed, episodes, suite in runs:
            log = output / f"seed-{seed}-{suite}.log"
            run_logged([str(executable), seed, episodes, suite], log, env)
            preflight()
            if "PASS TOTAL" not in log.read_text(encoding="utf-8"):
                raise RuntimeError("harness did not report completed coverage")
        metadata["completed_utc"] = datetime.now(timezone.utc).isoformat()
        metadata["status"] = "PASS"
        (output / "metadata.json").write_text(json.dumps(metadata, indent=2) + "\n", encoding="utf-8")
        print(f"PASS {mode}; fresh evidence is in {output}")
    finally:
        if temporary is not None:
            temporary.cleanup()


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=["preflight", "smoke", "directed", "replay"])
    parser.add_argument("--output", type=Path, help="new evidence directory; existing directories are refused")
    args = parser.parse_args()
    try:
        if args.mode == "preflight":
            preflight()
            print("PASS exact production and harness source preflight")
        else:
            stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
            output = args.output.resolve() if args.output else HERE / "results/replays" / f"{args.mode}-{stamp}"
            execute(args.mode, output)
    except (RuntimeError, OSError, subprocess.SubprocessError) as error:
        print(f"REFUSED: {error}. Build/replay stopped without a mismatch override.", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
