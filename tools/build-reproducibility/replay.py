#!/usr/bin/env python3
"""Fresh, offline canonical-path rebuild using an already-provisioned Linux builder.

Never edits the input checkout or reference artifacts. Creates a NEW private output
folder, independent Git/SDK/cache copies, and uses bubblewrap filesystem isolation.
This does not install tools or provision a standalone container image.
"""
import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

sys.dont_write_bytecode = True

from verify import DEVICES, NETWORKS, compare

HERE = Path(__file__).resolve().parent


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def git(path, *arguments):
    return subprocess.check_output(['git', '-C', str(path), *arguments], text=True).strip()


def ensure_contained_links(root):
    for path in root.rglob('*'):
        if path.is_symlink() and not path.resolve().is_relative_to(root):
            raise ValueError(f'Private copy contains a link outside itself: {path}')


def copy_sdk(source, destination):
    if not (source / '.git').is_dir():
        raise ValueError(f'An existing complete SDK Git checkout is required: {source}')
    if (source / '.git/objects/info/alternates').exists():
        raise ValueError(f'SDK object alternates are not accepted: {source}')
    if any(path.is_symlink() for path in source.rglob('*')):
        raise ValueError(f'SDK source contains an unexpected symlink: {source}')
    shutil.copytree(source, destination, copy_function=shutil.copy2)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True, type=Path, help='Caller-local Git checkout to clone')
    parser.add_argument('--commit', default='HEAD', help='Existing local revision to clone; no fetch')
    parser.add_argument('--sdk-source', type=Path, help='Directory containing both existing pinned SDK checkouts')
    parser.add_argument('--cargo-cache', type=Path, default=Path('/tmp/pearl-cargo'),
                        help='Existing Cargo home; only registry and bin are copied, never credentials')
    parser.add_argument('--output', required=True, type=Path, help='NEW caller-local directory outside the input checkout')
    parser.add_argument('--reference-artifacts', required=True, type=Path)
    parser.add_argument('--reference-packages', required=True, type=Path)
    parser.add_argument('--packaging-python', type=Path,
                        help='Existing Python environment containing ledgerblue 0.1.58 and pyelftools 0.33')
    parser.add_argument('--devices', choices=DEVICES, nargs='+', default=list(DEVICES))
    parser.add_argument('--networks', choices=NETWORKS, nargs='+', default=list(NETWORKS))
    args = parser.parse_args()
    layout = json.loads((HERE / 'builder-layout.json').read_text())
    source, out, cache = args.source.resolve(), args.output.resolve(), args.cargo_cache.resolve()
    sdk_source = (args.sdk_source or source / 'apps/ledger/vendor').resolve()
    reference = args.reference_artifacts.resolve()
    packages = args.reference_packages.resolve()
    packaging_python = args.packaging_python or Path(layout['packagingPythonDefault'])
    canonical = Path(layout['sourceRoot'])
    if out.exists():
        parser.error('--output must not already exist; earlier evidence is never replaced')
    if out.is_relative_to(source) or source.is_relative_to(out):
        parser.error('--output and --source must be disjoint directory trees')
    if len(set(args.devices)) != len(args.devices) or len(set(args.networks)) != len(args.networks):
        parser.error('Device/network selections must not contain duplicates')
    if not (source / '.git').exists() or not reference.is_dir() or not packages.is_dir():
        parser.error('Source must be a local Git checkout; both reference directories must exist')
    if not shutil.which('bwrap') or not shutil.which('git'):
        parser.error('Existing bubblewrap and Git are required')
    # The tested builder layout is intentionally explicit. No setup/download fallback.
    required = [Path(layout['rustupHome']), Path('/tmp/pearl-ledger-tools/arm-none-eabi-gcc'),
                Path('/tmp/pearl-toolchain/root/usr/lib/llvm-19/bin/clang'),
                Path('/tmp/pearl-speculos-venv/bin/python3'), packaging_python,
                canonical, Path(layout['cargoHome']), cache / 'bin/rustup', cache / 'registry']
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        parser.error('Recorded builder layout is not provisioned: ' + ', '.join(missing))
    out.mkdir(parents=True)
    for folder in ('logs', 'tmp', 'home', 'artifacts', 'packages'):
        (out / folder).mkdir()
    private = out / 'source'
    with (out / 'logs/clone.log').open('w') as log:
        subprocess.run(['git', '-c', 'core.hooksPath=/dev/null', 'clone', '--no-hardlinks',
                        str(source), str(private)], stdout=log, stderr=subprocess.STDOUT, check=True)
    revision = git(private, 'rev-parse', '--verify', '--end-of-options', args.commit + '^{commit}')
    if len(revision) != 40 or any(c not in '0123456789abcdef' for c in revision):
        raise ValueError('Expected a local SHA-1 Git commit')
    subprocess.run(['git', '-C', str(private), '-c', 'core.hooksPath=/dev/null',
                    'checkout', '--detach', revision], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['git', '-C', str(private), 'remote', 'remove', 'origin'], check=True)
    if (private / '.git/objects/info/alternates').exists():
        raise ValueError('Fresh clone unexpectedly uses shared Git object alternates')
    vendor = private / 'apps/ledger/vendor'
    vendor.mkdir(parents=True, exist_ok=True)
    for name, pin in [('ledger-device-rust-sdk', layout['rustSdkRevision']),
                      ('ledger-secure-sdk', layout['secureSdkRevision'])]:
        if git(sdk_source / name, 'rev-parse', 'HEAD') != pin:
            raise ValueError(f'Unexpected SDK revision: {name}')
        copy_sdk(sdk_source / name, vendor / name)
    private_cache = out / 'cargo-home'
    private_cache.mkdir()
    for name in ('bin', 'registry'):
        shutil.copytree(cache / name, private_cache / name, symlinks=True, copy_function=shutil.copy2)
    ensure_contained_links(private)
    ensure_contained_links(private_cache)
    if (private / 'apps/ledger/target').exists():
        raise ValueError('Fresh native target directory must be absent')
    # Confirm the copied tracked source and Git object files do not share parent inodes.
    relative = git(source, 'ls-files', '-z').split('\0')
    parent_paths = [source / path for path in relative if path and (source / path).is_file()]
    parent_paths += [path for path in (source / '.git').rglob('*') if path.is_file()]
    parent_inodes = {(path.stat().st_dev, path.stat().st_ino) for path in parent_paths}
    shared = [str(path) for path in private.rglob('*') if path.is_file()
              and (path.stat().st_dev, path.stat().st_ino) in parent_inodes]
    if shared:
        raise ValueError('Private source shares parent inodes: ' + ', '.join(shared[:5]))
    (out / 'preflight.json').write_text(json.dumps({
        'commit': revision, 'inputSource': str(source), 'privateSource': str(private),
        'canonicalLogicalSource': str(canonical), 'nativeTargetsInitiallyAbsent': True,
        'sourceSharedInodes': shared, 'gitAlternates': False, 'offline': True,
        'sdkPins': {'rust': layout['rustSdkRevision'], 'secure': layout['secureSdkRevision']}}, indent=2) + '\n')
    job = {'canonicalRoot': str(canonical), 'output': str(out),
           'referenceArtifacts': str(reference), 'referencePackages': str(packages),
           'packagingPython': str(packaging_python), 'devices': args.devices, 'networks': args.networks}
    job_path = out / 'job.json'
    job_path.write_text(json.dumps(job, indent=2) + '\n')
    env = {'PATH': ':'.join(layout['pathPrefix']) + ':' + layout['systemPath'],
           'HOME': str(out / 'home'), 'TMPDIR': str(out / 'tmp'), 'TZ': 'UTC',
           'CARGO_HOME': layout['cargoHome'], 'RUSTUP_HOME': layout['rustupHome'],
           'LD_LIBRARY_PATH': layout['libraryPath'], 'CARGO_NET_OFFLINE': 'true',
           'RUSTUP_AUTO_INSTALL': '0', 'GIT_CONFIG_COUNT': '1',
           'GIT_CONFIG_KEY_0': 'protocol.allow', 'GIT_CONFIG_VALUE_0': 'never',
           'PYTHONDONTWRITEBYTECODE': '1', 'PRL_REPLAY_SANDBOX': '1'}
    (out / 'build-environment.json').write_text(json.dumps(env, indent=2) + '\n')
    command = [shutil.which('bwrap'), '--ro-bind', '/', '/', '--dev', '/dev',
               '--bind', str(out), str(out), '--bind', str(private_cache), layout['cargoHome'],
               '--bind', str(private), str(canonical), '--', sys.executable,
               str(HERE / 'canonical_build.py'), str(job_path)]
    (out / 'sandbox-command.json').write_text(json.dumps(command, indent=2) + '\n')
    subprocess.run(command, env=env, check=True)
    report = compare(reference, out / 'artifacts', packages, out / 'packages', args.devices, args.networks)
    (out / 'comparison.json').write_text(json.dumps(report, indent=2) + '\n')
    print(f"{'PASS' if report['passed'] else 'FAIL'}: {report['count']} variants, "
          f"ELF/load-image/manifest/package verification. Report: {out / 'comparison.json'}")
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        sys.exit(main())
    except (OSError, ValueError, subprocess.CalledProcessError) as error:
        print(f'Replay failed safely; private outputs retained: {error}', file=sys.stderr)
        sys.exit(1)
