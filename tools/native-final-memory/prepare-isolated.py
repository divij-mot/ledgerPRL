#!/usr/bin/env python3
"""Prepare a wholly isolated final-source measurement mirror; never mutate release SDKs."""
import argparse
import hashlib
import json
import pathlib
import shutil
import subprocess
import sys
if not __debug__:
    raise SystemExit("Isolation checks require assertions; rerun without -O, -OO, or PYTHONOPTIMIZE")
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
ROOT = args.source.resolve()
OUT = args.output.resolve()
if OUT.is_relative_to(ROOT):
    raise SystemExit("Output must be outside the source checkout")
MIRROR = OUT / 'mirror'
assert not OUT.exists(), 'Fresh directory required'
assert hashlib.sha256((ROOT/'apps/ledger/src/crypto.rs').read_bytes()).hexdigest() == '50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1'
OUT.mkdir(); MIRROR.mkdir()
native = json.loads(subprocess.check_output(['python3','scripts/ledger-build-manifest.py','snapshot'],cwd=ROOT))
assert native == json.loads((pathlib.Path(__file__).resolve().parent/'parent-native-source-before.json').read_text()), 'Native source differs from this qualification'
(OUT/'parent-native-source-before.json').write_text(json.dumps(native,indent=2)+'\n')
files = set(native) | {'package.json','package-lock.json','apps/ledger/patches/memory-instrumentation.patch','scripts/ledger-build-instrumented.sh'}
for folder in ('apps/ledger/tests','packages/sdk/src','crates/pearl-core','fixtures'):
    files.update(str(p.relative_to(ROOT)) for p in (ROOT/folder).rglob('*') if p.is_file() and 'target' not in p.parts and 'evidence' not in p.parts and '__pycache__' not in p.parts)
files = sorted(files)
for rel in files:
    target=MIRROR/rel; target.parent.mkdir(parents=True,exist_ok=True); shutil.copy2(ROOT/rel,target)
for vendor in ('ledger-device-rust-sdk','ledger-secure-sdk'):
    source=ROOT/'apps/ledger/vendor'/vendor
    target=MIRROR/'apps/ledger/vendor'/vendor
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copytree(source,target,symlinks=True)
    assert source.stat().st_ino != target.stat().st_ino
(MIRROR/'node_modules').symlink_to(ROOT/'node_modules',target_is_directory=True)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
(OUT/'mirror-input-hashes.json').write_text(json.dumps({rel:sha(MIRROR/rel) for rel in files},indent=2)+'\n')
assert native == json.loads(subprocess.check_output(['python3','scripts/ledger-build-manifest.py','snapshot'],cwd=MIRROR))
for vendor in ('ledger-device-rust-sdk','ledger-secure-sdk'):
    source=ROOT/'apps/ledger/vendor'/vendor
    target=MIRROR/'apps/ledger/vendor'/vendor
    for args in (['rev-parse','HEAD'],['diff','HEAD','--binary'],['ls-files','--others','--exclude-standard']):
        expected=subprocess.check_output(['git','-C',str(source),*args])
        actual=subprocess.check_output(['git','-C',str(target),*args])
        assert actual==expected
print(MIRROR)
