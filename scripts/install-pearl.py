#!/usr/bin/env python3
"""Build a pinned Pearl image; touch USB only when explicitly given --install."""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[1]
NAMES = {"nano-s-plus": "Nano S Plus", "nano-x": "Nano X", "stax": "Stax",
         "flex": "Flex", "gen5": "Nano Gen5"}


def call(args, **kwargs):
    return subprocess.run([str(value) for value in args], check=True, **kwargs)


def output(args, **kwargs):
    return call(args, text=True, capture_output=True, **kwargs).stdout.strip()


def release_for(model):
    release = json.loads((ROOT / "apps/ledger-bitcoin-prl/release.json").read_text())
    if release["schema"] != 1 or release["network"] != "mainnet":
        raise RuntimeError("Unsupported firmware release manifest")
    return release, release["models"][model]


def check_sdk(sdk, release):
    if output(["git", "-C", sdk, "rev-parse", "HEAD"]) != release["sdkCommit"]:
        raise RuntimeError("SDK revision does not match the release")
    if output(["git", "-C", sdk, "status", "--porcelain"]):
        raise RuntimeError("SDK is modified; use a clean checkout")


def check_source(workspace, release):
    sources = json.loads(output([sys.executable,
        workspace / "tools/bitcoin-prl-port/provenance.py", "snapshot"]))
    if sources != release["sourceFiles"]:
        raise RuntimeError("Firmware source differs from the reviewed release; nothing will be installed")


def check_image(folder, release, model):
    for filename, key in [("app.hex", "hexSha256"), ("app.elf", "elfSha256")]:
        if hashlib.sha256((folder / filename).read_bytes()).hexdigest() != model[key]:
            raise RuntimeError(f"{filename} differs from the reviewed release; nothing will be installed")
    helper = ROOT / "tools/pearl-name-review/inspect-metadata.py"
    spec = importlib.util.spec_from_file_location("pearl_metadata", helper)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    checked = module.inspect(folder / "app.elf", "mainnet", version=release["version"],
                             target=model["target"], flags=model["appFlags"])
    metadata = checked["metadata"]
    if (metadata["ledger.target_id"] != model["targetId"]
            or int(metadata["ledger.api_level"]) != model["apiLevel"]):
        raise RuntimeError("Compiled device target/API differs from release")
    symbols = {}
    wanted = {"_nvram_data", "_envram_data", "_install_parameters", "_einstall_parameters"}
    for line in (folder / "app.map").read_text().splitlines():
        fields = line.split()
        if len(fields) >= 7 and fields[-2:] == ["=", "."] and fields[-3] in wanted:
            if fields[-3] in symbols:
                raise RuntimeError("Duplicate linker metadata")
            symbols[fields[-3]] = int(fields[0], 16)
    if (symbols["_envram_data"] - symbols["_nvram_data"] != model["dataSize"]
            or symbols["_einstall_parameters"] - symbols["_install_parameters"] != model["installparamsSize"]):
        raise RuntimeError("Installation sizes differ from the verified image")


def loader_arguments(python, folder, model):
    return [str(python), "-m", "ledgerblue.loadApp", "--targetId", model["targetId"],
            "--targetVersion", "", "--apiLevel", str(model["apiLevel"]),
            "--fileName", str(folder / "app.hex"), "--appName", "Pearl",
            "--appFlags", model["appFlags"], "--tlv", "--dataSize", str(model["dataSize"]),
            "--installparamsSize", str(model["installparamsSize"])]


