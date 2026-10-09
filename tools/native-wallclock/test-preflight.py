#!/usr/bin/env python3
"""Preflight controls only: no emulators and no mutation of production inputs."""
import ast,fcntl,hashlib,json,shutil,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch
import argparse
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--harness',type=Path,default=Path(__file__).with_name('native-wallclock.py'))
args=parser.parse_args()
ROOT=args.output.resolve();ROOT.mkdir()
REPO=args.repo.resolve()
HARNESS=args.harness.resolve()
CONTROL=ROOT/'preflight-controls';CONTROL.mkdir()
source=ast.parse(HARNESS.read_text())
functions=[n for n in source.body if isinstance(n,ast.FunctionDef) and n.name in ['source_snapshot','validate_manifest','validate_copied_artifacts','stage_model']]
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
ns={'Path':Path,'subprocess':subprocess,'sys':sys,'json':json,'fcntl':fcntl,'sha':sha}
exec(compile(ast.Module(body=functions,type_ignores=[]),'exact-tested-preflight-functions','exec'),ns)
actual=ns['source_snapshot'](REPO)
fixture=CONTROL/'fixture';fixture.mkdir()
for rel in actual:
    dest=fixture/rel;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(REPO/rel,dest)
artifacts=fixture/'apps/ledger/target/artifacts';artifacts.mkdir(parents=True)
(fixture/'apps/ledger/target/.build-nanosplus.lock').touch()
elf=artifacts/'pearl-nanosplus-simnet.elf';elf.write_bytes(b'PUBLIC TEST PREFLIGHT ONLY. NOT AN EXECUTABLE.\n')
manifest=elf.with_suffix('.build.json')
valid={'network':'simnet','device':'nanosplus','elfSha256':sha(elf),'sources':actual}
manifest.write_text(json.dumps(valid))
records=[]
def record(name,status,**fields):records.append({'name':name,'status':status,**fields})
def output(name):
    out=CONTROL/name;out.mkdir();(out/'frozen').mkdir();return out
class Checks(unittest.TestCase):
    def rejects_map(self,label,sources):
        m=dict(valid,sources=sources)
        with self.assertRaisesRegex(ValueError,'exactly match'):ns['validate_manifest'](m,actual,'nanosplus',sha(elf))
        record(label,'passed',rejection='exact source-map mismatch')
    def test_01_valid_complete_snapshot(self):
        self.assertTrue(actual);self.assertEqual(actual,ns['source_snapshot'](fixture));ns['validate_manifest'](valid,actual,'nanosplus',sha(elf));record('valid exact source map','passed',sourceCount=len(actual))
    def test_02_empty_manifest_source_map(self):self.rejects_map('empty manifest sources',{})
    def test_03_missing_source(self):
        m=dict(actual);m.pop(next(iter(m)));self.rejects_map('missing manifest source',m)
    def test_04_extra_source(self):self.rejects_map('extra manifest source',dict(actual,unexpected='0'*64))
    def test_05_changed_source_hash(self):
        m=dict(actual);m[next(iter(m))]='0'*64;self.rejects_map('changed manifest source hash',m)
    def test_06_empty_snapshot(self):
        with patch.object(subprocess,'check_output',return_value='{}'):
            with self.assertRaisesRegex(ValueError,'nonempty map'):ns['source_snapshot'](fixture)
        record('empty native snapshot','passed',rejection='nonempty source snapshot required')
    def test_07_stage_empty_sources_before_copy(self):
        out=output('empty-source-stage');manifest.write_text(json.dumps(dict(valid,sources={})))
        try:
            with self.assertRaisesRegex(ValueError,'exactly match'):ns['stage_model'](fixture,out,'nanosplus')
            self.assertEqual(list((out/'frozen').iterdir()),[])
            record('stage rejects empty sources before copy','passed',emulatorStarted=False,copiesCreated=0)
        finally:manifest.write_text(json.dumps(valid))
    def test_08_valid_stage_copy_verified(self):
        out=output('valid-stage');data,snapshot=ns['stage_model'](fixture,out,'nanosplus')
        self.assertEqual(snapshot,actual);self.assertTrue(data['exactSourceMapVerified'] and data['copiedElfVerified'] and data['copiedManifestBytesVerified'])
        record('valid stage verifies exact copied ELF and manifest','passed',elfSha256=data['sha256'])
    def test_09_copy_elf_mismatch(self):
        out=output('elf-copy-mismatch');original=Path.read_bytes;calls=0
        def corrupt(path):
            nonlocal calls
            data=original(path)
            if path==elf:
                calls+=1
                if calls==2:return data+b'CORRUPTION DURING COPY'
            return data
        with patch.object(Path,'read_bytes',corrupt):
            with self.assertRaisesRegex(ValueError,'Copied ELF hash'):ns['stage_model'](fixture,out,'nanosplus')
        record('copied ELF mismatch fails closed','passed',emulatorStarted=False,simulatedMutation='test-fixture copy read only')
    def test_10_copy_manifest_mismatch(self):
        out=output('manifest-copy-mismatch');original=Path.read_bytes;calls=0
        def corrupt(path):
            nonlocal calls
            data=original(path)
            if path==manifest:
                calls+=1
                if calls==2:return data+b'\n'
            return data
        with patch.object(Path,'read_bytes',corrupt):
            with self.assertRaisesRegex(ValueError,'Copied manifest bytes'):ns['stage_model'](fixture,out,'nanosplus')
        record('copied manifest byte mismatch fails closed','passed',emulatorStarted=False,simulatedMutation='test-fixture copy read only')
    def test_11_source_elf_mismatch(self):
        with self.assertRaisesRegex(ValueError,'Source ELF hash'):ns['validate_manifest'](valid,actual,'nanosplus','0'*64)
        record('source ELF mismatch','passed')
    def test_12_target_network_mismatch(self):
        for field,value in [('network','mainnet'),('device','nanox')]:
            with self.assertRaisesRegex(ValueError,'target/network'):ns['validate_manifest'](dict(valid,**{field:value}),actual,'nanosplus',sha(elf))
        record('target/network mismatch','passed')
if __name__=='__main__':
    suite=unittest.defaultTestLoader.loadTestsFromTestCase(Checks)
    result=unittest.TextTestRunner(verbosity=2).run(suite)
    report={'status':'passed' if result.wasSuccessful() else 'failed','harnessSha256':sha(HARNESS),'sourceSnapshotScriptSha256':sha(REPO/'scripts/ledger-build-manifest.py'),'testsRun':result.testsRun,'controls':records,'scope':'Only independent test fixtures and mocked copy reads; no emulator launch or production source/artifact changes.'}
    (ROOT/'preflight-controls.json').write_text(json.dumps(report,indent=2)+'\n')
    raise SystemExit(0 if result.wasSuccessful() else 1)
