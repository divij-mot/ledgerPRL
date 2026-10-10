// Independent offline probes. Public frozen signatures only; no device or network.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const root=process.env.PRL_ROOT??process.cwd();
const s=await import(pathToFileURL(root+'/packages/sdk/src/index.ts'));
const w=await import(pathToFileURL(root+'/packages/wallet/src/index.ts'));
const bridge=await import(pathToFileURL(root+'/apps/companion/src/bridge.ts'));
const f=JSON.parse(fs.readFileSync(root+'/fixtures/protocol-v1.json','utf8'));
const account=s.accountFromJson(f.publicAccount);
const initial=()=>s.decodeBundle(s.fromHex(f.bundleHex));
const signatures=()=>f.signatures.map(s.fromHex);
let count=0;
function pass(text){console.log('PASS '+text);count++;}
const valid={bundleHex:f.bundleHex,rawTx:f.rawTx,expectedTxid:f.txid};
assert.equal(bridge.verifyBroadcastPayload('regtest',valid).rawTx,f.rawTx);
pass('Canonical original fixture remains accepted at the broadcast verifier');
for(const [label,mutate] of [
 ['recipient value', b=>b.outputs[0].amount--],
 ['fee',b=>b.outputs[1].amount--],
 ['recipient script',b=>b.outputs[0].scriptPubKey=s.deriveAddress(account,0,98).scriptPubKey],
 ['input amount',b=>b.inputs[0].amount++],
 ['input outpoint hash',b=>b.inputs[0].txid='33'.repeat(32)],
 ['input outpoint index',b=>b.inputs[0].vout++],
 ['input order',b=>b.inputs.reverse()],
 ['output order',b=>b.outputs.reverse()],
]){
 const b=initial();mutate(b);s.validateBundle(b,account);
 assert.throws(()=>s.finalizeTransaction(b,signatures()));
 assert.throws(()=>bridge.verifyBroadcastPayload('regtest',{...valid,bundleHex:s.hex(s.encodeBundle(b))}));
 pass(`Cryptographically valid original signatures reject altered ${label}`);
}
assert.throws(()=>bridge.verifyBroadcastPayload('testnet2',valid),/network mismatch/);
pass('Bridge rejects configured-network mismatch before any RPC');
const sameDigest=initial();sameDigest.network='simnet';
assert.deepEqual(s.computeSighash(sameDigest,0),s.computeSighash(initial(),0));
pass('Documented chain-ID limitation reproduced: same transaction has same regtest/simnet digest');
function device(mode){
 const instructions=[],chunks=[];let digest;
 return {
  instructions,chunks,closed:false,
  async close(){this.closed=true;},
  async exchange(apdu){
   const ins=apdu[1],data=apdu.slice(5);instructions.push(ins);
   let answer=new Uint8Array();
   if(ins===s.INS.CAPABILITIES)answer=Uint8Array.of(1,0,1,0,3,16,0xe3,5);
   else if(ins===s.INS.BEGIN)digest=data.slice(2);
   else if(ins===s.INS.APPEND)chunks.push(data.slice(2));
   else if(ins===s.INS.REVIEW){
    assert.equal(s.hex(s.concat(...chunks)),f.bundleHex);
    assert.equal(s.hex(digest),f.bundleSha256);
    answer=s.concat(Uint8Array.of(2),mode==='wrong-review'?new Uint8Array(32):digest);
   }else if(ins===s.INS.SIGNATURE)answer=s.fromHex(f.signatures[mode==='wrong-signature'?1-data[0]:data[0]]);
   else if(ins!==s.INS.ABORT)throw Error('Unexpected APDU');
   return s.concat(answer,Uint8Array.of(0x90,0));
  }
 };
}
{
 const b=initial(),a=structuredClone(account),d=device('normal'),client=new s.LedgerPearlClient(d,'regtest');
 const pending=client.signBundle(b,a);
 b.outputs[0].amount=1n;b.outputs[0].scriptPubKey.fill(0);b.inputs.reverse();a.chainCode.fill(0);a.account++;
 const result=await pending;
 assert.equal(result.rawTx,f.rawTx);assert.equal(result.txid,f.txid);
 pass('Concurrent caller mutations cannot replace the immutable transferred/reviewed payment');
}
for(const mode of ['wrong-review','wrong-signature']){
 const d=device(mode),client=new s.LedgerPearlClient(d,'regtest');
 await assert.rejects(client.signBundle(initial(),account));
 assert.equal(client.sessionState,'failed');assert.equal(d.closed,true);
 assert.equal(d.instructions.filter(x=>x===s.INS.SIGNATURE).length,mode==='wrong-review'?0:1);
 const n=d.instructions.length;await assert.rejects(client.capabilities());assert.equal(d.instructions.length,n);
 pass(`${mode} terminates the client without fetching remaining signatures`);
}
{
 const journal=w.emptyJournal();w.reservePayment(journal,initial(),'boundary-original',1);
 w.transitionPayment(journal,'boundary-original','signing');
 journal.payments[0].signingAttempt={id:'11111111-1111-4111-8111-111111111111',recovery:false};
 const parsed=w.importWalletBackup(w.exportWalletBackup(account,journal));
 assert.equal(parsed.journal.payments[0].state,'signing');
 assert.equal(parsed.journal.payments[0].signingAttempt,undefined);
 assert.throws(()=>w.resetUnsignedAttempt(parsed.journal,'boundary-original','11111111-1111-4111-8111-111111111111'));
 assert.throws(()=>w.discardDraft(parsed.journal,'boundary-original'));
 assert.equal(w.reservedOutpoints(parsed.journal).size,2);
 pass('Uncertain backup cannot restore rejection ownership or release reservations');
}
{
 const journal=w.emptyJournal();w.reservePayment(journal,initial(),'boundary-original',1);
 w.transitionPayment(journal,'boundary-original','signing');
 w.transitionPayment(journal,'boundary-original','signed',{rawTx:f.rawTx,txid:f.txid});
 w.transitionPayment(journal,'boundary-original','broadcast-unknown');
 w.transitionPayment(journal,'boundary-original','accepted');
 w.reconcileConfirmed(journal,[{txid:f.txid,state:'confirmed',received:0n,spent:0n,block:{height:1,hash:'ab'.repeat(32)}}],{height:6,hash:'cd'.repeat(32)},100);
 assert(journal.payments[0].archived);
 const restored=w.importWalletBackup(w.exportWalletBackup(account,journal));
 assert.equal(restored.journal.payments[0].archived,undefined);
 assert.equal(restored.journal.payments[0].rawTx,f.rawTx);
 assert.equal(w.reservedOutpoints(restored.journal).size,2);
 for(const mutate of [p=>p.rawTx+='00',p=>p.txid='00'.repeat(32),p=>p.outpoints.reverse()]){
  const backup=JSON.parse(w.exportWalletBackup(account,journal));mutate(backup.journal.payments[0]);assert.throws(()=>w.importWalletBackup(JSON.stringify(backup)));
 }
 pass('Signed backup strips stale archive authority; byte, txid and reservation mutations reject');
}
console.log(`${count} independent offline boundary checks passed`);
