/** Independent real-firmware regression for host-controlled Merkle framing.
 * Public fixture seed only. --expect-old records the pre-fix acceptance gaps. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import {Emulator} from '../../apps/ledger/tests/speculos-driver.ts';
import * as s from '../../packages/sdk/src/index.ts';
import * as a from '../../packages/bitcoin-prl-adapter/src/index.ts';
import {ClientCommandInterpreter} from '../../packages/bitcoin-prl-adapter/src/upstream/clientCommands.ts';
import {Merkle,hashLeaf} from '../../packages/bitcoin-prl-adapter/src/upstream/merkle.ts';
const R=new URL('../../',import.meta.url).pathname.replace(/\/$/,'');
const old=process.argv.includes('--expect-old');
const output=await mkdtemp('/workspace/shared/prl-bitcoin-malformed-independent-');
const elf=process.env.PEARL_APP_ELF??R+'/apps/ledger-bitcoin-prl/build-artifacts/nanos2-regtest/app.elf';
const emulator=new Emulator('nanosp',elf,output,5141);
const fixture=JSON.parse(await readFile(R+'/fixtures/protocol-v1.json','utf8'));
const results:any[]=[];
const apdu=(ins:number,data:Uint8Array,cla=0xe1)=>s.concat(Uint8Array.of(cla,ins,0,1,data.length),data);
const decode=(r:Uint8Array)=>({status:r.at(-2)!*256+r.at(-1)!,data:Buffer.from(r.subarray(0,-2))});
try {
 await emulator.start();
 const transport=new s.SpeculosTransport(emulator.url,15000);
 const client=new a.LedgerBitcoinPrlClient(transport,'regtest');
 const account=await emulator.approve(()=>client.exportAccount(0),'Approve public key','export');
 const policy=await(client as any).policyFor(account,new AbortController().signal);
 async function raw(mode:'empty-chunks'|'oversized-map'|'trailing-commitment') {
  const p=a.buildPrlPsbt(s.bundleFromJson(fixture.bundle),account);
  if(mode==='oversized-map')for(let i=0;i<25;i++)(p.inputMaps[0] as Map<string,Uint8Array>).set('ee'+i.toString(16).padStart(2,'0'),Uint8Array.of(0));
  const c=new ClientCommandInterpreter();c.addKnownWalletPolicy(policy);
  const g=a.merkleMap(p.globalMap),ins=p.inputMaps.map(a.merkleMap),outs=p.outputMaps.map(a.merkleMap);
  for(const m of [g,...ins,...outs])c.addKnownMapping(m);
  const ic=ins.map(m=>m.commitment()),oc=outs.map(m=>m.commitment());
  if(mode==='trailing-commitment')ic[0]=Buffer.concat([ic[0]!,Buffer.from([0xaa])]);
  c.addKnownList(ic);c.addKnownList(oc);
  const data=s.concat(g.commitment(),s.compactSize(ins.length),new Merkle(ic.map(x=>hashLeaf(x))).getRoot(),s.compactSize(outs.length),new Merkle(oc.map(x=>hashLeaf(x))).getRoot(),policy.getId(),new Uint8Array(32));
  let response=decode(await transport.exchange(apdu(4,data))),commands=0,zeroChunks=0,started=false,inputKeyProofs=0;
  const partials:a.PrlPartialSignature[]=[];
  while(response.status===0xe000) {
   assert(++commands<1000);
   if(response.data[0]===0x41&&response.data.subarray(1,33).equals(ins[0]!.keysTree.getRoot()))inputKeyProofs++;
   let answer:Uint8Array;
   if(mode==='empty-chunks'&&started&&response.data[0]===0xa0) {
    if(zeroChunks<5){zeroChunks++;answer=Uint8Array.of(0,1);}
    else answer=Uint8Array.of(0,2); // End the bounded reproduction with an invalid element width.
   } else {
    answer=c.execute(response.data);
    if(mode==='empty-chunks'&&!started&&response.data[0]===0x40) {
     const r=new s.Reader(answer),n=r.compactSize(),sent=r.byte();
     assert(n>1&&sent>0);answer=s.concat(s.compactSize(n),Uint8Array.of(1),r.take(1));started=true;
    }
   }
   if(response.data[0]===0x10)partials.push(a.parseYieldedSignature(response.data.subarray(1)));
   response=decode(await transport.exchange(apdu(1,answer,0xf8)));
  }
  if(partials.length)a.verifyAndFinalize(s.bundleFromJson(fixture.bundle),account,partials);
  return {mode,status:response.status.toString(16),commands,zeroChunks,inputKeyProofs,signatures:partials.length};
 }
 const chunks=await raw('empty-chunks');
 assert.equal(chunks.zeroChunks,old?5:1);assert.equal(chunks.signatures,0);assert.notEqual(chunks.status,'9000');results.push(chunks);
 const maps=await raw('oversized-map');
 assert.equal(maps.signatures,0);assert.notEqual(maps.status,'9000');
 assert.equal(maps.inputKeyProofs,old?32:0);results.push(maps);
 const trailing=old?await emulator.approve(()=>raw('trailing-commitment'),'Sign transaction','trailing-commitment'):await raw('trailing-commitment');
 assert.equal(trailing.status,old?'9000':'6a80');assert.equal(trailing.signatures,old?2:0);results.push(trailing);
 await writeFile(output+'/result.json',JSON.stringify({status:'passed',mode:old?'confirmed-pre-fix-behavior':'rejects-fixed-regressions',firmware:emulator.provenance,results},null,2));
 console.log(JSON.stringify({output,results},null,2));
} finally {await emulator.stop();}
