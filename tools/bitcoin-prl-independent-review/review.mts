import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {Buffer} from 'node:buffer';
import {Emulator} from '/workspace/scratch/5d237258d612/ledgerPRL/apps/ledger/tests/speculos-driver.ts';
import * as s from '/workspace/scratch/5d237258d612/ledgerPRL/packages/sdk/src/index.ts';
import * as a from '/workspace/scratch/5d237258d612/ledgerPRL/packages/bitcoin-prl-adapter/src/index.ts';
import {ClientCommandInterpreter} from '/workspace/scratch/5d237258d612/ledgerPRL/packages/bitcoin-prl-adapter/src/upstream/clientCommands.ts';
import {Merkle,hashLeaf} from '/workspace/scratch/5d237258d612/ledgerPRL/packages/bitcoin-prl-adapter/src/upstream/merkle.ts';
const R='/workspace/scratch/5d237258d612/ledgerPRL';
const output=await mkdtemp('/workspace/shared/prl-bitcoin-independent-');
const emulator=new Emulator('nanosp',R+'/apps/ledger-bitcoin-prl/build/nanos2/bin/app.elf',output,5141);
const fixture=JSON.parse(await readFile(R+'/fixtures/protocol-v1.json','utf8'));
const baseline=()=>s.bundleFromJson(fixture.bundle);
const results:any[]=[];
try{
 await emulator.start();
 const transport=new s.SpeculosTransport(emulator.url,15000);
 const client=new a.LedgerBitcoinPrlClient(transport,'regtest');
 const account=await emulator.approve(()=>client.exportAccount(0),'Approve public key','export');
 assert.deepEqual(s.accountToJson(account),fixture.publicAccount);
 const policy=await (client as any).policyFor(account,new AbortController().signal);
 const fresh=()=>a.buildPrlPsbt(baseline(),account) as any;
 async function rawSign(psbt:any,hmac=new Uint8Array(32)){
  const cci=new ClientCommandInterpreter();cci.addKnownWalletPolicy(policy);
  const gm=a.merkleMap(psbt.globalMap),im=psbt.inputMaps.map(a.merkleMap),om=psbt.outputMaps.map(a.merkleMap);
  cci.addKnownMapping(gm);for(const m of [...im,...om])cci.addKnownMapping(m);
  const ic=im.map((m:any)=>m.commitment()),oc=om.map((m:any)=>m.commitment());cci.addKnownList(ic);cci.addKnownList(oc);
  const ir=new Merkle(ic.map((x:any)=>hashLeaf(x))).getRoot(),or=new Merkle(oc.map((x:any)=>hashLeaf(x))).getRoot();
  let data=s.concat(gm.commitment(),s.compactSize(im.length),ir,s.compactSize(om.length),or,policy.getId(),hmac);
  let response=await transport.exchange(s.concat(Uint8Array.of(0xe1,4,0,1,data.length),data));let count=0;
  for(;;){const sw=response[response.length-2]*256+response[response.length-1];if(sw!==0xe000)return sw;
   assert(++count<2000,'continuation limit');const request=Buffer.from(response.slice(0,-2));assert.notEqual(request[0],0x10,'UNEXPECTED SIGNATURE YIELD');
   data=cci.execute(request);response=await transport.exchange(s.concat(Uint8Array.of(0xf8,1,0,1,data.length),data));
  }
 }
 const cases:[string,(p:any)=>void][]=[
 ['missing-network',(p)=>p.globalMap.delete(a.PRL_NETWORK_KEY)],
 ['wrong-network-id',(p)=>p.globalMap.get(a.PRL_NETWORK_KEY)[1]=0],
 ['wrong-genesis',(p)=>p.globalMap.get(a.PRL_NETWORK_KEY)[2]^=1],
 ['network-binding-trailing',(p)=>p.globalMap.set(a.PRL_NETWORK_KEY,s.concat(p.globalMap.get(a.PRL_NETWORK_KEY),Uint8Array.of(0)))],
 ['unknown-global-key',(p)=>p.globalMap.set('09',Uint8Array.of(0))],
 ['global-count-mismatch',(p)=>p.globalMap.set('04',Uint8Array.of(1))],
 ['psbt-version-zero',(p)=>p.globalMap.set('fb',s.u32(0))],
 ['transaction-version-two',(p)=>p.globalMap.set('02',s.u32(2))],
 ['nonzero-locktime',(p)=>p.globalMap.set('03',s.u32(1))],
 ['modifiable-outputs',(p)=>p.globalMap.set('06',Uint8Array.of(2))],
 ['input-amount-max-plus-one',(p)=>p.inputMaps[0].get('01').set(s.u64(s.MAX_GRAINS+1n))],
 ['input-zero',(p)=>p.inputMaps[0].get('01').set(s.u64(0n))],
 ['aggregate-input-max-plus-one',(p)=>{p.inputMaps[0].get('01').set(s.u64(s.MAX_GRAINS));p.inputMaps[1].get('01').set(s.u64(1n));}],
 ['aggregate-output-max-plus-one',(p)=>{p.outputMaps[0].set('03',s.u64(s.MAX_GRAINS));p.outputMaps[1].set('03',s.u64(1n));}],
 ['output-zero',(p)=>p.outputMaps[0].set('03',s.u64(0n))],
 ['negative-fee',(p)=>p.outputMaps[0].set('03',s.u64(s.MAX_GRAINS))],
 ['sighash-all',(p)=>p.inputMaps[0].set('03',s.u32(1))],
 ['sighash-anyonecanpay-single',(p)=>p.inputMaps[0].set('03',s.u32(0x83))],
 ['nonfinal-sequence',(p)=>p.inputMaps[0].set('10',s.u32(0xfffffffe))],
 ['duplicate-outpoint',(p)=>{p.inputMaps[1].set('0e',p.inputMaps[0].get('0e').slice());p.inputMaps[1].set('0f',p.inputMaps[0].get('0f').slice());}],
 ['input-p2mr',(p)=>p.inputMaps[0].get('01')[9]=0x52],
 ['recipient-witness-three',(p)=>p.outputMaps[0].get('04')[0]=0x53],
 ['change-p2mr',(p)=>p.outputMaps[1].get('04')[0]=0x52],
 ['two-external-recipients',(p)=>{for(const k of p.outputMaps[1].keys())if(k!=='03'&&k!=='04')p.outputMaps[1].delete(k);}],
 ['forged-change-script',(p)=>p.outputMaps[1].set('04',p.outputMaps[0].get('04').slice())],
 ['foreign-internal-key',(p)=>p.inputMaps[0].get('17')[1]^=1],
 ['taproot-script-tree',(p)=>p.inputMaps[0].set('18',new Uint8Array(32))],
 ['musig-input',(p)=>p.inputMaps[0].set('1b',new Uint8Array(32))],
 ];
 for(const[name,mutate]of cases){const psbt=fresh();mutate(psbt);const status=await rawSign(psbt);assert.notEqual(status,0x9000,name);results.push({name,status:status.toString(16),passed:true});console.log('REJECT',name,status.toString(16));}
 const hmacStatus=await rawSign(fresh(),new Uint8Array(32).fill(1));assert.notEqual(hmacStatus,0x9000);results.push({name:'nonzero-wallet-hmac',status:hmacStatus.toString(16),passed:true});
 const variants:any[]=[];
 const high=baseline();high.inputs=[{...high.inputs[0],amount:s.MAX_GRAINS}];high.outputs=[{...high.outputs[0],amount:200_000_000_000_000_000n}];variants.push(['overflow-high-fee',high]);
 const max=baseline();max.inputs=[{...max.inputs[0],amount:s.MAX_GRAINS}];max.outputs=[{...max.outputs[0],amount:s.MAX_GRAINS-1n}];variants.push(['max-minus-one',max]);
 const p2mr=baseline();p2mr.outputs[0].scriptPubKey=s.concat(Uint8Array.of(0x52,0x20),new Uint8Array(32).fill(255));variants.push(['p2mr-ff-root',p2mr]);
 for(const[name,bundle]of variants){const final=await emulator.approve(()=>client.signBundle(bundle,account),'Sign transaction',name);assert.equal(final.signatures.length,bundle.inputs.length);results.push({name,passed:true,txid:final.txid});await writeFile(output+'/'+name+'.json',JSON.stringify({bundle:s.bundleToJson(bundle),rawTx:final.rawTx,txid:final.txid},null,2));}
 const highScreens=emulator.screens.filter(x=>x.label==='overflow-high-fee').map(x=>x.text).join('\n');assert.match(highScreens,/High fees warning/);assert.match(highScreens,/19000000000 PRL/);assert.match(highScreens,/2000000000 PRL/);
 const maxScreens=emulator.screens.filter(x=>x.label==='max-minus-one').map(x=>x.text).join('\n');assert.match(maxScreens.replaceAll(" | ", ""),/20999999999\.99999999 PRL/);assert.match(maxScreens,/0\.00000001 PRL/);
 const mrScreens=emulator.screens.filter(x=>x.label==='p2mr-ff-root').map(x=>x.text).join('\n');assert.match(mrScreens,/P2MR/);assert.match(mrScreens,/Change path/);
 await writeFile(output+'/result.json',JSON.stringify({status:'passed',firmware:emulator.provenance,results},null,2));
 console.log('PASS independent native review',results.length,'cases',output);
}finally{await emulator.stop();}
