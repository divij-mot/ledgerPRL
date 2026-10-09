#!/usr/bin/env python3
"""Untouched Speculos native wall-clock qualification; public test fixture only.
No ticker API, injections, software signing, real devices, or network broadcast.
Usage: SPECULOS_VENV/bin/python native-wallclock.py --repo REPO --output NEW_DIR [--qemu-dir DIR]
Requires official installed Speculos 0.27.1, QEMU and repository simnet development artifacts.
Copies ELFs under the existing per-device lock before running. Never uses physical devices.
"""
import concurrent.futures, hashlib, json, os, queue, socket, struct, subprocess, sys, threading, time, traceback
from pathlib import Path
import requests

# Inputs must be explicitly selected; output must be a new directory.
import argparse, fcntl, importlib.metadata, shutil
import speculos
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--repo',type=Path,required=True)
parser.add_argument('--output',type=Path,required=True)
parser.add_argument('--qemu-dir',type=Path)
parser.add_argument('--base-port',type=int,default=5321)
parser.add_argument('--models',nargs='+',choices=['nanosp','nanox','stax','flex','apex_p'],default=['nanosp','nanox','stax','flex','apex_p'])
args=parser.parse_args()
REPO=args.repo.resolve();ROOT=args.output.resolve();ROOT.mkdir()
assert importlib.metadata.version('speculos')=='0.27.1','Use official installed Speculos 0.27.1 Python environment'
DIMS={'nanosp':(128,64),'nanox':(128,64),'stax':(400,672),'flex':(480,600),'apex_p':(300,400)}
MODELS=list(DIMS)
sha=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
def source_snapshot(repo):
    # Use the same source enumeration as native build provenance. Equality below
    # rejects empty, missing, unexpected, or changed manifest source entries.
    snapshot=json.loads(subprocess.check_output([sys.executable,str(repo/'scripts/ledger-build-manifest.py'),'snapshot'],text=True))
    if not isinstance(snapshot,dict) or not snapshot:
        raise ValueError('Native source snapshot must be a nonempty map')
    return snapshot

def validate_manifest(manifest, snapshot, target, elf_hash):
    if manifest.get('network')!='simnet' or manifest.get('device')!=target:
        raise ValueError('Firmware target/network mismatch')
    if not snapshot or manifest.get('sources')!=snapshot:
        raise ValueError('Manifest source set/hash map does not exactly match native snapshot')
    if manifest.get('elfSha256')!=elf_hash:
        raise ValueError('Source ELF hash does not match manifest')

def validate_copied_artifacts(frozen, copied_manifest, expected_manifest_bytes, expected_elf_hash):
    if sha(frozen)!=expected_elf_hash:
        raise ValueError('Copied ELF hash does not match manifest')
    if copied_manifest.read_bytes()!=expected_manifest_bytes:
        raise ValueError('Copied manifest bytes do not match captured source manifest')

def stage_model(repo, output, target):
    with (repo/f'apps/ledger/target/.build-{target}.lock').open('rb') as lock:
        fcntl.flock(lock,fcntl.LOCK_EX)
        source=repo/f'apps/ledger/target/artifacts/pearl-{target}-simnet.elf'
        manifest=source.with_suffix('.build.json')
        manifest_bytes=manifest.read_bytes();m=json.loads(manifest_bytes)
        snapshot=source_snapshot(repo)
        validate_manifest(m,snapshot,target,sha(source))
        frozen=output/'frozen'/source.name
        copied_manifest=frozen.with_suffix('.build.json')
        for inp,out in [(source,frozen),(manifest,copied_manifest)]:
            with out.open('xb') as f:f.write(inp.read_bytes())
            out.chmod(0o444)
        validate_copied_artifacts(frozen,copied_manifest,manifest_bytes,m['elfSha256'])
        if manifest.read_bytes()!=manifest_bytes:
            raise ValueError('Source manifest changed during copy')
        if source_snapshot(repo)!=snapshot:
            raise ValueError('Native source set/hash map changed during copy')
        return {'frozenElf':str(frozen),'sourceElf':str(source),'sha256':sha(frozen),'manifestSha256':sha(copied_manifest),'exactSourceMapVerified':True,'copiedElfVerified':True,'copiedManifestBytesVerified':True},snapshot

