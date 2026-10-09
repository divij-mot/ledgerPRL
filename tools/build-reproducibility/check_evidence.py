#!/usr/bin/env python3
"""Validate this compact folder's file hashes and recorded audit outcomes.

Does not rebuild firmware or validate payloads omitted from this folder.
"""
import argparse
import hashlib
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, default=Path(__file__).resolve().parent)
    root = parser.parse_args().root.resolve()
    lines = (root / 'SHA256SUMS').read_text().splitlines()
    for line in lines:
        expected, name = line.split('  ', 1)
        relative = Path(name)
        path = (root / relative).resolve()
        if relative.is_absolute() or not path.is_relative_to(root):
            raise ValueError(f'Unsafe checksum path: {name}')
        actual = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual != expected:
            raise ValueError(f'Checksum mismatch: {name}')
    canonical = json.loads((root / 'evidence/canonical-all25-comparison.json').read_text())
    if canonical['count'] != 25 or len(canonical['variants']) != 25:
        raise ValueError('Expected the complete 25-variant canonical matrix')
    expected = {(d, n) for d in ('nanosplus', 'nanox', 'stax', 'flex', 'apex_p')
                for n in ('mainnet', 'testnet', 'testnet2', 'regtest', 'simnet')}
    if {(v['device'], v['network']) for v in canonical['variants']} != expected:
        raise ValueError('Device/network matrix is incomplete')
    required = {'elfBytesEqual', 'hexBytesEqual', 'apduBytesEqual', 'sha256BytesEqual',
                'build.jsonBytesEqual', 'packageJsonBytesEqual', 'loadImageBytesEqual', 'applicationHashEqual'}
    if not all(set(v['comparisons']) == required and
               all(value is True for value in v['comparisons'].values()) for v in canonical['variants']):
        raise ValueError('Recorded canonical comparison did not pass every byte/hash check')
    variants = json.loads((root / 'evidence/comparison.json').read_text())['variants']
    if len(variants) != 4 or not all(
        v['comparison']['elfEqual'] is False and v['comparison']['loadImageEqual'] is False
        and v['comparison']['applicationHashEqual'] is False
        and v['controlComparison']['elfEqual'] is True for v in variants):
        raise ValueError('Expected four path-dependent failures with passing canonical controls')
    print(f'PASS: {len(lines)} local file hashes; recorded 25 canonical matches and four changed-path failures.')
    print('This checks retained evidence only; use verify.py/replay.py for external payloads or a fresh build.')


if __name__ == '__main__':
    main()
