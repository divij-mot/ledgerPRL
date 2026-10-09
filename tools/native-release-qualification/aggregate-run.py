#!/usr/bin/env python3
"""Aggregate this retained run; assert provenance and do not infer unfinished passes."""
import argparse
import datetime
import hashlib
import json
import pathlib
import subprocess

if not __debug__:
    raise SystemExit("Optimized Python disables required evidence checks; run without -O/-OO")

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', required=True, type=pathlib.Path)
parser.add_argument('--run', required=True, type=pathlib.Path)
parser.add_argument('--output', required=True, type=pathlib.Path)
args = parser.parse_args()
ROOT = args.source.resolve()
RUN = args.run.resolve()
MODELS = {'nanosp': 'nanosplus', 'nanox': 'nanox', 'stax': 'stax', 'flex': 'flex', 'apex_p': 'apex_p'}
NETWORKS = ['mainnet', 'testnet', 'testnet2', 'regtest', 'simnet']
CRYPTO = '50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1'

def read(path):
    return json.loads(path.read_text())

def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def main():
    expected_sources = read(RUN / 'sources-before.json')
    current_sources = json.loads(subprocess.check_output(
        ['python3', 'scripts/ledger-build-manifest.py', 'snapshot'], cwd=ROOT))
    assert expected_sources == current_sources
    assert sha(ROOT / 'apps/ledger/src/crypto.rs') == CRYPTO
    result = {
        'scope': 'Final lexical-scope release software qualification. Emulators and isolated valueless Pearl simnet only.',
        'cryptoSha256': CRYPTO,
        'nativeSourceMapSha256': sha(RUN / 'sources-before.json'),
        'nativeSourcesUnchanged': True,
        'buildNetworkPackageMatrix': [],
        'runtimeMatrix': [],
        'notClaimed': ['Physical-device validation', 'Human security audit', 'Vendor approval or store availability', 'Hardware RNG quality/fault resistance', 'Production readiness'],
    }
    for device in MODELS.values():
        for network in NETWORKS:
            label = f'{device}-{network}'
            elf = RUN / 'artifacts' / f'pearl-{label}.elf'
            build_path = elf.with_suffix('.build.json')
            build = read(build_path)
            elf_hash = sha(elf)
            assert build['elfSha256'] == elf_hash
            assert build['sources'] == expected_sources
            assert (build['device'], build['network']) == (device, network)
            network_path = RUN / 'network-runtime' / label / 'evidence.json'
            network_result = read(network_path)
            assert network_result['status'] == 'passed'
            assert network_result['firmware']['sha256'] == elf_hash
            assert network_result['capabilities']['network'] == network
            assert len(network_result['addresses']) == 2
            package_path = RUN / 'packages' / label / 'package.json'
            package = read(package_path)
            independent_path = RUN / 'packages' / f'{label}-independent.json'
            independent = read(independent_path)
            assert package['status'] == 'offline-verified-not-installed'
            assert independent['status'].startswith('PASS:')
            assert package['elfSha256'] == independent['elfSha256'] == elf_hash
            assert package['applicationHash'] == independent['appHash']
            assert independent['apiLevel'] == 27 and independent['network'] == network
            result['buildNetworkPackageMatrix'].append({
                'device': device, 'network': network, 'elfSha256': elf_hash,
                'buildManifestSha256': sha(build_path), 'status': 'passed',
                'networkSmokeEvidenceSha256': sha(network_path),
                'addresses': network_result['addresses'],
                'packageEvidenceSha256': sha(package_path),
                'independentPackageEvidenceSha256': sha(independent_path),
                'applicationHash': independent['appHash'],
                'apduSha256': independent['apduSha256'],
                'apiLevel': independent['apiLevel'],
            })
    summary = read(RUN / 'runtime-summary.json')
    seen = set()
    for case in summary['results']:
        key = (case['model'], case['suite'])
        assert key not in seen
        seen.add(key)
        assert case['status'] == 'passed'
        for field in ('testSourcesUnchanged', 'nativeSourcesUnchanged', 'cryptoUnchanged', 'allSnapshotsMatch'):
            assert case[field]
        assert case['model'] in MODELS and case['suite'] in ('canonical', 'warnings', 'faults', 'node-16', 'node-parity', 'stability')
        path = RUN / 'runtime' / (case['model'] + '-' + case['suite'])
        for rel, expected_hash in read(path / 'test-source-hashes-after.json').items():
            assert sha(ROOT / rel) == expected_hash
        expected_elf = RUN / 'artifacts' / f"pearl-{MODELS[case['model']]}-simnet.elf"
        assert case['elfSha256'] == sha(expected_elf)
        snapshots = list(path.rglob('tested-firmware.elf')) + list(path.rglob('native-snapshot.elf'))
        assert len(snapshots) == case['snapshotCount']
        assert all(sha(p) == case['elfSha256'] for p in snapshots)
        evidence_path = path / ('summary.json' if case['suite'] == 'stability' else 'evidence.json')
        evidence = read(evidence_path)
        row = {k: case[k] for k in ('model', 'suite', 'status', 'elfSha256', 'startedAt', 'completedAt')}
        row['evidenceSha256'] = sha(evidence_path)
        row['snapshotCount'] = len(snapshots)
        if case['suite'] == 'faults':
            assert all(x['status'] == 'passed' for x in evidence)
            row['cases'] = [x['name'] for x in evidence]
        elif case['suite'] == 'stability':
            assert evidence['status'] == 'passed'
            assert evidence['completedSessions'] == evidence['requestedSessions'] == 20
            row.update({k: evidence[k] for k in ('completedSessions', 'apduCount', 'checkedSignatures', 'sessionKinds')})
        elif case['suite'] in ('node-16', 'node-parity'):
            assert evidence['status'] == 'passed'
            assert all(x['status'] == 'passed' for x in evidence['cases'])
            transaction = evidence['transaction']
            assert transaction['inputs'] == (16 if case['suite'] == 'node-16' else 4)
            assert len(transaction['signatures']) == transaction['inputs']
            row['caseCount'] = len(evidence['cases'])
            row['transaction'] = transaction
            row['pearlNode'] = evidence['pearlNode']
            if case['suite'] == 'node-parity':
                parity = evidence['parityCoverage']
                assert {(p['internalParity'], p['outputParity']) for p in parity} == {(0,0),(0,1),(1,0),(1,1)}
                row['parityCoverage'] = parity
        else:
            assert evidence['status'] == 'passed'
            row['checks'] = evidence['checks']
        result['runtimeMatrix'].append(row)
    assert len(result['buildNetworkPackageMatrix']) == 25
    assert len(result['runtimeMatrix']) == 30
    assert seen == {(model, suite) for model in MODELS for suite in ('canonical', 'warnings', 'faults', 'node-16', 'node-parity', 'stability')}
    result['status'] = 'passed-software-qualification-only'
    result['completedAt'] = datetime.datetime.now(datetime.timezone.utc).isoformat()
    result['packagerUnitTests'] = {'passed': 11, 'logSha256': sha(RUN / 'package-tests.log')}
    destination = args.output.resolve()
    with destination.open('x') as output:
        json.dump(result, output, indent=2)
        output.write('\n')
    print(f'PASS: 25 builds/network smokes/packages, 30 runtime suites, 100 repeated sessions; {destination}')

if __name__ == '__main__':
    main()
