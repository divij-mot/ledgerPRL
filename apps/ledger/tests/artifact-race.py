#!/usr/bin/env python3
"""Read a project's stage scripts; reproduce copy-time races in dummy temp trees only."""
import hashlib, json, os, pathlib, shutil, subprocess, sys, tempfile
root = pathlib.Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else pathlib.Path(__file__).resolve().parents[3]
results = []
for mode in ("elf-only", "complete-network-generation"):
    work = pathlib.Path(tempfile.mkdtemp(prefix="pearl-stage-race-audit-"))
    (work / "scripts").mkdir(); (work / "bin").mkdir()
    for name in ("ledger-stage-artifact.sh", "ledger-build-manifest.py"):
        shutil.copy2(root / "scripts" / name, work / "scripts" / name)
    elf = work / "apps/ledger/target/nanosplus/release/pearl-ledger"
    elf.parent.mkdir(parents=True); elf.write_bytes(b"regtest ELF placeholder\n")
    manifest = {"device": "nanosplus", "network": "regtest", "elfSha256": hashlib.sha256(elf.read_bytes()).hexdigest()}
    elf.with_suffix(".build.json").write_text(json.dumps(manifest))
    mutation = work / "mutate.py"
    mutation.write_text("import pathlib,hashlib,json,sys\np=pathlib.Path(sys.argv[1]);p.write_bytes(b'mainnet ELF placeholder\\n')\n" +
        ("p.with_suffix('.build.json').write_text(json.dumps({'device':'nanosplus','network':'mainnet','elfSha256':hashlib.sha256(p.read_bytes()).hexdigest()}))\n" if mode == "complete-network-generation" else ""))
    cp = work / "bin/cp"
    cp.write_text('#!/bin/bash\nset -euo pipefail\nif [[ "$1" = */release/pearl-ledger ]]; then python3 "' + str(mutation) + '" "$1"; fi\nexec /bin/cp "$@"\n')
    cp.chmod(0o755)
    env = dict(os.environ); env["PATH"] = str(work / "bin") + ":" + env["PATH"]
    stage = subprocess.run([str(work / "scripts/ledger-stage-artifact.sh"), "nanosplus", "regtest"], env=env, text=True, capture_output=True)
    artifact = work / "apps/ledger/target/artifacts/pearl-nanosplus-regtest.elf"
    record = {"mode": mode, "stageExitCode": stage.returncode, "stageStderr": stage.stderr, "published": artifact.exists(), "temporaryDirectory": str(work)}
    if artifact.exists():
        verify = subprocess.run(["python3", str(work / "scripts/ledger-build-manifest.py"), "verify", "--device", "nanosplus", "--network", "regtest", "--elf", str(artifact)], capture_output=True, text=True)
        record.update({"postStageVerifyExitCode": verify.returncode, "postStageVerifyStderr": verify.stderr})
    results.append(record)
    shutil.rmtree(work)
print(json.dumps(results, indent=2))
sys.exit(0 if all(x["stageExitCode"] != 0 and not x["published"] for x in results) else 1)
