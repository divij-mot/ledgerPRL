// Actual UI reconciliation, deterministic local DOM/storage/backend boundaries.
// No browser import/upload, network, device, or external writes.
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const root=process.env.PRL_ROOT??process.cwd();
const output=process.env.PRL_REVIEW_OUTPUT??'/workspace/shared/prl-final-wallet-boundary-review';
const input=process.env.PRL_REVIEW_JOURNAL??path.join(output,'backup-ceiling-journal.json');
const {build}=createRequire(root+'/package.json')('esbuild');
const s=await import(pathToFileURL(root+'/packages/sdk/src/index.ts'));
const bridge=await import(pathToFileURL(root+'/apps/companion/src/bridge.ts'));
const original=JSON.parse(fs.readFileSync(input,'utf8'));
// Actual importer independently validated this exact file; it removes archival claims.
for(const p of original.journal.payments)delete p.archived;
const source=fs.readFileSync(process.env.PRL_RECONCILE_MAIN??root+'/apps/companion/src/main.ts','utf8');
const built=await build({stdin:{contents:source+`
export async function auditSeed(a,j){account=a;network=a.network;sourceMode='node';await store.mutate(accountId(a),saved=>Object.assign(saved,structuredClone(j)));}
export async function auditSaved(){return store.journal(accountId(account));}
export {reconcileNodePayments};
`,loader:'ts',resolveDir:root+'/apps/companion/src'},bundle:true,write:false,format:'esm',platform:'node',logLevel:'silent',plugins:[{name:'explicit-local-boundaries',setup(b){
 b.onResolve({filter:/^\.\/(device\.js|storage\.js)$/},a=>({path:a.path,namespace:'fixture'}));
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({loader:'js',contents:a.path.includes('device')?'export async function connectLedger(){throw Error("No device permitted")}' : `export class WatchStorage {constructor(){this.rows=new Map();} async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}async mutate(k,fn){const j=await this.journal(k);const r=fn(j);this.rows.set(k,structuredClone(j));globalThis.mutations++;return r;}}`}));
}}]});
globalThis.document={querySelector:()=>({innerHTML:''}),querySelectorAll:()=>[],getElementById:()=>null};
globalThis.window={addEventListener(){}};
globalThis.BroadcastChannel=class{postMessage(){}};
globalThis.mutations=0;
let requests=0,rpcCalls=0,firstRequestMs,bridgeValidationMs=0;
const known=new Map(original.journal.payments.map(p=>[p.txid,p]));
const rpc=async(method,params)=>{
 rpcCalls++;
 switch(method){
  case 'getblockchaininfo':return {chain:'regtest'};
  case 'getblockcount':return 100005;
  case 'getblockhash':return params[0]===0?s.NETWORKS.regtest.genesisHash:params[0]===100000?'ab'.repeat(32):'cd'.repeat(32);
  case 'getrawtransaction':{assert.equal(params[1],1);const p=known.get(params[0]);assert(p);return {txid:p.txid,hex:p.rawTx,confirmations:6,blockhash:'ab'.repeat(32)};}
  default:throw Error('Unexpected or mutating RPC '+method);
 }
};
globalThis.fetch=async(route,options)=>{
 requests++;if(firstRequestMs===undefined)firstRequestMs=performance.now()-start;assert.equal(route,'/api/reconcile');const payload=JSON.parse(options.body);
 // Actual bridge validation and signature checks; only authenticated RPC is a fixture.
 const bridgeStart=performance.now();
 const result=await bridge.checkKnownPayments(rpc,'regtest',payload);
 bridgeValidationMs+=performance.now()-bridgeStart;
 return new Response(JSON.stringify(result));
};
const app=await import('data:text/javascript;base64,'+Buffer.from(built.outputFiles[0].text).toString('base64'));
await app.auditSeed(s.accountFromJson(original.account),original.journal);
const startingMutations=globalThis.mutations;
const start=performance.now();let error;
try{await app.reconcileNodePayments(new AbortController().signal);}catch(e){error={name:e.name,message:e.message};}
const elapsed=performance.now()-start;
if(error){
 assert.match(error.message,/deadline|timeout|aborted/i);
 assert.deepEqual(await app.auditSaved(),original.journal);
 assert.equal(globalThis.mutations,startingMutations);
}
const after=await app.auditSaved();
if(!error){
 assert.equal(requests,20);assert.equal(rpcCalls,2180);assert.equal(globalThis.mutations-startingMutations,1);
 const stripped=structuredClone(after);for(const p of stripped.payments){assert.equal(p.archived.status,'confirmed');assert.deepEqual(p.archived.block,{height:100000,hash:'ab'.repeat(32)});delete p.archived;}
 assert.deepEqual(stripped,original.journal);
}
const result={records:2000,signatures:32000,elapsedMs:elapsed,firstRequestMs:firstRequestMs??null,bridgeValidationMs,requests,rpcCalls,journalMutations:globalThis.mutations-startingMutations,error:error??null,sourceSha256:createHash('sha256').update(source).digest('hex'),dependencySha256:Object.fromEntries(['apps/companion/src/bridge.ts','packages/sdk/src/transaction.ts','packages/sdk/src/keys.ts','packages/sdk/src/bundle.ts','packages/wallet/src/journal.ts'].map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')])),observation:error?'REPRODUCED: fixed deadline prevents reconciliation of a valid restored maximum-input journal on this host; reservations unchanged':'CONTROL: reconciliation fit within deadline on this host'};
fs.writeFileSync(path.join(output,(process.env.PRL_RECONCILE_LABEL??'reconcile-capacity')+'.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