PROV={'models':{},'sourceFiles':{},'tools':{},'speculosVersion':'0.27.1','publicTestSeed':'000102030405060708090a0b0c0d0e0f','commit':subprocess.check_output(['git','-C',str(REPO),'rev-parse','HEAD'],text=True).strip()}
(ROOT/'frozen').mkdir()
try:
    for model in args.models:
        target='nanosplus' if model=='nanosp' else model
        staged,snapshot=stage_model(REPO,ROOT,target)
        PROV['models'][model]=staged;PROV['sourceFiles'].update(snapshot)
except Exception as error:
    with (ROOT/'preflight-failure.json').open('x') as f:json.dump({'status':'failed','error':str(error),'emulatorStarted':False},f,indent=2)
    raise
FIXTURE=json.loads((REPO/'fixtures/protocol-v1.json').read_text())
PROV['sourceFiles']['fixtures/protocol-v1.json']=sha(REPO/'fixtures/protocol-v1.json')
PAYLOAD=bytearray.fromhex(FIXTURE['bundleHex']);assert PAYLOAD[4]==3;PAYLOAD[4]=4;PAYLOAD=bytes(PAYLOAD)
PAYLOAD_HASH=hashlib.sha256(PAYLOAD).digest()
QEMU_PATH=str(args.qemu_dir)+os.pathsep+os.environ['PATH'] if args.qemu_dir else os.environ['PATH']
qemu=shutil.which('qemu-arm-static',path=QEMU_PATH);assert qemu,'Installed qemu-arm-static must be on PATH or --qemu-dir'
specroot=Path(speculos.__file__).parent
for file in [Path(sys.executable).resolve(),Path(qemu).resolve()]+[p for p in specroot.rglob('*') if p.is_file() and (p.suffix=='.py' or p.name=='launcher' or p.name in [f'{m}-api-level-shared-27.elf' for m in args.models])]:PROV['tools'][str(file)]={'sha256':sha(file),'bytes':file.stat().st_size}
PROV['tools'][str(REPO/'node_modules/@noble/curves/secp256k1.js')]={'sha256':sha(REPO/'node_modules/@noble/curves/secp256k1.js')}
with (ROOT/'provenance.json').open('x') as f:json.dump(PROV,f,indent=2)
NOW=time.monotonic_ns

def save(path,data):
    with path.open('x') as f:json.dump(data,f,indent=2);f.write('\n')
def apdu(ins,data=b''):return bytes([0xe0,ins,0,0,len(data)])+data
def u16(n):return struct.pack('<H',n)
def sw(x):return x[-2:].hex()

