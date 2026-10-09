#!/usr/bin/env python3
"""Run exact-final-source host controls without writing into the source repository."""
import argparse
import hashlib
import json
import os
import re
from pathlib import Path
import shutil
import subprocess
import sys

HERE = Path(__file__).resolve().parent
EXPECTED = json.loads((HERE / 'expected.json').read_text())
NEEDLE = '        self.0.curve.zeroize();'
OBSERVER = '\n        crate::observe_drop(&self.0.d, self.0.d_len, self.0.curve);'


def sha(data):
    return hashlib.sha256(data).hexdigest()


def verify(repo):
    hashes = {EXPECTED['cryptoPath']: EXPECTED['cryptoSha256'],
              **EXPECTED['sourceFiles'], **EXPECTED['referenceSourceFiles']}
    if (repo / 'crates/pearl-core/build.rs').exists():
        raise ValueError('Unexpected implicit core build.rs would expand the reviewed source inventory')
    actual_inventory = sorted(str(p.relative_to(repo)) for p in
                              (repo / 'crates/pearl-core/src').rglob('*.rs'))
    expected_inventory = sorted(p for p in hashes if p.startswith('crates/pearl-core/src/'))
    if actual_inventory != expected_inventory:
        raise ValueError('Live core Rust source inventory differs from the reviewed inventory')
    for relative, digest in hashes.items():
        path = repo / relative
        if not path.resolve().is_relative_to(repo):
            raise ValueError(f'Source escapes repository: {relative}')
        actual = sha(path.read_bytes())
        if actual != digest:
            raise ValueError(f'Source mismatch: {relative}: expected {digest}, got {actual}')
    for relative, commit in EXPECTED['sdkCommits'].items():
        actual = subprocess.check_output(['git', '-C', str(repo / relative),
                                          'rev-parse', 'HEAD'], text=True).strip()
        if actual != commit:
            raise ValueError(f'SDK revision mismatch: {relative}: {actual}')
    # Retain the preparation script's full tracked-delta guarantees, not only
    # the subset of SDK reference files cited by this audit.
    rust_sdk = repo / 'apps/ledger/vendor/ledger-device-rust-sdk'
    secure_sdk = repo / 'apps/ledger/vendor/ledger-secure-sdk'
    delta = subprocess.check_output(['git', '-C', str(rust_sdk), 'diff', 'HEAD', '--binary'])
    patch = (repo / 'apps/ledger/patches/strict-transport.patch').read_bytes()
    if sha(delta) != sha(patch):
        raise ValueError('Rust SDK tracked delta differs from the exact reviewed patch')
    if subprocess.check_output(['git', '-C', str(rust_sdk), 'ls-files', '--others', '--exclude-standard']):
        raise ValueError('Rust SDK has unreviewed untracked files')
    if subprocess.check_output(['git', '-C', str(secure_sdk), 'status', '--porcelain']):
        raise ValueError('Secure SDK checkout is not clean')
    for filename, field in [('harness.rs', 'harnessSha256'), ('Cargo.lock', 'lockSha256')]:
        if sha((HERE / filename).read_bytes()) != EXPECTED[field]:
            raise ValueError(f'Audit input mismatch: {filename}')
    return hashes


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--repo', required=True, type=Path)
    p.add_argument('--output', required=True, type=Path, help='Fresh output directory outside the repo')
    p.add_argument('--cargo', default='cargo')
    p.add_argument('--toolchain', default='stable')
    p.add_argument('--check-only', action='store_true')
    args = p.parse_args()
    repo, out = args.repo.resolve(), args.output.resolve()
    if not repo.is_dir():
        raise ValueError('Repository directory is missing')
    if out.is_relative_to(repo) or repo.is_relative_to(out):
        raise ValueError('Output must be a separate fresh directory outside the source repository')
    if out.exists():
        raise ValueError('Output already exists; use a fresh directory')
    for key in ['RUSTFLAGS', 'CARGO_ENCODED_RUSTFLAGS', 'RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER', 'CARGO_BUILD_TARGET']:
        if os.environ.get(key):
            raise ValueError(f'Unset ambient compiler override {key} for this controlled replay')
    before = verify(repo)
    source = (repo / EXPECTED['cryptoPath']).read_text()
    if re.search(r'\bdrop\s*\(\s*key\s*\)', source):
        raise ValueError('Explicit by-value drop(key) can leave the original secret slot unwiped; use lexical scopes')
    if source.count(NEEDLE) != 1:
        raise ValueError('Expected exactly one post-wipe observation location')
    instrumented = source.replace(NEEDLE, NEEDLE + OBSERVER)
    if instrumented.replace(NEEDLE + OBSERVER, NEEDLE) != source:
        raise ValueError('Instrumentation must consist solely of the documented observer call')
    out.mkdir(parents=True, exist_ok=False)
    (out / 'source-check.json').write_text(json.dumps({
        'sourceFiles': before, 'sdkCommits': EXPECTED['sdkCommits'],
        'sourceSha256': sha(source.encode()), 'instrumentedSha256': sha(instrumented.encode()),
        'scope': 'Host mocks; source/precondition verification is not deployment or physical verification'
    }, indent=2) + '\n')
    if args.check_only:
        print(f'Final-source preconditions verified: {out / "source-check.json"}')
        return
    project = out / 'host-project'
    (project / 'src').mkdir(parents=True)
    (project / 'src/crypto_instrumented.rs').write_text(instrumented)
    shutil.copyfile(HERE / 'harness.rs', project / 'src/lib.rs')
    shutil.copyfile(HERE / 'Cargo.lock', project / 'Cargo.lock')
    (project / 'Cargo.toml').write_text('''[package]
name = "prl-proposed-lifetime-audit"
version = "0.0.0"
edition = "2024"
[workspace]
[dependencies]
pearl-core = { path = ''' + json.dumps(str(repo / 'crates/pearl-core')) + ''' }
zeroize = { version = "=1.8.1", default-features = false }
sha2 = "=0.10.9"
secp256k1 = { version = "=0.29.1", features = ["global-context"] }
''')
    env = dict(os.environ)
    env['CARGO_TARGET_DIR'] = str(out / 'target')
    cargo = [args.cargo] + (['+' + args.toolchain] if args.toolchain else [])
    version = subprocess.check_output(cargo + ['--version'], text=True, env=env).strip()
    results = []
    for release in [False, True]:
        mode = 'release' if release else 'debug'
        cmd = cargo + ['test', '--manifest-path', str(project / 'Cargo.toml'), '--locked', '--offline']
        if release:
            cmd += ['--release']
        cmd += ['--', '--nocapture']
        run = subprocess.run(cmd, cwd=project, env=env, text=True, stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT)
        (out / f'{mode}.log').write_text(run.stdout)
        if run.returncode or '8 passed; 0 failed' not in run.stdout:
            raise RuntimeError(f'{mode} controls did not pass: inspect {out / (mode + ".log")}')
        results.append({'profile': mode, 'passed': 8, 'log': f'{mode}.log'})
    after = verify(repo)
    if before != after or (repo / EXPECTED['cryptoPath']).read_text() != source:
        raise RuntimeError('Source changed during host replay; result is not qualified')
    report = {'result': 'PASS', 'cryptoSha256': EXPECTED['cryptoSha256'], 'cargo': version,
              'testRuns': results, 'coreDependency': 'Live verified repository crates/pearl-core',
              'instrumentation': 'One observer call after the real PrivateKey Drop wipes scalar and metadata',
              'limits': 'Host mocked syscalls and synthetic keys, not SDK/hardware/physical UI proof'}
    (out / 'summary.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as e:
        print(f'FAIL: {e}', file=sys.stderr)
        sys.exit(1)
