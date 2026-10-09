#!/usr/bin/env python3
"""Portable bounded mutation audit. Intentional faults run only in a temporary copy."""
from __future__ import annotations
import argparse
from datetime import datetime, timezone
import difflib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
RUSTC_VERSION = 'rustc 1.99.0 (b940084d7 2026-09-28)'
SOURCE_HASHES = {
    'v2': 'c91d2246ce829a32e5507b052273f4465e34cf8ec77dc460d89306697e872e18',
    'original': '528ccb34685a352f7280c3a55ad0577566f9d2022cdeb7da7494b33d5967d84b',
}
CORE_NAMES = ('address', 'amount', 'error', 'lib', 'network', 'session', 'transaction')
CORE_INPUTS = {'Cargo.toml', 'Cargo.lock', 'crates/pearl-core/Cargo.toml',
               *{f'crates/pearl-core/src/{name}.rs' for name in CORE_NAMES}}
SMOKE = ('baseline', 'rejection_status_is_success', 'review_recipient_is_change',
         'review_change_is_recipient')
SEED = '53544154455f5632'
EPISODES = '200'


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def manifest(path: Path) -> dict[str, str]:
    result = {}
    for line in path.read_text(encoding='utf-8').splitlines():
        match = re.fullmatch(r'([0-9a-f]{64})  ([A-Za-z0-9_./-]+)', line)
        if not match:
            raise RuntimeError(f'invalid hash manifest: {path.name}')
        expected, relative = match.groups()
        if Path(relative).is_absolute() or '..' in Path(relative).parts or relative in result:
            raise RuntimeError(f'unsafe/duplicate manifest path: {relative}')
        result[relative] = expected
    return result


def read_checked(base: Path, entries: dict[str, str]) -> dict[str, bytes]:
    captured = {}
    for relative, expected in entries.items():
        path = base / relative
        for component in (path, *path.parents):
            if component.is_symlink():
                raise RuntimeError(f'symlink is not an audited source: {relative}')
            if component == base:
                break
        data = path.read_bytes()
        if sha(data) != expected:
            raise RuntimeError(f'source mismatch: {relative}')
        captured[relative] = data
    return captured


def exact_sources(base: Path, relative: str, names: set[str]) -> None:
    directory = base / relative
    if not directory.is_dir():
        raise RuntimeError(f'missing source directory: {relative}')
    files = {str(p.relative_to(base)).replace(os.sep, '/') for p in directory.rglob('*')
             if not p.is_dir() or p.is_symlink()}
    if files != names:
        raise RuntimeError(f'unreviewed source inventory: {relative}')


def preflight(repo: Path, package: Path, revision: str) -> tuple[dict, dict]:
    core_manifest = manifest(HERE / 'provenance/production-source.sha256')
    if set(core_manifest) != CORE_INPUTS:
        raise RuntimeError('unexpected audited core manifest inventory')
    if manifest(package / 'provenance/production-source.sha256') != core_manifest:
        raise RuntimeError('retained package refers to different production sources')
    exact_sources(repo, 'crates/pearl-core/src',
                  {p for p in CORE_INPUTS if '/src/' in p})
    exact_sources(package, 'src', {'src/main.rs'})
    for path in (repo / 'crates/pearl-core/build.rs', package / 'build.rs'):
        if os.path.lexists(path):
            raise RuntimeError('unexpected build script')
    # No checkout-local config is copied, and refuse it rather than silently
    # claiming the copied build reproduced a locally customized configuration.
    for directory in {repo, repo / 'tools', package.parent, package}:
        for name in ('config', 'config.toml'):
            if os.path.lexists(directory / '.cargo' / name):
                raise RuntimeError('unreviewed checkout-local Cargo configuration')
    core = read_checked(repo, core_manifest)
    builds = manifest(HERE / 'provenance/portable-build.sha256')
    if set(builds) != {'Cargo.toml', 'Cargo.lock'}:
        raise RuntimeError('unexpected audited harness build inventory')
    if manifest(package / 'provenance/portable-build.sha256') != builds:
        raise RuntimeError('retained portable manifest/lock provenance differs')
    harness = read_checked(package, builds)
    # Both revisions are explicit known source controls. Never silently fall
    # back to historical source after the current source changes.
    current = read_checked(package, {'src/main.rs': SOURCE_HASHES['v2']})
    if revision == 'original':
        historical = read_checked(package, {'provenance/original-main.rs': SOURCE_HASHES['original']})
        harness['src/main.rs'] = historical['provenance/original-main.rs']
    else:
        harness.update(current)
    return core, harness


def resolve_tool(value: str) -> str:
    result = shutil.which(os.path.expanduser(value))
    if result is None:
        raise RuntimeError(f'tool not found: {value}')
    return str(Path(result).absolute())


