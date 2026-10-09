#!/usr/bin/env python3
"""Internal sandbox entry point for replay.py. Do not invoke on a host checkout."""
import hashlib
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


def run(command, log, cwd):
    with log.open('w') as output:
        subprocess.run(command, cwd=cwd, stdout=output, stderr=subprocess.STDOUT, check=True)


def main():
    job = json.loads(Path(sys.argv[1]).read_text())
    root, out = Path(job['canonicalRoot']), Path(job['output'])
    private = out / 'source'
    # Abort outside the private mount namespace, even if invoked manually.
    if root.samefile(private) is False or not os.environ.get('PRL_REPLAY_SANDBOX'):
        raise SystemExit('Refusing build: the canonical root is not the private checkout mount')
    (out / 'mountinfo.txt').write_text(Path('/proc/self/mountinfo').read_text())
    (out / 'mount-proof.json').write_text(json.dumps({
        'canonicalRoot': str(root), 'physicalPrivateRoot': str(private),
        'samePrivateInode': root.samefile(private), 'device': root.stat().st_dev,
        'inode': root.stat().st_ino}, indent=2) + '\n')
    before = subprocess.check_output(['python3', str(root / 'scripts/ledger-build-manifest.py'), 'snapshot'], cwd=root)
    snapshot = json.loads(before)
    (out / 'sources-before.json').write_bytes(before)
    reference = Path(job['referenceArtifacts'])
    for device in job['devices']:
        for network in job['networks']:
            base = f'pearl-{device}-{network}'
            manifest = json.loads((reference / f'{base}.build.json').read_text())
            if manifest['sources'] != snapshot:
                raise SystemExit(f'Source inputs differ from reference: {base}')
            if manifest['elfSha256'] != hashlib.sha256((reference / f'{base}.elf').read_bytes()).hexdigest():
                raise SystemExit(f'Reference ELF/provenance mismatch: {base}')
    for device in job['devices']:
        for network in job['networks']:
            key = f'{device}-{network}'
            base = f'pearl-{key}'
            print(f'BUILD {key}', flush=True)
            run(['bash', str(root / 'scripts/ledger-build.sh'), device, network], out / 'logs' / f'{key}-build.log', root)
            run(['bash', str(root / 'scripts/ledger-stage-artifact.sh'), device, network], out / 'logs' / f'{key}-stage.log', root)
            for suffix in ('elf', 'build.json'):
                source = root / 'apps/ledger/target/artifacts' / f'{base}.{suffix}'
                dest = out / 'artifacts' / source.name
                with source.open('rb') as src, dest.open('xb') as dst:
                    shutil.copyfileobj(src, dst)
            fresh = out / 'artifacts' / f'{base}.elf'
            if fresh.read_bytes() != (reference / fresh.name).read_bytes():
                raise SystemExit(f'Canonical-path ELF mismatch: {key}; outputs retained for diagnosis')
            run([job['packagingPython'], str(root / 'scripts/ledger-package.py'),
                 '--device', device, '--network', network, '--elf', str(fresh),
                 '--output', str(out / 'packages' / key)], out / 'logs' / f'{key}-package.log', root)
            print(f'BUILT_PACKAGED {key}', flush=True)
    after = subprocess.check_output(['python3', str(root / 'scripts/ledger-build-manifest.py'), 'snapshot'], cwd=root)
    (out / 'sources-after.json').write_bytes(after)
    if json.loads(after) != snapshot:
        raise SystemExit('Native source inputs changed during the replay')


if __name__ == '__main__':
    main()
