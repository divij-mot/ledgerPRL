/** Real native16-input + full31-bit account/index signing. Public BIP32 vector-one seed only. */
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {HDKey} from '@scure/bip32';
import {Emulator,type Model} from '../../apps/ledger-bitcoin-prl/prl-tests/emulator.ts';
import * as s from '../../packages/sdk/src/index.ts';
import * as a from '../../packages/bitcoin-prl-adapter/src/index.ts';
const R=new URL('../../',import.meta.url).pathname.replace(/\/$/,'');
const model=(process.env.SPECULOS_MODEL??'nanox') as Model;
const target=model==='nanosp'?'nanos2':model;
const elf=process.env.PEARL_APP_ELF??R+`/apps/ledger-bitcoin-prl/build-artifacts/${target}-regtest/app.elf`;
const output=await mkdtemp('/workspace/shared/prl-bitcoin-capacity-independent-');
const e=new Emulator(model,elf,output,5141);
const MAX_INDEX=0x7fffffff;
const fixture=JSON.parse(await readFile(R+'/fixtures/protocol-v1.json','utf8'));
try {
 await e.start();
 let apdus=0;
 const transport=new s.SpeculosTransport(e.url,120000);
 const client=new a.LedgerBitcoinPrlClient({exchange:(...args)=>{apdus++;return transport.exchange(...args)}},'regtest');
 const account=await e.approve(()=>client.exportAccount(MAX_INDEX),'Approve public key','max-account');
 const master=HDKey.fromMasterSeed(s.fromHex('000102030405060708090a0b0c0d0e0f'));
 const expected=master.derive("m/86'/1'/2147483647'");
 assert.equal(s.hex(account.publicKey),s.hex(expected.publicKey!));
 assert.equal(s.hex(account.chainCode),s.hex(expected.chainCode!));
 assert.equal(s.hex(account.masterFingerprint),s.hex(a.u32be(master.fingerprint)));
 expected.wipePrivateData();master.wipePrivateData();
 const bundle:s.SigningBundle={network:'regtest',account:MAX_INDEX,version:1,lockTime:0,
  inputs:Array.from({length:16},(_,i)=>{
   const branch=(i%2) as 0|1,index=MAX_INDEX-Math.floor(i/2);
   return {txid:(i+1).toString(16).padStart(64,'0'),vout:i,amount:s.MAX_GRAINS/16n,
    scriptPubKey:s.deriveAddress(account,branch,index).scriptPubKey,sequence:0xffffffff,branch,index};
  }),
  outputs:[{...s.bundleFromJson(fixture.bundle).outputs[0]!,amount:s.MAX_GRAINS-9_000_000_000n-1000n,
   scriptPubKey:s.fromHex('5220'+'ff'.repeat(32))},
   {amount:9_000_000_000n,role:'change',branch:1,index:MAX_INDEX,
    scriptPubKey:s.deriveAddress(account,1,MAX_INDEX).scriptPubKey}]};
 assert.equal(s.validateBundle(bundle,account).inputTotal,s.MAX_GRAINS);
 const start=performance.now();
 const signed=await e.approve(()=>client.signBundle(bundle,account),'Sign transaction','capacity16-max-path');
 const elapsedMs=performance.now()-start;
 assert.equal(signed.signatures.length,16);
 const text=e.screens.filter(x=>x.label==='capacity16-max-path').map(x=>x.events.map(y=>y.text).join('')).join('').replace(/\s/g,'');
 assert(text.includes("m/86'/1'/2147483647'"),'Full account path missing');
 assert(text.includes("m/86'/1'/2147483647'/1/2147483647"),'Full change path missing');
 assert(text.includes(s.formatPrl(bundle.outputs[0]!.amount)+'PRL'),'Exact recipient amount missing');
 assert(text.includes('P2MR'),'Recipient type missing');
 await writeFile(output+'/capacity16-max-path.json',JSON.stringify({publicAccount:s.accountToJson(account),
  bundle:s.bundleToJson(bundle),rawTx:signed.rawTx,txid:signed.txid,wtxid:signed.wtxid,
  sighashes:bundle.inputs.map((_,i)=>s.hex(s.computeSighash(bundle,i))),signatures:signed.signatures.map(s.hex)},null,2));
 await writeFile(output+'/result.json',JSON.stringify({status:'passed',firmware:e.provenance,
  account:MAX_INDEX,maxInputIndex:MAX_INDEX,inputs:16,totalGrains:s.MAX_GRAINS.toString(),
  recipientType:'P2MR',changeType:'P2TR',elapsedMs,apdus,txid:signed.txid,
  limits:'Public-seed emulator only; no hardware stack instrumentation, live-chain state or mempool fee-policy qualification'},null,2));
 console.log(JSON.stringify({status:'passed',output,elapsedMs,apdus,inputs:signed.signatures.length},null,2));
} finally {await e.stop();}