def run(command: list[str], cwd: Path, env: dict, log: Path, timeout: int) -> subprocess.CompletedProcess:
    result = subprocess.run(command, cwd=cwd, env=env, capture_output=True, text=True,
                            encoding='utf-8', errors='replace', timeout=timeout)
    log.write_text(result.stdout + result.stderr, encoding='utf-8')
    return result


def mutate(original: str, spec: dict) -> str:
    if 'drop_containing' in spec:
        needle = spec['drop_containing']
        if needle not in original:
            raise RuntimeError(f'mutation target missing: {spec["name"]}')
        return '\n'.join(line for line in original.split('\n') if needle not in line)
    if original.count(spec['before']) != 1:
        raise RuntimeError(f'mutation must match exactly once: {spec["name"]}')
    return original.replace(spec['before'], spec['after'])


def execute(args: argparse.Namespace, repo: Path, package: Path) -> None:
    core, harness = preflight(repo, package, args.harness)
    print('PASS exact live core and retained harness preflight', flush=True)
    if args.mode == 'preflight':
        return
    specs = json.loads((HERE / 'mutations.json').read_text(encoding='utf-8'))
    by_name = {spec['name']: spec for spec in specs}
    if len(by_name) != len(specs) or any(spec['file'] not in {n+'.rs' for n in CORE_NAMES} for spec in specs):
        raise RuntimeError('invalid mutation specifications')
    names = args.cases.split(',') if args.cases else (list(SMOKE) if args.mode == 'smoke' else ['baseline', *by_name])
    if any(n not in {'baseline', *by_name} for n in names) or len(names) != len(set(names)):
        raise RuntimeError('unknown or duplicate case name')
    if 'baseline' not in names:
        names.insert(0, 'baseline')
    env = os.environ.copy()
    if args.cargo_home:
        env['CARGO_HOME'] = str(Path(args.cargo_home).expanduser().resolve())
    if args.rustup_home:
        env['RUSTUP_HOME'] = str(Path(args.rustup_home).expanduser().resolve())
    cargo, rustc = resolve_tool(args.cargo), resolve_tool(args.rustc)
    env['RUSTC'] = rustc
    if any(env.get(name) for name in ('RUSTC_WRAPPER', 'RUSTC_WORKSPACE_WRAPPER')):
        raise RuntimeError('compiler wrappers are outside this audited runner')
    compiler = subprocess.check_output([rustc, '--version'], env=env, text=True,
                                      timeout=args.timeout_seconds).strip()
    if compiler != RUSTC_VERSION:
        raise RuntimeError(f'toolchain mismatch: need {RUSTC_VERSION}; found {compiler}')
    output = args.output.expanduser().resolve() if args.output else HERE / 'results/replays' / datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    output.mkdir(parents=True, exist_ok=False)
    metadata = {
        'kind': 'portable-isolated-mutation-audit', 'harness_revision': args.harness,
        'harness_sha256': sha(harness['src/main.rs']), 'compiler': compiler,
        'runner_sha256': sha(Path(__file__).read_bytes()),
        'mutation_specs_sha256': sha((HERE / 'mutations.json').read_bytes()),
        'core_manifest_sha256': sha((HERE / 'provenance/production-source.sha256').read_bytes()),
        'seed': SEED, 'episodes_per_network': int(EPISODES), 'suite': 'all',
        'cases': names, 'started_utc': datetime.now(timezone.utc).isoformat(),
        'status': 'RUNNING',
        'limits': 'Selected finite host controls; no independent digest or physical-zeroization proof. Trusted toolchain, global Cargo cache/config and environment are not supply-chain-attested.',
    }
    results = []
    (output / 'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')
    try:
        with tempfile.TemporaryDirectory(prefix='pearl audit ', dir=args.work_parent) as temporary:
            work = Path(temporary)
            copied_repo = work / 'repository'
            copied_package = copied_repo / 'tools/core-state-review'
            env['CARGO_TARGET_DIR'] = str(work / 'target')
            for relative, data in core.items():
                target = copied_repo / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            for relative, data in harness.items():
                target = copied_package / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes(data)
            # Confirm Cargo's actual dependency graph uses this exact isolated
            # copy, not a global path override or the live checkout.
            resolution = run([cargo, 'metadata', '--format-version', '1', '--offline', '--locked'],
                             copied_package, env, output / 'cargo-metadata.log', args.timeout_seconds)
            if resolution.returncode:
                raise RuntimeError('Cargo metadata failed; see cargo-metadata.log')
            packages = json.loads(resolution.stdout)['packages']
            selected = [p for p in packages if p['name'] == 'pearl-core']
            expected = (copied_repo / 'crates/pearl-core/Cargo.toml').resolve()
            if len(selected) != 1 or Path(selected[0]['manifest_path']).resolve() != expected:
                raise RuntimeError('Cargo resolved an unaudited pearl-core dependency')
            for name in names:
                # Restore all seven core files before every independent mutant.
                for relative, data in core.items():
                    (copied_repo / relative).write_bytes(data)
                spec = by_name.get(name)
                patch = ''
                if spec:
                    relative = 'crates/pearl-core/src/' + spec['file']
                    original = core[relative].decode('utf-8')
                    altered = mutate(original, spec)
                    (copied_repo / relative).write_text(altered, encoding='utf-8')
                    patch = ''.join(difflib.unified_diff(original.splitlines(keepends=True), altered.splitlines(keepends=True), fromfile='a/'+spec['file'], tofile='b/'+spec['file']))
                    archived = HERE / 'patches' / (name+'.patch')
                    if patch.encode() != archived.read_bytes():
                        raise RuntimeError(f'mutation differs from retained patch: {name}')
                (output / (name+'.patch')).write_text(patch, encoding='utf-8')
                build = run([cargo, 'build', '--offline', '--locked', '--release'], copied_package,
                            env, output / (name+'.build.log'), args.timeout_seconds)
                row = {'name': name, 'build_exit': build.returncode, 'patch_sha256': sha(patch.encode())}
                if build.returncode:
                    row.update(outcome='BUILD_FAILED', expectation_met=False)
                else:
                    binary = work / 'target/release' / ('prl-core-state-review.exe' if os.name == 'nt' else 'prl-core-state-review')
                    observed = run([str(binary), SEED, EPISODES, 'all'], copied_package, env,
                                   output / (name+'.run.log'), args.timeout_seconds)
                    if name == 'baseline':
                        expected_outcome = 'PASS'
                    else:
                        key = 'original_survives' if args.harness == 'original' else 'hardened_survives'
                        expected_outcome = 'SURVIVED' if spec[key] else 'DETECTED'
                    if observed.returncode == 0 and 'PASS TOTAL Counts { commands: 3256677,' in observed.stdout:
                        outcome = 'PASS' if name == 'baseline' else 'SURVIVED'
                    elif observed.returncode == 101 and 'panicked at' in observed.stderr:
                        outcome = 'DETECTED'
                    else:
                        outcome = 'UNEXPECTED_FAILURE'
                    row.update(exit=observed.returncode, outcome=outcome,
                               expected=expected_outcome, expectation_met=outcome == expected_outcome)
                results.append(row)
                (output / 'mutations-summary.json').write_text(json.dumps(results, indent=2)+'\n')
                print(json.dumps(row), flush=True)
                if not row['expectation_met']:
                    raise RuntimeError(f'unexpected result for {name}; see new evidence at {output}')
        # Verify the live inputs again; intentional mutations never touch them.
        preflight(repo, package, args.harness)
        metadata['status'] = 'PASS'
        print(f'PASS {len(results)} bounded cases; evidence: {output}', flush=True)
    except Exception:
        metadata['status'] = 'FAILED'
        raise
    finally:
        metadata['finished_utc'] = datetime.now(timezone.utc).isoformat()
        (output / 'metadata.json').write_text(json.dumps(metadata, indent=2)+'\n')


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', nargs='?', choices=('preflight', 'smoke', 'all'), default='smoke')
    parser.add_argument('--repository', '--repo', type=Path, default=os.environ.get('PRL_REPOSITORY'))
    parser.add_argument('--package', type=Path, default=os.environ.get('PRL_REVIEW_PACKAGE'))
    parser.add_argument('--harness', choices=('v2', 'original'), default='v2')
    parser.add_argument('--cases', help='comma-separated named cases; baseline is always included')
    parser.add_argument('--cargo', default=os.environ.get('CARGO', 'cargo'))
    parser.add_argument('--rustc', default=os.environ.get('RUSTC', 'rustc'))
    parser.add_argument('--cargo-home', default=os.environ.get('CARGO_HOME'))
    parser.add_argument('--rustup-home', default=os.environ.get('RUSTUP_HOME'))
    parser.add_argument('--output', type=Path, help='new evidence directory; existing directories refused')
    parser.add_argument('--work-parent', type=Path, help='existing directory for temporary isolated workspace')
    parser.add_argument('--timeout-seconds', type=int, default=120)
    args = parser.parse_args()
    try:
        package = (args.package or HERE.parent).expanduser().resolve()
        repo = (args.repository or package.parent.parent).expanduser().resolve()
        if not 1 <= args.timeout_seconds <= 1800:
            raise RuntimeError('timeout must be between 1 and 1800 seconds per subprocess')
        if args.work_parent:
            args.work_parent = args.work_parent.expanduser().resolve()
        if args.mode == 'preflight' and args.cases:
            raise RuntimeError('--cases does not apply to preflight mode')
        execute(args, repo, package)
    except (RuntimeError, OSError, ValueError, subprocess.SubprocessError) as error:
        print(f'REFUSED: {error}', file=sys.stderr)
        return 2
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
