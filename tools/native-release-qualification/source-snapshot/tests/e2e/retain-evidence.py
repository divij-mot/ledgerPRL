#!/usr/bin/env python3
"""Retain compact, public-only evidence from a successful immutable native run.

Usage: python3 tests/e2e/retain-evidence.py RUN_DIRECTORY LABEL
Never retains an ELF, node data directory, credentials, or machine-specific path.
"""
import hashlib
import json
from pathlib import Path
import shutil
import sys

if len(sys.argv) != 3 or not sys.argv[2].replace('-', '').replace('_', '').isalnum():
    raise SystemExit(__doc__)
source = Path(sys.argv[1])
raw = (source / 'evidence.json').read_bytes()
record = json.loads(raw)
assert record['status'] == 'passed'
assert record['network'] == 'simnet'
assert record['publicTestSeed'] == '000102030405060708090a0b0c0d0e0f'
assert record['firmware']['snapshot'] == 'native-snapshot.elf'
assert hashlib.sha256((source / 'native-snapshot.elf').read_bytes()).hexdigest() == record['firmware']['sha256']
assert all(case['status'] == 'passed' for case in record['cases'])
record.pop('output', None)
model = record['firmware']['model']
device = 'nanosplus' if model == 'nanosp' else model
record['firmware']['path'] = f'apps/ledger/target/artifacts/pearl-{device}-simnet.elf'
record['firmware']['snapshotRetainedInRepository'] = False
record['pearlNode'].pop('path', None)
record['provenance'] = {
    'pearlCommit': '2f8b770cac8f8b74be05c1fc51c2baeb76ce0701',
    'ledgerRustSdkCommit': '4123d2dc85a2085115e6a36826460a9fe742cfb1',
    'ledgerSecureSdkCommit': '6709cd2bdfebb224ee070f7c1211b54254262579',
    'ledgerApiLevel': 27,
    'speculosVersion': '0.27.1',
    'pearlNodeHarnessOnlyChange': 'defaultHomeDir is redirected by PEARL_TEST_HOME; no consensus changes',
    'originalRunRecordSha256': hashlib.sha256(raw).hexdigest(),
}
destination = Path(__file__).parent / 'evidence' / sys.argv[2]
destination.mkdir(parents=True, exist_ok=True)
(destination / 'result.json').write_text(json.dumps(record, indent=2) + '\n')
for filename in ['apdu-transcript.json', 'ui-events.json', 'bundle.hex', 'signed-transaction.hex']:
    shutil.copyfile(source / filename, destination / filename)
screens = json.loads((source / 'ui-events.json').read_text())
signing_screens = [event for event in screens if event['label'] == 'sign']
for name, event in [
    ('review-amount', next(event for event in signing_screens if 'Amount' in event['screen'])),
    ('approval-gesture', next(event for event in signing_screens if 'Sign Pearl transfer' in event['screen'])),
]:
    shutil.copyfile(source / f"sign-{event['step']:03}.png", destination / (name + '.png'))
print(json.dumps({
    'retained': str(destination), 'model': model, 'casesPassed': len(record['cases']),
    'inputs': record['transaction']['inputs'], 'bundleBytes': record['transaction']['bundleBytes'],
    'elfSha256': record['firmware']['sha256'], 'signTiming': record['signTiming'],
}, indent=2))
