#!/usr/bin/env python3
"""Compare native ELF/manifest/package bytes and independently reconstruct load hashes.

Standard library only. Reads supplied artifacts; writes only --output when requested.
Returns nonzero for any mismatch or failed independent validation.
"""
import argparse
import hashlib
import json
import sys
import struct
from pathlib import Path

sys.dont_write_bytecode = True

import independent_elf_apdu as independent

DEVICES = ('nanosplus', 'nanox', 'stax', 'flex', 'apex_p')
NETWORKS = ('mainnet', 'testnet', 'testnet2', 'regtest', 'simnet')


def digest(data):
    return hashlib.sha256(data).hexdigest()


def compare(reference, candidate, reference_packages, candidate_packages, devices, networks):
    rows = []
    for device in devices:
        for network in networks:
            key = f'{device}-{network}'
            base = f'pearl-{key}'
            row = {'device': device, 'network': network}
            try:
                ref = reference / f'{base}.elf'
                new = candidate / f'{base}.elf'
                old_info, new_info = independent.elf_info(ref), independent.elf_info(new)
                checks = {
                    'elfBytesEqual': old_info['raw'] == new_info['raw'],
                    'loadImageBytesEqual': old_info['image'] == new_info['image'],
                    'sparseLoadBytesEqual': old_info['expected'] == new_info['expected'],
                    'applicationHashEqual': old_info['hash'] == new_info['hash'],
                    'buildManifestBytesEqual': ref.with_suffix('.build.json').read_bytes()
                        == new.with_suffix('.build.json').read_bytes(),
                }
                for name, info, file in [('reference', old_info, ref), ('candidate', new_info, new)]:
                    manifest = json.loads(file.with_suffix('.build.json').read_text())
                    if (manifest['device'] != device or manifest['network'] != network
                            or manifest['elfSha256'] != digest(info['raw'])):
                        raise ValueError(f'{name} ELF does not match its build manifest')
                    row[name] = {'elfSha256': digest(info['raw']), 'elfBytes': len(info['raw']),
                                 'loadImageSha256': digest(info['image']),
                                 'loadImageBytes': len(info['image']), 'applicationHash': info['hash']}
                if reference_packages is not None:
                    old_dir, new_dir = reference_packages / key, candidate_packages / key
                    old_apdu = independent.verify(ref, old_dir / f'{base}.apdu')
                    new_apdu = independent.verify(new, new_dir / f'{base}.apdu')
                    official = json.loads((new_dir / 'package.json').read_text())
                    checks['independentApplicationHashEqual'] = (
                        old_apdu['appHash'] == new_apdu['appHash']
                        == official['applicationHash'] == new_info['hash'])
                    for suffix in ('elf', 'hex', 'apdu', 'sha256', 'build.json'):
                        checks[f'package.{suffix}BytesEqual'] = (
                            (old_dir / f'{base}.{suffix}').read_bytes()
                            == (new_dir / f'{base}.{suffix}').read_bytes())
                    checks['package.jsonBytesEqual'] = (
                        (old_dir / 'package.json').read_bytes() == (new_dir / 'package.json').read_bytes())
                    row['independentCandidatePackage'] = new_apdu
                row['checks'] = checks
                row['passed'] = all(checks.values())
            except (OSError, ValueError, KeyError, IndexError, TypeError, struct.error) as error:
                row['passed'] = False
                row['error'] = f'{type(error).__name__}: {error}'
            rows.append(row)
    return {'schema': 1, 'passed': all(row['passed'] for row in rows), 'count': len(rows),
            'packageVerificationRun': reference_packages is not None,
            'referenceArtifacts': str(reference), 'candidateArtifacts': str(candidate), 'variants': rows}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--reference-artifacts', required=True, type=Path)
    parser.add_argument('--candidate-artifacts', required=True, type=Path)
    parser.add_argument('--reference-packages', type=Path)
    parser.add_argument('--candidate-packages', type=Path)
    parser.add_argument('--devices', choices=DEVICES, nargs='+', default=list(DEVICES))
    parser.add_argument('--networks', choices=NETWORKS, nargs='+', default=list(NETWORKS))
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    if (args.reference_packages is None) != (args.candidate_packages is None):
        parser.error('Pass both package directories, or neither for an explicitly ELF-only check')
    if len(set(args.devices)) != len(args.devices) or len(set(args.networks)) != len(args.networks):
        parser.error('Device/network selections must not contain duplicates')
    report = compare(args.reference_artifacts.resolve(), args.candidate_artifacts.resolve(),
                     args.reference_packages.resolve() if args.reference_packages else None,
                     args.candidate_packages.resolve() if args.candidate_packages else None,
                     args.devices, args.networks)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(json.dumps(report, indent=2) + '\n')
    for row in report['variants']:
        print(('PASS' if row['passed'] else 'FAIL'), row['device'], row['network'],
              row.get('error', ''), flush=True)
    print(f"{sum(row['passed'] for row in report['variants'])}/{report['count']} matched; "
          f"package verification {'included' if report['packageVerificationRun'] else 'not run'}")
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