class Emulator:
    def __init__(self,model,name,run):
        self.model=model;self.path=run/model/name;self.path.mkdir(parents=True)
        self.port=args.base_port+MODELS.index(model)*2+(int(name[:2])-1)*10
        self.http=requests.Session();self.http.trust_env=False
        self.loglines=[];self.ticks=[];self.native_exit=None;self.exited=threading.Event();self.started=NOW()
        self.transcript=[];self.screens=[];self.closed=threading.Event();self.responses=queue.Queue();self.sock=None;self.last_response=None
        for port in [self.port,self.port+1]:
            with socket.socket() as probe:probe.bind(('127.0.0.1',port))
        elf=Path(PROV['models'][model]['frozenElf']);assert hashlib.sha256(elf.read_bytes()).hexdigest()==PROV['models'][model]['sha256']
        argv=[sys.executable,'-m','speculos','--display','headless','--model',model,'--api-port',str(self.port),'--apdu-port',str(self.port+1),'--seed','hex:'+PROV['publicTestSeed'],'--log-level','seproxyhal.packet:DEBUG',str(elf)]
        save(self.path/'launch.json',{'argv':argv,'elfSha256':PROV['models'][model]['sha256'],'normalTicker':True,'noTickerApiOrInjections':True,'startMonotonicNs':self.started})
        env=dict(os.environ);env['PATH']=QEMU_PATH;env.pop('SPECULOS_INJECTOR',None)
        self.child=subprocess.Popen(argv,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,env=env,start_new_session=True)
        self.logthread=threading.Thread(target=self.readlog,daemon=True);self.logthread.start()
        for _ in range(100):
            if self.child.poll() is not None:raise RuntimeError('Speculos startup failed: '+''.join(self.loglines[-10:]))
            try:self.events();break
            except requests.RequestException:time.sleep(.1)
        else:raise RuntimeError('Speculos API not ready')
        time.sleep(.25)
        self.sock=socket.create_connection(('127.0.0.1',self.port+1),timeout=5);self.sock.settimeout(None)
        self.wirethread=threading.Thread(target=self.readwire,daemon=True);self.wirethread.start()
    def readlog(self):
        total=0
        with (self.path/'speculos-monotonic.log').open('x') as f:
            for raw in self.child.stdout:
                at=NOW();line=raw.decode(errors='replace');self.loglines.append(line)
                if 'seproxyhal.packet: send 0e0000' in line:self.ticks.append(at)
                if 'exit called (1)' in line:self.native_exit=at;self.exited.set()
                if total<1024*1024:
                    entry=f'{at} {line}';f.write(entry);f.flush();total+=len(entry)
    def readwire(self):
        buf=b''
        try:
            while True:
                b=self.sock.recv(4096)
                if not b:break
                buf+=b
                while len(buf)>=4:
                    length=struct.unpack('>I',buf[:4])[0]+2
                    assert length<=4096
                    if len(buf)<length+4:break
                    r=buf[4:4+length];buf=buf[4+length:];record={'direction':'response','atNs':NOW(),'hex':r.hex(),'sw':sw(r),'tickCount':len(self.ticks)}
                    self.transcript.append(record);self.responses.put((r,record));self.last_response=record
        finally:self.closed.set()
    def send(self,data):
        rec={'direction':'command','atNs':NOW(),'hex':data.hex(),'tickCount':len(self.ticks)};self.transcript.append(rec)
        self.sock.sendall(struct.pack('>I',len(data))+data);return rec
    def receive(self,timeout=10):
        return self.responses.get(timeout=timeout)
    def exchange(self,data,expected='9000'):
        sent=self.send(data);r,received=self.receive();assert sw(r)==expected,(data.hex(),r.hex(),expected);return r,sent,received
    def json(self,path,data=None):
        assert 'ticker' not in path.lower(),'Ticker API forbidden in this qualification'
        url=f'http://127.0.0.1:{self.port}'+path
        r=self.http.get(url,timeout=5) if data is None else self.http.post(url,json=data,timeout=10)
        r.raise_for_status();return r.json()
    def events(self):return self.json('/events?currentscreenonly=true')['events']
    def capture(self,label):
        ev=self.events();self.screens.append({'label':label,'atNs':NOW(),'tickCount':len(self.ticks),'events':ev})
        r=self.http.get(f'http://127.0.0.1:{self.port}/screenshot',timeout=5);r.raise_for_status()
        with (self.path/(label+'.png')).open('xb') as f:f.write(r.content)
        return ev
    def next(self):
        if self.model in ['nanosp','nanox']:self.json('/button/right',{'action':'press-and-release'})
        else:
            w,h=DIMS[self.model];self.json('/finger',{'x':int(w*.85),'y':int(h*.52),'x2':int(w*.15),'y2':int(h*.52),'action':'press-and-release','delay':.2})
    def reach_final(self):
        sent=self.send(apdu(0x12))
        for _ in range(100):
            time.sleep(.15);ev=self.events()
            if any(x['text']=='Sign Pearl transfer' for x in ev):
                self.capture('approval-pending');return sent,ev
            assert self.responses.empty(),'Review finished without approval'
            if not any(x['text'] in ['app is ready','This app enables signing'] for x in ev):self.next()
        raise RuntimeError('Could not reach final approval')
    def approve(self,events):
        assert self.responses.empty(),'Approval was reused before new gesture'
        at=NOW()
        if self.model in ['nanosp','nanox']:self.json('/button/both',{'action':'press-and-release'})
        else:
            hold=next(x for x in events if x['text'].startswith('Hold to'))
            self.json('/finger',{'x':hold['x']+max(5,hold['w']//2),'y':hold['y']+max(5,hold['h']//2),'action':'press-and-release','delay':2.5})
        r,rec=self.receive();assert sw(r)=='9000' and len(r)==35 and r[0]==2 and r[1:33]==PAYLOAD_HASH
        return {'gestureStartNs':at,'response':rec}
    def upload(self):
        self.exchange(apdu(0x10,u16(len(PAYLOAD))+PAYLOAD_HASH))
        for offset in range(0,len(PAYLOAD),253):self.exchange(apdu(0x11,u16(offset)+PAYLOAD[offset:offset+253]))
    def reuse_probes(self):
        results=[]
        for label,data in [('fetch-unexported-index-1',apdu(0x13,b'\x01')),('fetch-exported-index-0',apdu(0x13,b'\x00')),('review-old-session',apdu(0x12)),('append-old-session',apdu(0x11,u16(20)+PAYLOAD[20:40]))]:
            r,_,rec=self.exchange(data,expected='6986');results.append({'probe':label,'response':rec})
        self.exchange(apdu(0));return results
    def expire(self,start,reference):
        # No commands or UI events are sent between pending-state setup and teardown.
        until=start['atNs']/1e9+150
        assert self.exited.wait(max(0,until-time.monotonic())),'No native timeout within 150 seconds'
        self.child.wait(timeout=5);self.logthread.join(timeout=3);self.closed.wait(3)
        assert self.native_exit is not None and self.child.returncode==1
        log=''.join(self.loglines);assert 'Traceback' not in log and 'exit called (1)' in log
        elapsed=(self.native_exit-start['atNs'])/1e9
        observed=[t for t in self.ticks if start['atNs']<=t<=self.native_exit]
        assert 118<=elapsed<=145,('Unexpected real wall timeout',elapsed)
        assert 1198<=len(observed)<=1202,('Unexpected normal ticker count',len(observed))
        after=[r for r in self.transcript if r['direction']=='response' and r['atNs']>start['atNs']]
        assert all(r['sw']!='9000' for r in after),after
        assert self.closed.is_set(),'Transport stayed open after native exit'
        # Application is gone; no final approval callback can succeed through the former endpoint.
        refused=False
        try:
            with socket.create_connection(('127.0.0.1',self.port+1),timeout=1):pass
        except OSError:refused=True
        assert refused,'APDU listener remained open after expiration'
        return {'status':'passed','reference':reference,'referenceAtNs':start['atNs'],'nativeExitNs':self.native_exit,'elapsedSeconds':elapsed,'normalTicksObserved':len(observed),'postReferenceResponses':after,'transportClosed':True,'postExpiryConnectRefused':True,'nativeExitCode':self.child.returncode,'firstTickSeconds':(observed[0]-start['atNs'])/1e9,'lastTickSeconds':(observed[-1]-start['atNs'])/1e9}
    def stop(self):
        if self.sock:
            try:self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:pass
            self.sock.close()
        if self.child.poll() is None:
            self.child.terminate()
            try:self.child.wait(timeout=5)
            except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=5)
        self.logthread.join(timeout=3)
        save(self.path/'apdu-transcript.json',self.transcript);save(self.path/'screens.json',self.screens)
        save(self.path/'ticker-observations.json',{'normalTickDeliveryMonotonicNs':self.ticks,'nativeExitNs':self.native_exit,'logTimestampMeaning':'Host observation of untouched Speculos packet logger output, not a firmware timer hook'})

def verify(sig,index):
    data={'signature':sig.hex(),'sighash':FIXTURE['sighashes'][index],'publicKey':FIXTURE['bundle']['inputs'][index]['scriptPubKey'][4:]}
    p=subprocess.run(['node','-e',"const fs=require('node:fs');const {schnorr}=require(process.argv[1]);const d=JSON.parse(fs.readFileSync(0,'utf8'));if(!schnorr.verify(d.signature,d.sighash,d.publicKey))process.exit(1);",str(REPO/'node_modules/@noble/curves/secp256k1.js')],input=json.dumps(data),text=True,capture_output=True)
    assert p.returncode==0,(p.stdout,p.stderr)
    return data

def run_model(model,run):
    result={'model':model,'elfSha256':PROV['models'][model]['sha256'],'cases':[],'status':'running'}
    e=None
    try:
        e=Emulator(model,'01-incomplete-receiving',run)
        e.exchange(apdu(0x10,u16(len(PAYLOAD))+PAYLOAD_HASH))
        _,_,mark=e.exchange(apdu(0x11,u16(0)+PAYLOAD[:20]));e.capture('incomplete-receiving')
        case={'name':'incomplete-receiving','uploadedBytes':20,'totalBytes':len(PAYLOAD),**e.expire(mark,'Last APPEND response; no further APDU or UI progress')}
        save(e.path/'result.json',case);result['cases'].append(case);print('PASS',model,case['name'],round(case['elapsedSeconds'],3),case['normalTicksObserved'],flush=True);e.stop();e=None
        e=Emulator(model,'02-unapproved-review',run);probes=e.reuse_probes();e.upload();mark,events=e.reach_final()
        case={'name':'unapproved-review','postPreviousExpiryProbes':probes,'approvalNeverSent':True,**e.expire(mark,'REVIEW command sent; navigated to final approval, then no UI activity')}
        save(e.path/'result.json',case);result['cases'].append(case);print('PASS',model,case['name'],round(case['elapsedSeconds'],3),case['normalTicksObserved'],flush=True);e.stop();e=None
        e=Emulator(model,'03-approved-partial-export',run);probes=e.reuse_probes();e.upload();_,events=e.reach_final();approval=e.approve(events)
        signature,_,mark=e.exchange(apdu(0x13,b'\x00'));verified=verify(signature[:-2],0);e.capture('partial-export-one-of-two')
        case={'name':'approved-partial-export','postPreviousExpiryProbes':probes,'approval':approval,'exportedSignatures':1,'retainedSignatures':1,'independentlyVerifiedFirstSignature':verified,**e.expire(mark,'FETCH index 0 response; second signature left unexported')}
        save(e.path/'result.json',case);result['cases'].append(case);print('PASS',model,case['name'],round(case['elapsedSeconds'],3),case['normalTicksObserved'],flush=True);e.stop();e=None
        e=Emulator(model,'04-recovery-and-ordinary-idle',run);probes=e.reuse_probes();e.upload();_,events=e.reach_final()
        time.sleep(2);assert e.responses.empty(),'Previous approval reused after expiry'
        approval=e.approve(events);sigs=[]
        for i in [0,1]:
            r,_,_=e.exchange(apdu(0x13,bytes([i])));sigs.append(verify(r[:-2],i))
        e.exchange(apdu(0x13,b'\x01'),expected='6986')
        _,_,mark=e.exchange(apdu(0));before=e.capture('idle-start')
        time.sleep(125)
        assert e.child.poll() is None and e.native_exit is None,'Ordinary idle unexpectedly timed out'
        idle_end=NOW();after=e.capture('idle-end');r,_,_=e.exchange(apdu(0));assert r[-2:]==b'\x90\x00'
        count=sum(mark['atNs']<=t<=idle_end for t in e.ticks);assert count>=1200,('Idle control did not exceed 1200 ticks',count)
        assert [x['text'] for x in before]==[x['text'] for x in after],'Ordinary idle screen changed'
        case={'name':'recovery-and-ordinary-idle','status':'passed','postPreviousExpiryProbes':probes,'freshApprovalRequiredAndObserved':True,'freshApproval':approval,'freshSignaturesVerified':sigs,'idleElapsedSeconds':(idle_end-mark['atNs'])/1e9,'idleNormalTicks':count,'sameIdleText':True,'infoApduStillWorks':True}
        save(e.path/'result.json',case);result['cases'].append(case);print('PASS',model,case['name'],round(case['idleElapsedSeconds'],3),count,flush=True);e.stop();e=None
        result['status']='passed'
    except Exception as err:
        result['status']='failed';result['error']=str(err);result['traceback']=traceback.format_exc();print('FAIL',model,result['traceback'],flush=True)
    finally:
        if e is not None:
            try:e.stop()
            except Exception as err:result['cleanupError']=str(err)
        save(run/model/'result.json',result)
    return result

if __name__=='__main__':
    run=ROOT/'measurements';run.mkdir()
    models=args.models
    save(run/'harness-inputs.json',{'harnessSha256':sha(Path(__file__)),'provenanceSha256':sha(ROOT/'provenance.json'),'payloadSha256':PAYLOAD_HASH.hex(),'payloadHex':PAYLOAD.hex(),'models':models,'clock':'time.monotonic_ns','deadlineSecondsPerPendingState':150,'idleObservationSeconds':125,'normalTickerOnly':True})
    with concurrent.futures.ThreadPoolExecutor(max_workers=len(models)) as pool:results=list(pool.map(lambda m:run_model(m,run),models))
    source_end=source_snapshot(REPO)
    build_sources={k:v for k,v in PROV['sourceFiles'].items() if k!='fixtures/protocol-v1.json'}
    unchanged=source_end==build_sources and all(sha(REPO/rel)==h for rel,h in PROV['sourceFiles'].items())
    passed=all(r['status']=='passed' for r in results) and unchanged
    save(run/'summary.json',{'status':'passed' if passed else 'failed','models':results,'sourceInputsUnchanged':unchanged})
    raise SystemExit(0 if passed else 1)
