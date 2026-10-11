/** Explicit UI denial against the unchanged actual C regtest signer. No hardware or node. */
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:net';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, mkdir, copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Emulator, pause } from '../../apps/ledger-bitcoin-prl/prl-tests/emulator.ts';
import { apdu, response, publicAccount, rawSign } from '../../apps/ledger-bitcoin-prl/prl-tests/raw-protocol.ts';
import { bundleFromJson, SpeculosTransport, verifySignature } from '../../packages/sdk/src/index.ts';
import { buildPrlPsbt, parseYieldedSignature, verifyAndFinalize } from '../../packages/bitcoin-prl-adapter/src/index.ts';
const root=resolve(import.meta.dirname,'../..');
const image='ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools@sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2';
const sourceElf='/private/tmp/pearl-name-review-q4wm1ypq/workspace/apps/ledger-bitcoin-prl/build-artifacts/nanos2-regtest/app.elf';
const expectedElf='77e2dc35fed3443440a1393c42ed6cf03fad13ecf5532a84dab7de014890ce14';
const sha=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
assert.equal(sha(await readFile(sourceElf)),expectedElf);
const build=JSON.parse(await readFile(join(root,'tools/pearl-name-review/regtest-build.json'),'utf8'));
const cFiles=['src/handler/sign_psbt.c','src/handler/sign_psbt/transaction_display.c','src/handler/sign_psbt/sign_input.c','src/ui/display.c','src/ui/display_nbgl.c','src/boilerplate/dispatcher.c','src/boilerplate/prl_review_io.c','src/boilerplate/sw.h'];
const sourceHashes:Record<string,string>={};
for(const file of cFiles){const hash=sha(await readFile(join(root,'apps/ledger-bitcoin-prl',file)));assert.equal(hash,build.source_files[file],file+' changed since ELF build');sourceHashes[file]=hash;}
const output=await mkdtemp(join(tmpdir(),'pearl-explicit-denial-'));
const server=createServer(); await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
const port=(server.address() as {port:number}).port;await new Promise<void>(r=>server.close(()=>r()));
const container='pearl-explicit-denial-'+Date.now(); let running=false;
const evidence:any={date:new Date().toISOString(),network:'regtest',firmwareSha256:expectedElf,dockerImage:image,publicTestSeed:'000102030405060708090a0b0c0d0e0f',sourceHashes,physicalOperations:0,broadcasts:0,output};
class IsolatedEmulator extends Emulator {
 override async start(){
  await mkdir(this.output,{recursive:true});const elf=join(this.output,'tested-firmware.elf');await copyFile(this.elf,elf);
  evidence.speculos=execFileSync('docker',['run','--rm','--pull','never','--network','none',image,'python3','-c','import importlib.metadata;print(importlib.metadata.version("speculos"))'],{encoding:'utf8'}).trim();
  assert.equal(evidence.speculos,'0.27.1');
  const log=createWriteStream(join(this.output,'speculos.log'));
  this.child=spawn('docker',['run','--rm','--pull','never','--name',container,'--read-only','--cap-drop=ALL','--security-opt','no-new-privileges','--user',`${process.getuid!()}:${process.getgid!()}`,'--tmpfs','/tmp:rw,nosuid,nodev,mode=1777','--publish',`127.0.0.1:${this.port}:${this.port}`,'--mount',`type=bind,src=${elf},dst=/firmware.elf,readonly`,image,'speculos','--display','headless','--model','nanosp','--api-port',String(this.port),'--apdu-port','0','--seed','hex:000102030405060708090a0b0c0d0e0f','/firmware.elf'],{stdio:['ignore','pipe','pipe']});
  running=true;this.child.stdout!.pipe(log);this.child.stderr!.pipe(log);
  for(let n=0;n<120;n++){assert.equal(this.child.exitCode,null,'Emulator exited');try{await this.events();return;}catch{await pause(150);}}
  throw new Error('Emulator startup timeout');
 }
 override async stop(){
  await writeFile(join(output,'screens.json'),JSON.stringify(this.screens,null,2)+'\n');
  if(running){try{execFileSync('docker',['stop','--time','5',container],{stdio:'ignore'});}finally{running=false;}}
 }
}
const emulator=new IsolatedEmulator('nanosp',sourceElf,output,port);
const frames:any[]=[];
let transport:SpeculosTransport|undefined;
try {
 await emulator.start(); transport=new SpeculosTransport(emulator.url,30_000);
 const traced={exchange:async(command:Uint8Array,signal?:AbortSignal)=>{const bytes=await transport!.exchange(command,signal);const r=response(bytes);frames.push({cla:command[0],instruction:command[1],status:r.status,payloadBytes:r.data.length,rawYield:r.status===0xe000&&r.data[0]===0x10,frameHex:Buffer.from(bytes).toString('hex')});return bytes;}} as SpeculosTransport;
 const identity=await publicAccount(traced,'regtest',operation=>emulator.approve(operation,'Approve public key','account'));
 const fixture=JSON.parse(await readFile(join(root,'fixtures/protocol-v1.json'),'utf8'));
 const bundle=bundleFromJson({...fixture.bundle,network:'regtest'}), psbt=buildPrlPsbt(bundle,identity.account);
 const firstFrame=frames.length;
 const pending=rawSign(traced,psbt,identity.policy);pending.catch(()=>{});
 let reached=false;
 for(let n=0;n<180;n++){await pause(130);const events=await emulator.events();
  if(events.some(e=>e.text.replace(/\s+/g,' ').startsWith('Sign transaction'))){await emulator.capture('before-denial',events);reached=true;break;}
  if(events.some(e=>e.text==='Review anyway'))await emulator.button('both');
  else if(!events.some(e=>e.text.includes('app is ready')))await emulator.next();
 }
 assert(reached,'Native final review not reached');
 await emulator.next();await pause(160);const rejected=await emulator.events();assert(rejected.some(e=>e.text==='Reject transaction'));
 await emulator.capture('explicit-reject',rejected);await emulator.button('both');
 const denied=await pending;
 assert.equal(denied.status,0x6985);assert.equal(denied.data.length,0);assert.equal(denied.yields.length,0);
 assert.equal(frames.slice(firstFrame).filter(f=>f.rawYield).length,0);
 evidence.denial={status:'0x6985',payloadBytes:denied.data.length,rawYields:denied.yields.length,terminalFrame:frames.at(-1).frameHex,merkleContinuations:denied.commands,gesture:'both buttons on Reject transaction'};
 assert.equal(response(await traced.exchange(apdu(6))).status,0x9000);evidence.cleanNextCommand=true;
 const signed=await emulator.approve(()=>rawSign(traced,psbt,identity.policy),'Sign transaction','fresh-approval');
 assert.equal(signed.status,0x9000);assert.equal(signed.yields.length,2);
 const finalized=verifyAndFinalize(bundle,identity.account,signed.yields.map(parseYieldedSignature));
 evidence.freshApproval={status:'0x9000',signatures:signed.yields.length,independentlyVerified:true,txid:finalized.txid};
 const partial=await emulator.approve(()=>rawSign(traced,psbt,identity.policy,{respond:(request,standard)=>request[0]===0x10?Buffer.from([1]):standard()}),'Sign transaction','partial-then-bad-ack');
 assert.equal(partial.status,0x6a80);assert.equal(partial.yields.length,1);
 const released=parseYieldedSignature(partial.yields[0]!);
 assert(verifySignature(bundle,released.inputIndex,released.signature));
 evidence.partialThenBadAck={status:'0x6a80',rawYields:partial.yields.length,signatureIndependentlyValid:true};
 const recovery=rawSign(traced,psbt,identity.policy);recovery.catch(()=>{});let recoveryReview=false;
 for(let n=0;n<180;n++){await pause(130);const events=await emulator.events();
  if(events.some(e=>e.text.replace(/\s+/g,' ').startsWith('Sign transaction'))){recoveryReview=true;break;}
  if(events.some(e=>e.text==='Review anyway'))await emulator.button('both');
  else if(!events.some(e=>e.text.includes('app is ready')))await emulator.next();
 }
 assert(recoveryReview);await emulator.next();await pause(160);const rejectRecovery=await emulator.events();assert(rejectRecovery.some(e=>e.text==='Reject transaction'));
 await emulator.capture('recovery-reject',rejectRecovery);await emulator.button('both');
 const deniedRecovery=await recovery;
 assert.equal(deniedRecovery.status,0x6985);assert.equal(deniedRecovery.data.length,0);assert.equal(deniedRecovery.yields.length,0);
 assert(verifySignature(bundle,released.inputIndex,released.signature));
 evidence.recoveryDenial={status:'0x6985',rawYieldsThisAttempt:0,priorSignatureRemainsValid:true,priorCompleteTransactionRemainsValid:verifyAndFinalize(bundle,identity.account,signed.yields.map(parseYieldedSignature)).txid===finalized.txid};
 evidence.outcome='passed';
 console.log(JSON.stringify({output,denial:evidence.denial,freshApproval:evidence.freshApproval,partialThenBadAck:evidence.partialThenBadAck,recoveryDenial:evidence.recoveryDenial,outcome:evidence.outcome},null,2));
} catch(error){evidence.outcome='failed';evidence.error=String(error);throw error;}
finally {
 await transport?.close();await emulator.stop();
 await writeFile(join(output,'frames.json'),JSON.stringify(frames,null,2)+'\n');
 await writeFile(join(output,'result.json'),JSON.stringify(evidence,null,2)+'\n');
}
