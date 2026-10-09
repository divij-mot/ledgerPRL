#!/usr/bin/env python3
"""Recheck retained instrumented measurements and exact source/artifact bindings."""
import argparse,hashlib,json
from pathlib import Path
if not __debug__:
 raise SystemExit("Verification requires assertions; rerun without -O, -OO, or PYTHONOPTIMIZE")
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source',required=True,type=Path)
p.add_argument('--artifacts',type=Path)
a=p.parse_args();root=a.source.resolve();e=Path(__file__).resolve().parent
read=lambda p:json.loads(p.read_text())
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
report=read(e/'report.json');before=read(e/'parent-native-source-before.json')
assert before==read(e/'parent-native-source-after.json')==read(e/'mirror-native-source-after.json')
assert report['cryptoSha256']==before['apps/ledger/src/crypto.rs']=='50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1'
inputs=read(e/'mirror-input-hashes.json')
# Reconcile complete declared inventories before hashing their current bytes.
native_required=set(('Cargo.toml','apps/ledger/Cargo.toml','apps/ledger/Cargo.lock','apps/ledger/rust-toolchain.toml','crates/pearl-core/Cargo.toml','apps/ledger/patches/strict-transport.patch','scripts/ledger-build.sh','scripts/ledger-prepare-sdk.sh','scripts/ledger-build-manifest.py'))
for folder in ('apps/ledger/src','apps/ledger/icons','apps/ledger/.cargo','crates/pearl-core/src'):
 native_required.update(str(p.relative_to(root)) for p in (root/folder).rglob('*') if p.is_file())
assert set(before)==native_required, 'Incomplete native source inventory'
required_inputs=native_required|{'package.json','package-lock.json','apps/ledger/patches/memory-instrumentation.patch','scripts/ledger-build-instrumented.sh'}
for folder in ('apps/ledger/tests','packages/sdk/src','crates/pearl-core','fixtures'):
 required_inputs.update(str(p.relative_to(root)) for p in (root/folder).rglob('*') if p.is_file() and 'target' not in p.parts and 'evidence' not in p.parts and '__pycache__' not in p.parts)
assert set(inputs)==required_inputs, 'Incomplete or unexpected copied input inventory'
assert before.items()<=inputs.items(), 'Native and copied source hashes disagree'
for rel,h in inputs.items():
 target=(root/rel).resolve();assert target.is_relative_to(root);assert sha(target)==h,rel
