#!/usr/bin/env python3
"""Exercise portable fail-closed checks in isolated fixtures, never source checkout."""
from __future__ import annotations

import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
REPOSITORY = HERE.parent.parent


def main() -> int:
    baseline = subprocess.run([sys.executable, str(HERE / "run_review.py"), "preflight"],
                              text=True, capture_output=True)
    if baseline.returncode:
        print(baseline.stderr, end="", file=sys.stderr)
        return baseline.returncode
    results = []
    with tempfile.TemporaryDirectory(prefix="pearl portability cases with spaces ") as tmp:
        cases = Path(tmp)
        expected = HERE / "provenance/production-source.sha256"
        inputs = [line.split("  ", 1)[1] for line in expected.read_text().splitlines()]
        for name in ("baseline", "changed-source", "missing-source", "extra-source",
                     "extra-build-script", "changed-root-manifest", "changed-core-manifest",
                     "changed-lockfile", "source-symlink", "changed-harness", "manifest-inventory",
                     "changed-portable-manifest", "changed-portable-lockfile", "extra-harness-source", "extra-harness-build-script", "root-cargo-config", "tools-cargo-config", "harness-cargo-config"):
            repo = cases / name / "checkout with spaces"
            package = repo / "tools/core-state-review"
            shutil.copytree(HERE, package, ignore=shutil.ignore_patterns("target", "replays", "__pycache__"))
            for relative in inputs:
                destination = repo / relative
                destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(REPOSITORY / relative, destination)
            session = repo / "crates/pearl-core/src/session.rs"
            if name == "changed-source":
                session.write_bytes(session.read_bytes() + b"\n// modified\n")
            elif name == "missing-source":
                session.unlink()
            elif name == "extra-source":
                (session.parent / "unreviewed.rs").write_text("// unreviewed\n")
            elif name == "extra-build-script":
                (repo / "crates/pearl-core/build.rs").write_text("fn main() {}\n")
            elif name == "changed-root-manifest":
                path = repo / "Cargo.toml"
                path.write_bytes(path.read_bytes() + b"\n")
            elif name == "changed-core-manifest":
                path = repo / "crates/pearl-core/Cargo.toml"
                path.write_bytes(path.read_bytes() + b"\n")
            elif name == "changed-lockfile":
                path = repo / "Cargo.lock"
                path.write_bytes(path.read_bytes() + b"\n")
            elif name == "source-symlink":
                target = repo / "original-session.rs"
                shutil.move(session, target)
                session.symlink_to(target)
            elif name == "changed-harness":
                path = package / "src/main.rs"
                path.write_bytes(path.read_bytes() + b"\n")
            elif name == "manifest-inventory":
                path = package / "provenance/production-source.sha256"
                path.write_text("\n".join(path.read_text().splitlines()[:-1]) + "\n")
            elif name == "changed-portable-manifest":
                path = package / "Cargo.toml"
                path.write_bytes(path.read_bytes() + b"\n")
            elif name == "changed-portable-lockfile":
                path = package / "Cargo.lock"
                path.write_bytes(path.read_bytes() + b"\n")
            elif name == "extra-harness-source":
                (package / "src/unreviewed.rs").write_text("// unreviewed\n")
            elif name == "extra-harness-build-script":
                (package / "build.rs").write_text("fn main() {}\n")
            elif name in ("root-cargo-config", "tools-cargo-config", "harness-cargo-config"):
                directory = {"root-cargo-config": repo, "tools-cargo-config": package.parent,
                             "harness-cargo-config": package}[name] / ".cargo"
                directory.mkdir()
                (directory / "config.toml").write_text("[build]\nrustflags = []\n")
            env = os.environ.copy()
            env["CARGO"] = "must-not-invoke-cargo-for-mismatched-source"
            env["RUSTC"] = "must-not-invoke-rustc-for-mismatched-source"
            output = repo / "must not be created"
            mode = "preflight" if name == "baseline" else "smoke"
            result = subprocess.run([sys.executable, str(package / "run_review.py"), mode,
                                     "--output", str(output)], cwd=cases,
                                    env=env, text=True, capture_output=True)
            if name == "baseline":
                assert result.returncode == 0, result.stderr
            else:
                assert result.returncode == 2, (name, result.returncode, result.stderr)
                assert "REFUSED:" in result.stderr, (name, result.stderr)
                assert "unavailable" not in result.stderr, (name, "toolchain reached before refusal")
                assert not output.exists(), (name, "output created before refusal")
            record = {"case": name, "exit": result.returncode,
                      "result": (result.stdout + result.stderr).strip(), "passed": True}
            results.append(record)
            print(f"PASS {name}")
    print(json.dumps({"kind": "portability-preflight-tests", "cases": results}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
