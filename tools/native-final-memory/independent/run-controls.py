#!/usr/bin/env python3
"""Read-only packet checks, with adversarial changes confined to fresh temporary copies."""
import argparse,hashlib,json,os,pathlib,shutil,subprocess,tempfile
if not __debug__:
 raise SystemExit("Run the control harness without -O, -OO, or PYTHONOPTIMIZE")
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--source', required=True, type=pathlib.Path, help='Frozen repository source checkout')
p.add_argument('--evidence', required=True, type=pathlib.Path, help='Hardened native-final-memory packet directory')
p.add_argument('--artifacts', required=True, type=pathlib.Path, help='Directory containing the five instrumented ELFs')
p.add_argument('--results', required=True, type=pathlib.Path, help='Destination JSON report; parent directory must exist')
a=p.parse_args()
a.source=a.source.resolve();a.evidence=a.evidence.resolve();a.artifacts=a.artifacts.resolve()
results=[]
redactions={str(a.source):'<SOURCE>',str(a.evidence):'<EVIDENCE>',str(a.artifacts):'<ARTIFACTS>'}
def scrub(text):
 for old,new in sorted(redactions.items(),key=lambda x:len(x[0]),reverse=True):text=text.replace(old,new)
 return text
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def save(p,d):p.write_text(json.dumps(d,indent=2)+'\n')
def edit(p,rel,f):
 q=p/rel;d=json.loads(q.read_text());f(d);save(q,d)
def check(name,command,passed=False,env=None):
 r=subprocess.run(command,capture_output=True,text=True,env=env);ok=(r.returncode==0)==passed
 results.append({'name':name,'expected':'accept' if passed else 'reject','returncode':r.returncode,'correct':ok,'stdout':scrub(r.stdout),'stderr':scrub(r.stderr)});print(name,r.returncode,'OK' if ok else 'FAIL')
 return r