assert report['status']=='passed-instrumented-software-only'
assert report['rustSdk']=='4123d2dc85a2085115e6a36826460a9fe742cfb1'
assert report['secureSdk']=='6709cd2bdfebb224ee070f7c1211b54254262579'
assert report['features']==['simnet','ledger_device_sdk/stack_usage']
assert report['nativeSourcesUnchanged'] and report['parentVendorsUnchanged'] and report['isolatedVendorCopies']
assert sha(e/'sources/memory-instrumentation.patch')==report['memoryPatchSha256']
assert sha(e/'sources/strict-transport.patch')==report['releasePatchSha256']
assert report['memoryPatchSha256']==inputs['apps/ledger/patches/memory-instrumentation.patch']
assert report['releasePatchSha256']==inputs['apps/ledger/patches/strict-transport.patch']
assert sha(e/'sources/ledger-build-instrumented.sh')==inputs['scripts/ledger-build-instrumented.sh']
delta=read(e/'instrumented-sdk-delta.json')
assert delta['status']=='passed' and delta['exactReviewedPatchApplied']
assert delta['patchSha256']==report['memoryPatchSha256']
assert set(delta['onlyChangedTrackedFiles'])=={'ledger_secure_sdk_sys/src/lib.rs','ledger_device_sdk/src/testing.rs'}
expected={'nanosp':'nanosplus','nanox':'nanox','stax':'stax','flex':'flex','apex_p':'apex_p'}
seen=set();flows=sessions=0
for row in report['models']:
 model=row['model'];assert model in expected and model not in seen;seen.add(model)
 assert row['device']==expected[model]
 mp=e/'memory'/(model+'.json');sp=e/'stability'/(model+'.json')
 assert sha(mp)==row['memoryEvidenceSha256'] and sha(sp)==row['stabilityEvidenceSha256']
 assert sha(e/'builds'/(expected[model]+'.log'))==row['buildLogSha256']
 m=read(mp);s=read(sp)
 assert m['status']==s['status']=='passed'
 assert m['firmware']['model']==s['firmware']['model']==s['model']==model
 assert m['firmware']['speculos']==s['firmware']['speculos']=='0.27.1'
 assert m['firmware']['publicTestSeed']==s['firmware']['publicTestSeed']=='000102030405060708090a0b0c0d0e0f'
 assert s['buildKind']=='instrumented-resource-replay'
 assert m['compiler']=='nightly-2025-12-05' and m['features']==report['features']
 assert m['instrumentationPatchSha256']==report['memoryPatchSha256']
 assert m['releasePatchSha256']==report['releasePatchSha256']
 assert s['sourceSha256']=={key:inputs[rel] for key,rel in {'harness':'apps/ledger/tests/native-stability.ts','driver':'apps/ledger/tests/speculos-driver.ts','fixture':'fixtures/protocol-v1.json','dependencyLock':'package-lock.json'}.items()}
 assert m['firmware']['sha256']==s['firmware']['sha256']==row['instrumentedElfSha256']
 assert m['firmware']['injector'] is None and s['firmware']['injector'] is None
 assert m['measurements']==row['measurements'] and s['resources']==row['resources']
 assert [x['flow'] for x in m['measurements']]==['max16-ordinary','max16-all-warnings','max16-absolute-bounds']
 for value in m['measurements']:
  assert 0<value['stackUsed']<value['stackSpan']
  assert value['stackRemaining']==value['stackSpan']-value['stackUsed']
  assert 0<=value['heapCurrent']<=value['heapPeak']<=value['heapCapacity'] and value['heapPeak']>0
  assert value['heapRemaining']==value['heapCapacity']-value['heapPeak']
 assert s['requestedSessions']==s['completedSessions']==row['completedMixedSessions']==20
 assert len(s['records'])==20 and all(x['status']=='passed' for x in s['records'])
 assert [x['round'] for x in s['records']]==list(range(1,21))
 expected_kinds=['sign','address','abort-upload','reject-review','invalid-ownership-or-point','partial-signature-abort','invalid-upload','export','sign','max16']*2
 assert [x['kind'] for x in s['records']]==expected_kinds
 assert all(x['verifiedSignatures']==(x['inputs'] if x['kind'] in ('sign','max16') else 1 if x['kind']=='partial-signature-abort' else 0) for x in s['records'])
 counts={'complete':sum(x['verifiedSignatures'] for x in s['records'] if x['kind'] in ('sign','max16')),'partial':sum(x['verifiedSignatures'] for x in s['records'] if x['kind']=='partial-signature-abort')}
 assert row['checkedSignatures']==s['checkedSignatures']==counts=={'complete':44,'partial':2}
 assert s['sessionKinds']=={kind:expected_kinds.count(kind) for kind in set(expected_kinds)}
 assert s['sourceUnchanged']
 assert [x['completed'] for x in s['resources']]==[0,10,20]
 assert all(x['heapCurrent']==s['resources'][0]['heapCurrent'] for x in s['resources'])
 assert all(0<x['stackHighWater']<m['measurements'][0]['stackSpan'] and 0<=x['heapCurrent']<=x['heapPeak']<=x['heapCapacity'] and x['heapCapacity']==m['measurements'][0]['heapCapacity'] for x in s['resources'])
 assert all(a['heapPeak']<=b['heapPeak'] and a['stackHighWater']<=b['stackHighWater'] for a,b in zip(s['resources'],s['resources'][1:]))
 if a.artifacts:assert sha(a.artifacts/f'pearl-{expected[model]}-simnet-INSTRUMENTED.elf')==row['instrumentedElfSha256']
 flows+=3;sessions+=20
assert seen==set(expected) and flows==report['measurementFlows']==15 and sessions==report['mixedSessions']==100
print(json.dumps({'status':'passed','scope':'Retained instrumented software measurements; no hardware or OS-stack guarantee','models':5,'memoryFlows':15,'mixedSessions':100,'actualInstrumentedElfsChecked':5 if a.artifacts else 0},indent=2))
