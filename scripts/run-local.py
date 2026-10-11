#!/usr/bin/env python3
"""Prepare this checkout, then run the existing local wallet in the foreground."""
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import stat
import subprocess
import sys


def private_file(path):
    info = path.lstat()
    return (stat.S_ISREG(info.st_mode) and info.st_uid == os.getuid()
            and info.st_mode & 0o077 == 0 and info.st_nlink == 1
            and path.resolve() == path)


def helper_current(root, build):
    """Build-cache decision only; the existing service rechecks identity at use."""
    try:
        manifest_path = root / ".tools/light-client/manifest.json"
        executable = root / ".tools/light-client/pearl-watch"
        if (not private_file(manifest_path) or manifest_path.stat().st_size > 4096
                or not private_file(executable) or not os.access(executable, os.X_OK)):
            return False
        manifest = json.loads(manifest_path.read_text())
        if (manifest.get("schema") != 1 or manifest.get("sourceCommit") != build["COMMIT"]
                or manifest.get("archiveSha256") != build["ARCHIVE_SHA256"]
                or manifest.get("buildTags") != ["xmss", "zkpow"]
                or manifest.get("executable") != str(executable)
                or manifest.get("executableSha256") != build["digest"](executable)):
            return False
        source_root = root / "apps/light-client"
        if source_root.resolve() != source_root:
            return False
        sources = {}
        for directory, folders, files in os.walk(source_root, followlinks=False):
            folders[:] = [name for name in folders if name not in ("bin", "target")]
            for name in folders + files:
                path = Path(directory) / name
                if path.is_symlink():
                    return False
                if path.is_file() and (path.suffix == ".go" or name in ("go.mod", "go.sum")):
                    sources[path.relative_to(root).as_posix()] = build["digest"](path)
        return len(sources) >= 3 and sources == manifest.get("helperSources")
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def require_command(name):
    executable = shutil.which(name)
    if not executable:
        raise RuntimeError(f"Missing {name}; install the local build prerequisites described in docs/live-app.md.")
    return executable


def run(root):
    root = root.resolve()
    if os.name != "posix":
        raise RuntimeError("This local launcher currently supports macOS and Linux.")
    node, npm = shutil.which("node"), shutil.which("npm")
    node_setup = ("Install Node 24.19 or newer 24.x with npm from https://nodejs.org/en/download "
                  "using your normal installer, open a new terminal, then rerun "
                  "python3 scripts/run-local.py.")
    if not node or not npm:
        missing = ", ".join(name for name, path in (("node", node), ("npm", npm)) if not path)
        raise RuntimeError(f"Missing {missing}. {node_setup}")
    version = subprocess.run([node, "--version"], check=True, text=True, capture_output=True).stdout.strip()
    parts = re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", version)
    if not parts or int(parts[1]) != 24 or int(parts[2]) < 19:
        raise RuntimeError(f"Unsupported Node version {version}. {node_setup}")
    # The builder writes this cache. Never rebuild through an alias or hard link.
    for relative in (".tools", ".tools/light-client", ".tools/light-client/manifest.json",
                     ".tools/light-client/pearl-watch"):
        path = root / relative
        if path.exists() or path.is_symlink():
            info = path.lstat()
            if (path.resolve() != path or path.is_symlink() or info.st_uid != os.getuid()
                    or (path.is_file() and info.st_nlink != 1)):
                raise RuntimeError(f"Unsafe local build cache path: {relative}; resolve it before rebuilding.")
    # Reuse the builder's immutable upstream identity and streaming hash function.
    build = runpy.run_path(str(root / "scripts/build-light-client.py"))
    rebuild = not helper_current(root, build)
    if rebuild:
        # Upstream XMSS uses these absolute C/C++ compiler paths and `ar`.
        for command in ("go", "cargo", "rustup", "make", "cc", "ar",
                        "/usr/bin/gcc", "/usr/bin/g++"):
            require_command(command)
        toolchains = subprocess.run(["rustup", "toolchain", "list"], check=True,
                                   text=True, capture_output=True).stdout
        if not any(line.split()[0].startswith("1.90.0-") or line.split()[0] == "1.90.0"
                   for line in toolchains.splitlines() if line.strip()):
            raise RuntimeError("Rust 1.90.0 must already be installed. The launcher does not install global toolchains.")
    print("Installing locked local dependencies…", flush=True)
    subprocess.run([npm, "ci", "--ignore-scripts", "--include=dev"], cwd=root, check=True)
    if rebuild:
        print("Building the native light client; first setup can take several minutes…", flush=True)
        subprocess.run([npm, "run", "setup:light"], cwd=root, check=True)
    if not helper_current(root, build):
        raise RuntimeError("Native helper identity is incomplete or stale after setup; the wallet was not started.")
    print("Starting local Pearl. Keep this terminal open; Ctrl-C stops it. Initial chain sync can take time.", flush=True)
    os.chdir(root)
    os.environ["PEARL_OPEN_BROWSER"] = "1"
    os.execv(npm, [npm, "start"])


if __name__ == "__main__":
    try:
        run(Path(__file__).resolve().parents[1])
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f"Pearl local startup failed: {error}", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