with tempfile.TemporaryDirectory(prefix='memory-audit-controls-') as tmp:
 t=pathlib.Path(tmp);redactions[str(t)]='<TEMP>';base=t/'base';shutil.copytree(a.evidence,base)
 def copy(name):
  q=t/name;shutil.copytree(base,q);return q
 def verify(name,q=base,passed=False,flags=(),artifacts=a.artifacts,source=a.source,env=None):return check(name,['python3',*flags,str(q/'verify.py'),'--source',str(source),'--artifacts',str(artifacts)],passed,env)
 def rehash(q,kind,model='nanosp'):
  field='memoryEvidenceSha256' if kind=='memory' else 'stabilityEvidenceSha256'
  edit(q,'report.json',lambda d:d['models'][0].update({field:sha(q/kind/(model+'.json'))}))
 verify('baseline',passed=True)
 for opt in ('-O','-OO'):verify('optimized-'+opt,flags=(opt,))
 for value in ('1','2'):verify('PYTHONOPTIMIZE-'+value,env={**os.environ,'PYTHONOPTIMIZE':value})
 q=copy('failed');edit(q,'report.json',lambda d:d.update(status='failed'));verify('failed-report',q)
 q=copy('missing-model');edit(q,'report.json',lambda d:d['models'].pop());verify('missing-model',q)
 q=copy('pins');edit(q,'report.json',lambda d:d.update(rustSdk='0'*40,secureSdk='0'*40,features=[]));verify('wrong-pins-features',q)
 q=copy('counts');edit(q,'report.json',lambda d:d['models'][0]['checkedSignatures'].update(complete=0));verify('wrong-aggregate-count',q)
 q=copy('inventory');edit(q,'mirror-input-hashes.json',lambda d:d.pop('apps/ledger/src/crypto.rs'));verify('omitted-crypto-inventory',q)
 q=copy('native-inventory')
 for rel in ('parent-native-source-before.json','parent-native-source-after.json','mirror-native-source-after.json'):edit(q,rel,lambda d:d.pop('apps/ledger/src/ui.rs'))
 verify('omitted-native-inventory',q)
 q=copy('script-copy');f=q/'sources/ledger-build-instrumented.sh';f.write_bytes(f.read_bytes()+b'\n');verify('changed-retained-build-script',q)
 for kind,rel in [('memory','memory/nanosp.json'),('stability','stability/nanosp.json'),('log','builds/nanosplus.log'),('patch','sources/memory-instrumentation.patch')]:
  q=copy('changed-'+kind);f=q/rel;f.write_bytes(f.read_bytes()+b'\n');verify('changed-'+kind,q)
 af=t/'artifacts';shutil.copytree(a.artifacts,af);f=next(af.glob('*.elf'));b=bytearray(f.read_bytes());b[100]^=1;f.write_bytes(b);verify('changed-ELF',artifacts=af)
 q=copy('raw-counts');edit(q,'stability/nanosp.json',lambda d:d['checkedSignatures'].update(complete=0));edit(q,'report.json',lambda d:d['models'][0]['checkedSignatures'].update(complete=0));rehash(q,'stability');verify('rehashed-inconsistent-signature-count',q)
 q=copy('raw-model');edit(q,'memory/nanosp.json',lambda d:d['firmware'].update(model='nanox'));rehash(q,'memory');verify('rehashed-wrong-raw-model',q)
 q=copy('raw-patch');edit(q,'memory/nanosp.json',lambda d:d.update(instrumentationPatchSha256='0'*64));rehash(q,'memory');verify('rehashed-wrong-raw-patch',q)
 q=copy('raw-harness');edit(q,'stability/nanosp.json',lambda d:d['sourceSha256'].update(harness='0'*64));rehash(q,'stability');verify('rehashed-wrong-harness-source',q)
 q=copy('raw-sessions');edit(q,'stability/nanosp.json',lambda d:d['records'][0].update(kind='address'));rehash(q,'stability');verify('rehashed-wrong-session-kind',q)
 # Replay rejection checks never run a build: optimization rejects before source reads or writes.
 for opt in ('-O','-OO'):
  dest=t/('prepare-'+opt)
  check('prepare-'+opt,['python3',opt,str(base/'prepare-isolated.py'),'--source',str(a.source),'--output',str(dest)])
  if dest.exists():raise RuntimeError('Optimized prepare wrote its output')
 for value in ('1','2'):
  dest=t/('wrapper-opt-'+value)
  check('wrapper-PYTHONOPTIMIZE-'+value,['bash',str(base/'run-isolated.sh'),str(a.source),str(dest)],env={**os.environ,'PYTHONOPTIMIZE':value})
  if dest.exists():raise RuntimeError('Optimized wrapper wrote its output')
 existing=t/'existing';existing.mkdir();(existing/'sentinel').write_text('untouched')
 check('prepare-existing-output',['python3',str(base/'prepare-isolated.py'),'--source',str(a.source),'--output',str(existing)])
 if (existing/'sentinel').read_text()!='untouched' or len(list(existing.iterdir()))!=1:raise RuntimeError('Existing output changed')
 # Output containment must reject both direct and symlink-aliased children before writes.
 fake=t/'fake-source';fake.mkdir();(fake/'sentinel').write_text('source untouched')
 alias=t/'source-alias';alias.symlink_to(fake,target_is_directory=True)
 before={str(x.relative_to(fake)):sha(x) for x in fake.rglob('*') if x.is_file()}
 for name,dest in [('direct-child',fake/'new-output'),('symlink-child',alias/'new-output')]:
  r=check('prepare-rejects-'+name,['python3',str(base/'prepare-isolated.py'),'--source',str(fake),'--output',str(dest)])
  if 'Output must be outside the source checkout' not in r.stderr:raise RuntimeError('Containment guard did not reject first')
  if dest.exists():raise RuntimeError('Containment guard wrote its output')
  after={str(x.relative_to(fake)):sha(x) for x in fake.rglob('*') if x.is_file()}
  if before!=after:raise RuntimeError('Source checkout changed during containment rejection')
 check('wrapper-bash-syntax',['bash','-n',str(base/'run-isolated.sh')],passed=True)
 evidence_files=['verify.py','prepare-isolated.py','run-isolated.sh','README.md','report.json','mirror-input-hashes.json','parent-native-source-before.json','parent-native-source-after.json','mirror-native-source-after.json','instrumented-sdk-delta.json','sources/memory-instrumentation.patch','sources/strict-transport.patch','sources/ledger-build-instrumented.sh']
 for folder in ('memory','stability','builds'):
  evidence_files.extend(str(q.relative_to(a.evidence)) for q in sorted((a.evidence/folder).iterdir()) if q.is_file())
 summary={'status':'passed' if all(r['correct'] for r in results) else 'failed','scope':'Retained evidence and checker negative controls only; no builds or emulator replay','controls':len(results),'successfulControls':sum(r['correct'] for r in results),'sourceCryptoSha256':sha(a.source/'apps/ledger/src/crypto.rs'),'evidenceSha256':{f:sha(a.evidence/f) for f in evidence_files},'instrumentedElfSha256':{q.name:sha(q) for q in sorted(a.artifacts.glob('pearl-*-simnet-INSTRUMENTED.elf'))},'results':results}
 save(a.results,summary)
if not all(r['correct'] for r in results):raise SystemExit('Unexpected control outcome')
print('ALL',len(results),'CONTROLS CORRECT')
