#!/usr/bin/env python3
"""Test preflight refusals, optionally actual smoke execution, using paths with spaces."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import run_mutations as runner


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repository', type=Path, required=True)
    p.add_argument('--package', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--smoke', action='store_true')
    p.add_argument('--cargo', default=os.environ.get('CARGO', 'cargo'))
    p.add_argument('--rustc', default=os.environ.get('RUSTC', 'rustc'))
    p.add_argument('--cargo-home', default=os.environ.get('CARGO_HOME'))
    p.add_argument('--rustup-home', default=os.environ.get('RUSTUP_HOME'))
    a = p.parse_args()
    core, harness = runner.preflight(a.repository.resolve(), a.package.resolve(), 'v2')
    output = a.output.expanduser().resolve()
    output.mkdir(parents=True, exist_ok=False)
    results = []
    with tempfile.TemporaryDirectory(prefix='pearl audit input spaces ') as temporary:
        repo = Path(temporary) / 'repository with spaces'
        package = repo / 'tools' / 'review package with spaces'
        for rel,data in core.items():
            path = repo / rel; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        for rel,data in harness.items():
            path = package / rel; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(data)
        for name in ('production-source.sha256','portable-build.sha256'):
            path = package/'provenance'/name; path.parent.mkdir(parents=True,exist_ok=True)
            path.write_bytes((runner.HERE/'provenance'/name).read_bytes())
        command = [sys.executable,str(runner.HERE/'run_mutations.py'),'preflight',
                   '--repository',str(repo),'--package',str(package)]
        def check(name,expected):
            run = subprocess.run(command,capture_output=True,text=True,timeout=10)
            row = {'case':name,'exit':run.returncode,'expected_exit':expected,'output':run.stdout+run.stderr}
            results.append(row); print(json.dumps(row),flush=True)
            assert run.returncode==expected,row
        check('valid_inputs_with_spaces',0)
        path=repo/'crates/pearl-core/src/session.rs'; original=path.read_bytes()
        path.write_bytes(original+b'\n// changed\n');check('changed_core_refused',2);path.write_bytes(original)
        path=package/'Cargo.toml';original=path.read_bytes()
        path.write_bytes(original.replace(b'../../crates/pearl-core',b'../../crates/wrong'))
        check('redirected_dependency_refused',2);path.write_bytes(original)
        path=repo/'crates/pearl-core/src/unreviewed.rs';path.write_text('// extra\n')
        check('extra_source_refused',2);path.unlink()
        path=package/'build.rs';path.write_text('fn main() {}\n')
        check('build_script_refused',2);path.unlink()
        check('restored_inputs_with_spaces',0)
        if a.smoke:
            command[2]='smoke'
            command += ['--cargo',a.cargo,'--rustc',a.rustc,'--output',str(output/'smoke with spaces')]
            if a.cargo_home:command += ['--cargo-home',a.cargo_home]
            if a.rustup_home:command += ['--rustup-home',a.rustup_home]
            result=subprocess.run(command,capture_output=True,text=True,timeout=600)
            (output/'smoke-driver.log').write_text(result.stdout+result.stderr)
            print(result.stdout+result.stderr,flush=True)
            results.append({'case':'actual_smoke_with_spaces','exit':result.returncode,'expected_exit':0})
            assert result.returncode==0
    (output/'portability-summary.json').write_text(json.dumps(results,indent=2)+'\n')
    return 0


if __name__=='__main__':
    raise SystemExit(main())
