/** Offline verification of retained public-test signatures; no device, node or signing. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
const {values}=parseArgs({options:{source:{type:'string'},evidence:{type:'string'},'oracle-output':{type:'string'}}});
const source=resolve(values.source||join(import.meta.dirname,'../..'));
const evidence=resolve(values.evidence||import.meta.dirname);
const sourceHashes=JSON.parse(await readFile(join(evidence,'test-source-map.json'),'utf8'));
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
for(const [rel,expected] of Object.entries(sourceHashes)) {
 if(!rel.startsWith('packages/sdk/src/')) continue;
 assert.equal(sha(await readFile(join(source,rel))),expected,`Source changed: ${rel}`);
}
const sdk=await import(pathToFileURL(join(source,'packages/sdk/src/index.ts')).href);
const rows=[];
for(const model of ['nanosp','nanox','stax','flex','apex_p']) {
 for(const suite of ['node-16','node-parity']) {
  const label=`${model}-${suite}`;
  const original=JSON.parse(await readFile(join(evidence,'runtime',label+'.json'),'utf8'));
  const directory=join(evidence,'transactions',label);
  const accountJson=JSON.parse(await readFile(join(directory,'account-public.json'),'utf8'));
  const account=sdk.accountFromJson(accountJson);
  const bundleHex=(await readFile(join(directory,'bundle.hex'),'utf8')).trim();
  const raw=(await readFile(join(directory,'signed-transaction.hex'),'utf8')).trim();
  const bundle=sdk.decodeBundle(sdk.fromHex(bundleHex));
  const totals=sdk.validateBundle(bundle,account);
  const signatures=original.transaction.signatures.map((s:string)=>sdk.fromHex(s));
  const signed=sdk.finalizeTransaction(bundle,signatures);
  assert.equal(bundle.network,'simnet');
  assert.equal(bundle.inputs.length,suite==='node-16'?16:4);
  assert.equal(signed.rawTx,raw);
  assert.equal(signed.txid,original.transaction.txid);
  assert.equal(signed.wtxid,original.transaction.wtxid);
  assert.equal(signed.vsize,original.transaction.vsize);
  assert.equal(totals.fee.toString(),original.transaction.feeGrains);
  assert.equal(bundle.outputs[0].amount.toString(),original.transaction.amountGrains);
  const addresses={input:sdk.deriveAddress(account,bundle.inputs[0].branch,bundle.inputs[0].index).address};
  if(values['oracle-output']) {
   await mkdir(values['oracle-output'],{recursive:true});
   const fixture={publicAccount:accountJson,bundle:sdk.bundleToJson(bundle),sighashes:bundle.inputs.map((_:unknown,i:number)=>sdk.hex(sdk.computeSighash(bundle,i))),signatures:original.transaction.signatures,rawTx:raw,txid:signed.txid,wtxid:signed.wtxid,addresses};
   await writeFile(join(values['oracle-output'],label+'.json'),JSON.stringify(fixture,null,2)+'\n',{flag:'wx'});
  }
  rows.push({model,suite,signatures:signatures.length,txid:signed.txid,wtxid:signed.wtxid,status:'passed'});
 }
}
assert.equal(rows.reduce((n,r)=>n+r.signatures,0),100);
console.log(JSON.stringify({scope:'Offline independent recheck using frozen SDK and retained emulated-device signatures; does not repeat node acceptance or hardware review',status:'passed',transactions:10,signatures:100,rows},null,2));
