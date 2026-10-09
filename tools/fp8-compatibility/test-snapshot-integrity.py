#!/usr/bin/env python3
"""Local adversarial replay controls; makes only temporary public-source copies."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
from unittest import mock
sys.dont_write_bytecode = True

here = Path(__file__).resolve().parent
repo = Path(sys.argv[1]).resolve()
work = Path(sys.argv[2]).resolve()
work.mkdir(parents=True, exist_ok=True)
base = Path(tempfile.mkdtemp(prefix='integrity-controls.', dir=work))
snapshot = base/'snapshots'/'released'
snapshot.mkdir(parents=True)
commit = '2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4'
archive = subprocess.Popen(['git','-C',str(repo),'archive',commit], stdout=subprocess.PIPE,
                           env=dict(os.environ,GIT_NO_LAZY_FETCH='1'))
subprocess.run(['tar','-x','-C',str(snapshot)],stdin=archive.stdout,check=True)
archive.stdout.close()
assert archive.wait() == 0
results=[]

def check(name, success, message=None):
    result=subprocess.run([sys.executable,str(here/'verify-snapshot.py'),str(repo),commit,str(snapshot)],text=True,capture_output=True)
    assert (result.returncode==0)==success,(name,result.stdout,result.stderr)
    if message:assert message in result.stderr,(name,result.stderr)
    results.append({'case':name,'expectedSuccess':success,'exitCode':result.returncode,'diagnostic':result.stderr.strip()})

check('clean official snapshot',True)
extra=snapshot/'node/txscript/zzz_untracked.go'
extra.write_text('package txscript\nfunc init(){panic("untracked source must never compile")}\n')
check('unexpected Go source rejected',False,'Unexpected source entry')
# Ensure the full replay fails before it invokes any Go command beyond version.
# A path containing spaces also exercises the quoted GO_BIN version check.
guard=base/'go path with spaces';guard.mkdir()
marker=base/'compiler-was-invoked';go=guard/'go'
go.write_text('#!/bin/sh\nif [ "$1" = version ]; then echo "go version go1.26.6 linux/amd64"; exit 0; fi\nprintf invoked > "$COMPILER_MARKER"\nexit 99\n')
go.chmod(0o755)
env=dict(os.environ,GO_BIN=str(go),COMPILER_MARKER=str(marker),PEARL_UPSTREAM_GIT=str(repo),PEARL_COMPAT_SNAPSHOTS=str(base/'snapshots'),PEARL_COMPAT_WORK=str(base/'replay'),GOPROXY='off')
blocked=subprocess.run(['bash',str(here/'replay.sh')],env=env,text=True,capture_output=True)
assert blocked.returncode!=0 and 'Unexpected source entry: node/txscript/zzz_untracked.go' in blocked.stderr
assert not marker.exists(),'Compiler ran with an untracked source'
results.append({'case':'replay rejects extra Go source before compiler; GO_BIN path contains spaces','exitCode':blocked.returncode,'compilerInvoked':False,'diagnostic':blocked.stderr.strip()})
extra.unlink()
extra.symlink_to(base/'does-not-exist')
check('unexpected dangling symlink rejected',False,'Unexpected source entry');extra.unlink()
extra_dir=snapshot/'unexpected-empty-directory';extra_dir.mkdir()
check('unexpected empty directory rejected',False,'Unexpected directory');extra_dir.rmdir()
node=snapshot/'node';held=base/'held-node';node.rename(held);node.symlink_to(held,target_is_directory=True)
check('substituted directory symlink rejected without following it',False,'Unexpected source entry');node.unlink();held.rename(node)
tracked=snapshot/'node/wire/msgtx.go';original=tracked.read_bytes();mode=tracked.stat().st_mode&0o777
outside=base/'same-contents.go';outside.write_bytes(original);tracked.unlink();tracked.symlink_to(outside)
check('tracked regular file substituted with symlink rejected',False,'Expected regular source file');tracked.unlink();tracked.write_bytes(original);tracked.chmod(mode)
tracked.write_bytes(original+b'\n// mutation\n')
check('tracked content mutation rejected',False,'content mismatch');tracked.write_bytes(original)
tracked.chmod(mode|0o100)
check('wrong Git executable mode rejected',False,'Git executable mode mismatch');tracked.chmod(mode)
held_file=base/'held-msgtx.go';tracked.rename(held_file)
check('missing source rejected',False,'Missing source entry');held_file.rename(tracked)
submodule=snapshot/'miner/pearl-gemm/third_party/cutlass'/'unverified.go';submodule.write_text('package unverified\n')
check('unverified gitlink contents rejected',False,'Unexpected source entry');submodule.unlink()
check('restored snapshot and source hash stable',True)
# These pins contain no symlink blobs. Exercise exact-target handling with a
# mocked immutable ls-tree manifest, without creating a Git commit.
spec=importlib.util.spec_from_file_location('snapshot_verifier',here/'verify-snapshot.py');module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
unit=base/'symlink-unit';unit.mkdir();outside_dir=base/'outside-dir';outside_dir.mkdir();(outside_dir/'must-not-be-enumerated').write_text('control')
link=unit/'pinned-link';target='../outside-dir';link.symlink_to(target,target_is_directory=True)
data=target.encode();oid=hashlib.sha1(b'blob '+str(len(data)).encode()+b'\0'+data).hexdigest()
manifest=f'120000 blob {oid}\tpinned-link\0'.encode()
with mock.patch.object(module.subprocess,'check_output',return_value=manifest):
    module.verify(str(repo),commit,unit)
    results.append({'case':'pinned symlink target verified without dereferencing outside directory','expectedSuccess':True})
    link.unlink();link.symlink_to('../different-target')
    try:module.verify(str(repo),commit,unit)
    except ValueError as e:
        assert 'content mismatch' in str(e)
        results.append({'case':'wrong pinned symlink target rejected','expectedSuccess':False,'diagnostic':str(e)})
    else:raise AssertionError('Changed pinned symlink target accepted')
report={'cases':results,'allControlsPassed':True,'productionSourceModified':False,'upstreamCommit':commit}
(work/'integrity-regression-results.json').write_text(json.dumps(report,indent=2)+'\n')
print(json.dumps(report,indent=2))
