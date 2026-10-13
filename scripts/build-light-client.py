#!/usr/bin/env python3
"""Build the local watch-only facade with Pearl's unmodified native verifiers."""
import hashlib
import json
import os
import platform
from pathlib import Path
import shutil
import subprocess
import tarfile
import tempfile
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
COMMIT = "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701"
ARCHIVE_SHA256 = "26dec47642a249fa1728f2520670d4d3b2788696207a3c074e0382cc63237396"
URL = f"https://codeload.github.com/pearl-research-labs/pearl/tar.gz/{COMMIT}"
CACHE = ROOT / ".tools" / "light-client"
BUILD_RECIPE = 2
# Exact recipe from the checksum-pinned upstream archive. Only its object
# directory and failure propagation are adapted; verifier sources stay unchanged.
XMSS_RECIPE = """libxmss.a: $(SOURCES) $(HEADERS) src/xmss.cpp xmss.h
\t@mkdir -p /tmp/xmss_build_$$$$; \\
\tfor src in $(SOURCES); do \\
\t\t$(CC) $(CFLAGS) -c -o /tmp/xmss_build_$$$$/`basename $$src .c`.o $$src; \\
\tdone; \\
\t$(CXX) $(CXXFLAGS) -c -o /tmp/xmss_build_$$$$/xmss.o src/xmss.cpp; \\
\t$(AR) rcs $@ /tmp/xmss_build_$$$$/*.o; \\
\trm -rf /tmp/xmss_build_$$$$
"""


def digest(path):
    result = hashlib.sha256()
    with path.open("rb") as stream:
        while chunk := stream.read(1024 * 1024):
            result.update(chunk)
    return result.hexdigest()


def run(args, cwd, env):
    subprocess.run(args, cwd=cwd, env=env, check=True)


def build_xmss(source, staging, env):
    makefile = source / "xmss/Makefile"
    original = makefile.read_text()
    if original.count(XMSS_RECIPE) != 1 or original.count("/tmp/xmss_build_$$$$") != 5:
        raise RuntimeError("Pinned XMSS build recipe changed")
    recipe = XMSS_RECIPE.replace("/tmp/xmss_build_$$$$", '"$$PEARL_XMSS_OBJECTS"')
    recipe = recipe.replace("@mkdir -p", "@set -eu; mkdir -p", 1)
    makefile.write_text(original.replace(XMSS_RECIPE, recipe))
    with tempfile.TemporaryDirectory(prefix="xmss-objects-", dir=staging) as objects:
        run(["make"], source / "xmss", dict(env, PEARL_XMSS_OBJECTS=objects))


def main():
    os.umask(0o077)
    CACHE.mkdir(parents=True, exist_ok=True, mode=0o700)
    archive = CACHE / "pearl-source.tar.gz"
    if not archive.exists():
        partial = archive.with_suffix(".download")
        try:
            with urllib.request.urlopen(URL, timeout=60) as response, partial.open("xb") as out:
                total = 0
                while chunk := response.read(1024 * 1024):
                    total += len(chunk)
                    if total > 64 * 1024 * 1024:
                        raise RuntimeError("Source archive exceeds its bound")
                    out.write(chunk)
            if digest(partial) != ARCHIVE_SHA256:
                raise RuntimeError("Official source archive checksum mismatch")
            partial.replace(archive)
        finally:
            partial.unlink(missing_ok=True)
    if archive.is_symlink() or digest(archive) != ARCHIVE_SHA256:
        raise RuntimeError("Pinned source archive checksum mismatch")
    env = dict(os.environ, CGO_ENABLED="1", CGO_LDFLAGS_ALLOW=".*zk_pow_ffi.*",
               GOTOOLCHAIN="go1.26.6", CARGO_BUILD_JOBS="6")
    env.setdefault("CARGO_HOME", str(CACHE / "cargo"))
    env.setdefault("GOMODCACHE", str(CACHE / "gomod"))
    env.setdefault("GOCACHE", str(CACHE / "gocache"))
    if platform.system() == "Darwin":
        # Keep Rust/C and Go's linker on the same deployment target.
        env.setdefault("MACOSX_DEPLOYMENT_TARGET", platform.mac_ver()[0])
    # Keep upstream Cargo crates outside this repository's unrelated Rust workspace.
    with tempfile.TemporaryDirectory(prefix="pearl-light-build-") as staging:
        staging = Path(staging)
        with tarfile.open(archive, "r:gz") as bundle:
            members = bundle.getmembers()
            prefix = f"pearl-{COMMIT}"
            for member in members:
                parts = Path(member.name).parts
                if (not parts or parts[0] != prefix or ".." in parts or
                        Path(member.name).is_absolute() or not (member.isfile() or member.isdir())):
                    raise RuntimeError("Unexpected source archive entry")
                member.mode &= 0o777
            if sum(member.size for member in members) > 128 * 1024 * 1024:
                raise RuntimeError("Expanded source exceeds its bound")
            bundle.extractall(staging, members=members)
        source = staging / prefix
        run(["cargo", "+1.90.0", "run", "--locked", "--release", "--no-default-features",
             "--bin", "build_cache", "src/circuit/v2_cache.bin", "src/v1/v1_cache.bin"], source / "zk-pow", env)
        run(["cargo", "+1.90.0", "build", "--locked", "--release"], source / "zk-pow/bindings/go", env)
        build_xmss(source, staging, env)
        helper = staging / "helper"
        shutil.copytree(ROOT / "apps/light-client", helper,
                        ignore=shutil.ignore_patterns("bin", "target"))
        helper_sources = {"apps/light-client/" + str(path.relative_to(helper)): digest(path)
                          for path in sorted(helper.rglob("*"))
                          if path.is_file() and (path.suffix == ".go" or path.name in ("go.mod", "go.sum"))}
        run(["go", "mod", "edit", f"-replace=github.com/pearl-research-labs/pearl={source}"], helper, env)
        run(["go", "test", "-mod=readonly", "-tags=xmss,zkpow", "./cmd/pearl-watch"], helper, env)
        binary = staging / "pearl-watch"
        run(["go", "build", "-mod=readonly", "-trimpath", "-tags=xmss,zkpow", "-o", str(binary),
             "./cmd/pearl-watch"], helper, env)
        output = CACHE / "pearl-watch"
        manifest = {"schema": 1, "buildRecipe": BUILD_RECIPE,
                    "sourceCommit": COMMIT, "archiveSha256": ARCHIVE_SHA256,
                    "executable": str(output), "executableSha256": digest(binary),
                    "buildTags": ["xmss", "zkpow"],
                    "helperSources": helper_sources}
        binary.chmod(0o700)
        staged_binary = CACHE / "pearl-watch.new"
        shutil.copyfile(binary, staged_binary)
        staged_binary.chmod(0o700)
        staged_binary.replace(output)
        (CACHE / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
        print(f"Local light client built: {output}")


if __name__ == "__main__":
    main()
