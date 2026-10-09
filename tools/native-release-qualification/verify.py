#!/usr/bin/env python3
"""Verify portable evidence consistency/source binding; optionally check retained ELF bytes."""
import argparse
import hashlib
import json
from pathlib import Path

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', required=True, type=Path)
p.add_argument('--artifacts', type=Path)
p.add_argument('--evidence', type=Path, default=Path(__file__).resolve().parent)
a = p.parse_args()
root, evidence = a.source.resolve(), a.evidence.resolve()
models = {'nanosp':'nanosplus','nanox':'nanox','stax':'stax','flex':'flex','apex_p':'apex_p'}
networks = ['mainnet','testnet','testnet2','regtest','simnet']
suites = ['canonical','warnings','faults','node-16','node-parity','stability']
def sha(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text())
def check(ok, message):
    if not ok: raise ValueError(message)
def verify_source_map(path):
    content = read(path)
    for rel, digest in content.items():
        target = (root / rel).resolve()
        check(target.is_relative_to(root), 'Source escaped chosen repository')
        check(sha(target) == digest, 'Source mismatch: ' + rel)
    return content
native = verify_source_map(evidence/'native-source-map.json')
tests = verify_source_map(evidence/'test-source-map.json')
report = read(evidence/'qualification-report.json')
check(report['status']=='passed-software-qualification-only', 'Report not passed')
check(report['cryptoSha256']==native['apps/ledger/src/crypto.rs']=='50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1','Wrong source epoch')
check(report['nativeSourceMapSha256']==sha(evidence/'native-source-map.json'),'Source-map digest mismatch')
seen = set()
for row in report['buildNetworkPackageMatrix']:
    check(row['device'] in models.values() and row['network'] in networks, 'Unknown target/network')
    label = row['device']+'-'+row['network']
    check((row['device'],row['network']) not in seen,'Duplicate target/network')
    seen.add((row['device'],row['network']))
    bp=evidence/'build-manifests'/('pearl-'+label+'.build.json')
    np=evidence/'network'/(label+'.json')
    pp=evidence/'packages'/(label+'.json')
    ip=evidence/'packages'/(label+'-independent.json')
    for path,field in [(bp,'buildManifestSha256'),(np,'networkSmokeEvidenceSha256'),(pp,'packageEvidenceSha256'),(ip,'independentPackageEvidenceSha256')]:
        check(sha(path)==row[field], 'Evidence changed: '+label+' '+field)
    build, network, package, independent = map(read,[bp,np,pp,ip])
    check(build['sources']==native, 'Build bound to wrong source')
    check(build['rustSdk']=='4123d2dc85a2085115e6a36826460a9fe742cfb1' and build['secureSdk']=='6709cd2bdfebb224ee070f7c1211b54254262579', 'Wrong SDK pins')
    check(package['sourceBuildManifestSha256']==sha(bp), 'Package provenance mismatch')
    check(build['device']==row['device'] and build['network']==row['network'],'Build label mismatch')
    check(build['elfSha256']==network['firmware']['sha256']==package['elfSha256']==independent['elfSha256']==row['elfSha256'],'ELF binding mismatch')
    check(network['status']=='passed' and network['capabilities']['network']==row['network'],'Network result mismatch')
    check(network['sourceSha256']['harness']==sha(evidence/'harnesses/network-smoke.original.mts'),'Original network harness changed')
    check(network['sourceSha256']['driver']==tests['apps/ledger/tests/speculos-driver.ts'],'Driver mismatch')
    check(network['sourceSha256']['lockfile']==tests['package-lock.json'],'Lock mismatch')
    for name,h in network['sdkSourceHashes'].items():check(tests['packages/sdk/src/'+name]==h,'SDK source mismatch')
    check(package['status']=='offline-verified-not-installed' and independent['status'].startswith('PASS:'),'Package not passed')
    check(package['applicationHash']==independent['appHash']==row['applicationHash'],'Load-image hash mismatch')
    check(package['curve']=='secp256k1' and package['derivationPrefix']=="86'/"+('808276' if row['network']=='mainnet' else '1')+"'", 'Permission prefix mismatch')
    check(package['deleteExistingApp'] is False and independent['apiLevel']==27,'Unexpected destructive operation/API level')
    if a.artifacts:check(sha(a.artifacts/('pearl-'+label+'.elf'))==row['elfSha256'],'Actual ELF changed')
check(seen=={(d,n) for d in models.values() for n in networks},'Incomplete build/network/package matrix')
bindings=read(evidence/'runtime-bindings.json')['results']
lookup={(b['model'],b['suite']):b for b in bindings}
check(len(lookup)==len(bindings)==30,'Runtime binding duplicate/missing')
seen=set(); repeated=0; native_signatures=0
for row in report['runtimeMatrix']:
    key=(row['model'],row['suite']);check(key[0] in models and key[1] in suites, 'Unknown runtime label');check(key not in seen,'Duplicate runtime result');seen.add(key)
    binding=lookup[key]
    check(binding['status']==row['status']=='passed','Runtime result not passed')
    for field in ('testSourcesUnchanged','nativeSourcesUnchanged','cryptoUnchanged','allSnapshotsMatch'):check(binding[field], 'Runtime binding failed')
    path=evidence/'runtime'/('-'.join(key)+'.json')
    check(sha(path)==row['evidenceSha256'],'Runtime raw evidence changed')
    raw=read(path)
    expected_elf=next(x['elfSha256'] for x in report['buildNetworkPackageMatrix'] if x['device']==models[key[0]] and x['network']=='simnet')
    check(binding['elfSha256']==row['elfSha256']==expected_elf,'Runtime ELF binding mismatch')
    if isinstance(raw,list):check(all(x['firmware']['sha256']==expected_elf for x in raw),'Fault ELF mismatch')
    else:check(raw['firmware']['sha256']==expected_elf,'Runtime raw ELF mismatch')
    if row['suite']=='faults':check(all(x['status']=='passed' for x in raw),'Fault case failed')
    else:check(raw['status']=='passed','Runtime raw result failed')
    if row['suite']=='stability':
        check(raw['requestedSessions']==raw['completedSessions']==20,'Wrong repeat count');repeated+=20
    if row['suite'] in ('node-16','node-parity'):
        check(all(x['status']=='passed' for x in raw['cases']),'Node case failed')
        count=16 if row['suite']=='node-16' else 4
        check(raw['transaction']['inputs']==len(raw['transaction']['signatures'])==count,'Wrong signature count');native_signatures+=count
        if count==4:check({(v['internalParity'],v['outputParity']) for v in raw['parityCoverage']}=={(0,0),(0,1),(1,0),(1,1)},'Missing parity class')
check(seen=={(m,s) for m in models for s in suites},'Incomplete runtime matrix')
check(repeated==100 and native_signatures==100,'Wrong session/signature totals')
log=evidence/'packages/unit-tests.log'
check(sha(log)==report['packagerUnitTests']['logSha256'] and 'Ran 11 tests' in log.read_text() and '\nOK\n' in log.read_text(),'Unit-test log mismatch')
print(json.dumps({'status':'passed','scope':'Source-bound consistency check of retained software evidence; not hardware attestation or a repeat of emulator UI/node execution','combinations':25,'runtimeSuites':30,'mixedSessions':repeated,'nodeTransactionSignatures':native_signatures,'actualElfsChecked':25 if a.artifacts else 0},indent=2))