def run(model_name, install=False, sdk=None):
    if os.name != "posix" or sys.version_info < (3, 11):
        raise RuntimeError("Use Python 3.11 or later on macOS/Linux with Docker installed")
    if install and model_name == "nano-x":
        raise RuntimeError("Retail Nano X cannot sideload apps; Ledger distribution is required")
    for name in ["git", "docker"]:
        if not shutil.which(name):
            raise RuntimeError(f"Install {name} first, then rerun this command")
    release, model = release_for(model_name)
    call(["docker", "info"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    base = Path(tempfile.mkdtemp(prefix="pearl-ledger-" + release["version"] + "-"))
    work = base / "workspace"
    (work / "apps").mkdir(parents=True)
    (work / "tools/bitcoin-prl-port").mkdir(parents=True)
    shutil.copytree(ROOT / "apps/ledger-bitcoin-prl", work / "apps/ledger-bitcoin-prl",
                    ignore=shutil.ignore_patterns("build", "bin", "debug", "build-artifacts", ".git"))
    for name in ["build.sh", "provenance.py"]:
        shutil.copy2(ROOT / "tools/bitcoin-prl-port" / name, work / "tools/bitcoin-prl-port" / name)
    call(["git", "init", "-q", work])
    check_source(work, release)
    if sdk is None:
        sdk = base / "sdk"
        print("Downloading the pinned Ledger SDK…", flush=True)
        call(["git", "clone", "--depth", "1", "--branch", release["sdkTag"],
              "https://github.com/LedgerHQ/ledger-secure-sdk.git", sdk],
             env={**os.environ, "GIT_LFS_SKIP_SMUDGE": "1"})
    sdk = Path(sdk).resolve()
    check_sdk(sdk, release)
    cached = subprocess.run(["docker", "image", "inspect", release["builder"]],
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    if cached.returncode:
        call(["docker", "pull", "--platform", release["platform"], release["builder"]])
    print(f"Building Pearl {release['version']} for {NAMES[model_name]}…", flush=True)
    call(["docker", "run", "--rm", "--platform", release["platform"], "--network", "none",
          "--read-only", "--cap-drop", "ALL", "--security-opt", "no-new-privileges",
          "--user", f"{os.getuid()}:{os.getgid()}", "--tmpfs", "/tmp:rw,size=512m",
          "-v", f"{work}:/workspace", "-v", f"{sdk}:/sdk:ro", "-w", "/workspace",
          "-e", "BOLOS_SDK=/sdk", "-e", "PRL_SYSROOT=/usr/lib/arm-none-eabi",
          "--entrypoint", "/bin/bash", release["builder"], "-c",
          'export PATH=/usr/lib/llvm-21/bin:$PATH; bash tools/bitcoin-prl-port/build.sh "$1" mainnet',
          "pearl-build", model["target"]])
    folder = work / "apps/ledger-bitcoin-prl/build-artifacts" / (model["target"] + "-mainnet")
    check_source(work, release)
    check_image(folder, release, model)
    print(f"Verified build: {folder / 'app.hex'}", flush=True)
    if not install:
        print("Build only. No Ledger device was accessed.", flush=True)
        return folder
    python = base / "loader/bin/python"
    call([sys.executable, "-m", "venv", base / "loader"])
    call([python, "-m", "pip", "install", "ledgerblue==0.1.58"])
    call([python, "-c", 'import importlib.metadata as m; assert m.version("ledgerblue") == "0.1.58"'])
    # Recheck immediately before the only command permitted to open USB.
    check_image(folder, release, model)
    print(f"Close Ledger Wallet, connect/unlock your {NAMES[model_name]}, and approve Pearl installation on its screen.", flush=True)
    call(loader_arguments(python, folder, model))
    print("Installation command completed. Open Pearl on the device and verify its version.", flush=True)
    return folder


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("model", choices=NAMES)
    parser.add_argument("--install", action="store_true", help="after verification, run the USB loader (never deletes apps)")
    parser.add_argument("--sdk", type=Path, help="reuse an existing clean pinned SDK checkout")
    args = parser.parse_args()
    try:
        run(args.model, args.install, args.sdk)
    except (OSError, RuntimeError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        print(f"Pearl setup stopped: {error}", file=sys.stderr)
        print("No app deletion or OS update is performed. Resolve an existing-app/space error separately.", file=sys.stderr)
        sys.exit(1)
    except KeyboardInterrupt:
        sys.exit(130)
