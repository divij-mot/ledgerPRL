/** Offline composition review. Actual main handlers/SDK/wallet/PSBT adapter;
 * mocked DOM, atomic storage, backup-worker boundary and node replies only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { build } from 'esbuild';
import * as sdk from '../../packages/sdk/src/index.ts';
import * as wallet from '../../packages/wallet/src/index.ts';
import { createPsbtEndpoint } from '../../apps/companion/test/psbt-endpoint.mjs';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = process.env.PRL_SEQUENCE_OUTPUT ?? path.join(root, 'tools/payment-sequence-review/results.json');
const f = JSON.parse(fs.readFileSync(path.join(root, 'fixtures/protocol-v1.json'), 'utf8'));
const alt = JSON.parse(fs.readFileSync(path.join(root, 'apps/companion/test/fixtures/signing-recovery-alternate.json'), 'utf8'));
const a = sdk.accountFromJson(f.publicAccount), b = sdk.bundleFromJson(f.bundle), owner = wallet.accountId(a);
const sourcePaths = [
  ...['packages/sdk/src', 'packages/wallet/src', 'packages/bitcoin-prl-adapter/src'].flatMap(d => fs.readdirSync(path.join(root,d),{recursive:true}).filter(p=>String(p).endsWith('.ts')).map(p=>`${d}/${p}`)),
  'apps/companion/src/main.ts','apps/companion/src/signed-recovery.ts','apps/companion/src/storage.ts',
  'apps/companion/src/backup-import.ts','apps/companion/src/backup-import.worker.ts',
  'apps/companion/test/psbt-endpoint.mjs','fixtures/protocol-v1.json',
  'apps/companion/test/fixtures/psbt-apdu-public.json','apps/companion/test/fixtures/signing-recovery-alternate.json',
  'packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json','package-lock.json',
];
const hashes = () => Object.fromEntries(sourcePaths.map(p=>[p,createHash('sha256').update(fs.readFileSync(path.join(root,p))).digest('hex')]));
const beforeHashes=hashes(), startedAt=new Date().toISOString(), results=[];
Error.stackTraceLimit=4;
let model, serial=0, app, dom, elements, events;
const tick=()=>new Promise(r=>setImmediate(r));
const clone=v=>structuredClone(v);
function endpoint(mode='ok', alternate=false) {
  const e=createPsbtEndpoint({signatures:(alternate?alt:f).signatures,onStage:async(stage,index)=>{
    if(mode==='review-rejected'&&stage==='review')return Uint8Array.of(0x69,0x85);
    if(mode==='before-first-yield'&&stage==='signature'&&index===0)throw Error('Injected disconnect before first signature');
    if(mode==='after-first-yield'&&stage==='signature'&&index===1)throw Error('Injected disconnect after first signature');
    if(mode==='cancel-after-first-yield'&&stage==='signature'&&index===1){events.get('cancel-device:click')();assert.equal(e.activeSignal?.aborted,true,'Cancel must abort the real adapter exchange signal');model.signCancelObserved++;e.activeSignal.throwIfAborted();assert.fail('Aborted signing signal did not throw')}
    if(mode==='ack-lost'&&stage==='ack')throw Error('Injected final ACK loss');
    if(mode==='receive-rejected'&&stage==='address')return Uint8Array.of(0x69,0x85);
  }});
  const exchange=e.transport.exchange.bind(e.transport);
  e.transport.exchange=async(apdu,signal)=>{e.activeSignal=signal;return exchange(apdu,signal)};
  model.endpoints.push(e);return e.transport;
}
function reset() {
  model={rows:new Map(),endpoints:[],requests:[],broadcastMode:'accept',archiveMode:'confirmed',signedWriteFailure:false,commits:0,imports:0,tail:Promise.resolve(),signCancelObserved:0,broadcastCancelObserved:0};
  globalThis.__sequenceModel=model;
  globalThis.__sequenceValidate=wallet.validateStoredJournal;
  globalThis.__sequenceImport=text=>{model.imports++;return wallet.importWalletBackup(text)};
}
function saved(){return clone(model.rows.get(owner)??wallet.emptyJournal())}
function payment(){return saved().payments[0]}
function snapshot(){return {schema:1,account:a,genesisHash:sdk.NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...clone(i),rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))}}
function fakeDom(){
  dom={innerHTML:''};elements=new Map();events=new Map();
  globalThis.document={querySelector:()=>dom,querySelectorAll:()=>[],getElementById:id=>{
    // This intentionally models controls and event registration, not browser layout.
    let el=elements.get(id);if(!el){el={checked:false,disabled:false,addEventListener:(kind,fn)=>events.set(`${id}:${kind}`,fn)};elements.set(id,el)}return el;
  },createElement:()=>({click(){}})};
  globalThis.window={addEventListener(){}};
  globalThis.BroadcastChannel=class{postMessage(){}};
}
globalThis.fetch=async(route,options)=>{
  assert(['/api/check','/api/broadcast','/api/reconcile'].includes(route),`Unexpected network destination: ${route}`);
  assert.equal(options.credentials,'omit');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');
  const request=JSON.parse(options.body);model.requests.push({route,request:clone(request)});
  if(route==='/api/check')return Response.json({network:a.network,genesisHash:sdk.NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},checkedAt:Date.now(),coins:request.coins.map(c=>{
    const i=b.inputs.find(i=>wallet.outpoint(i)===wallet.outpoint(c));assert(i);
    return {outpoint:wallet.outpoint(i),state:'unspent',grains:i.amount.toString(),scriptPubKey:sdk.hex(i.scriptPubKey),block:{height:1,hash:'bb'.repeat(32)},coinbase:false,confirmations:200};
  })});
  if(route==='/api/broadcast'){
    assert.equal(payment().state,'broadcast-unknown','Uncertainty must be durable before submission');
    assert.equal(request.rawTx,payment().rawTx);assert.equal(request.expectedTxid,f.txid);assert.equal(request.bundleHex,f.bundleHex);
    if(model.broadcastMode==='timeout')throw Error('Injected timeout after submission');
    if(model.broadcastMode==='cancel'){events.get('cancel-device:click')();assert.equal(options.signal.aborted,true,'Cancel must abort the real submitted fetch signal');model.broadcastCancelObserved++;options.signal.throwIfAborted();assert.fail('Aborted broadcast signal did not throw')}
    if(model.broadcastMode==='wrong-txid')return Response.json({txid:'00'.repeat(32)});
    if(model.broadcastMode==='http-error')return Response.json({error:'Already known; no successful receipt'}, {status:503});
    return Response.json({txid:f.txid});
  }
  const block={height:195,hash:'cc'.repeat(32)}, tip={height:200,hash:'aa'.repeat(32)};
  const state=model.archiveMode;
  return Response.json({network:a.network,genesisHash:sdk.NETWORKS[a.network].genesisHash,tip,checkedAt:Date.now(),rpcCalls:10,
    transactions:request.payments.map(p=>state==='confirmed'?{txid:p.expectedTxid,state:'confirmed',block,confirmations:6}:{txid:p.expectedTxid,state:state==='detached'?'detached':'unknown'}),
    checkpoints:request.checkpoints.map(c=>state==='confirmed'?{...c,state:'confirmed',confirmations:6}:{...c,state:state==='detached'?'detached':'unknown'})});
};
const contents=fs.readFileSync(path.join(root,'apps/companion/src/main.ts'),'utf8')+`
export async function sequenceOpen(a,s,t){account=a;network=a.network;accountIndex=a.account;sourceMode='node';snapshot=s;client=t?new LedgerBitcoinPrlClient(t,a.network):null;transport=t;activePayment=null;await refreshJournal();activePayment=journal.payments[0]?.id??null;page='send';render();}
export function sequenceForm(b){selected.clear();b.inputs.forEach(i=>selected.add(outpoint(i)));form.recipient=scriptToAddress(b.outputs[0].scriptPubKey,b.network);form.amount=formatPrl(b.outputs[0].amount);form.fee=formatPrl(b.inputs.reduce((s,i)=>s+i.amount,0n)-b.outputs.reduce((s,o)=>s+o.amount,0n));form.changeIndex=String(b.outputs.find(o=>o.role==='change')?.index??journal.nextChangeIndex);render();}
export async function sequenceDevice(t){client=new LedgerBitcoinPrlClient(t,network);transport=t;render();}
export function sequenceState(){return{busy,notification,notificationType,emergencySignedRecovery,verifiedReceive,validation,snapshot,activePayment,journal};}
export function sequenceReceive(index){page='receive';receiveIndex=index;render();}
export async function sequenceSelect(){await refreshJournal();activePayment=journal.payments[0]?.id??null;page='send';render();}
export async function sequenceRefresh(){await refreshJournal();render();}
`;
const compiled=await build({stdin:{contents,resolveDir:path.join(root,'apps/companion/src'),loader:'ts'},bundle:true,write:false,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'offline-boundaries',setup(build){
  build.onResolve({filter:/^\.\/(ledger\.js|storage\.js|styles\.css|backup-import\.js)$/},a=>({path:a.path,namespace:'sequence'}));
  build.onLoad({filter:/.*/,namespace:'sequence'},a=>({loader:'js',contents:a.path.includes('ledger')?'export async function connectLedger(){throw Error("No physical device permitted")}':a.path.includes('storage')?`
    export class WatchStorage {constructor(){this.model=globalThis.__sequenceModel} async journal(k){await this.model.tail;return globalThis.__sequenceValidate(structuredClone(this.model.rows.get(k)??{schema:1,nextChangeIndex:0,issuedReceiveThrough:-1,payments:[]}))} async mutate(k,fn){const pending=this.model.tail;let release;this.model.tail=new Promise(r=>release=r);await pending;try{const j=globalThis.__sequenceValidate(structuredClone(this.model.rows.get(k)??{schema:1,nextChangeIndex:0,issuedReceiveThrough:-1,payments:[]}));const result=fn(j);globalThis.__sequenceValidate(j);if(this.model.signedWriteFailure&&j.payments.some(p=>p.state==='signed')){this.model.signedWriteFailure=false;throw Error('Injected signed storage failure')}this.model.rows.set(k,structuredClone(j));this.model.commits++;return result}finally{release()}}}
  `:a.path.includes('backup-import')?'export async function importWalletBackupFile(blob,signal){signal.throwIfAborted();return globalThis.__sequenceImport(await blob.text())}':''}));
}}]});
const sourceUrl='data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64');
async function open(t=null){fakeDom();app=await import(sourceUrl+'#'+(++serial));await app.sequenceOpen(clone(a),snapshot(),t);return app}
async function event(id,kind='click',payload={}){
  const handler=events.get(`${id}:${kind}`);assert(handler,`Missing handler ${id}:${kind}`);handler(payload);
  for(let n=0;app.sequenceState().busy&&n<5000;n++)await tick();assert.equal(app.sequenceState().busy,false,`Operation did not settle: ${id}`);
}
async function importBackup(text){await event('backup-file','change',{target:{files:[new Blob([text],{type:'application/json'})]}});await app.sequenceSelect()}
const exportBackup=()=>wallet.exportWalletBackup(a,saved());
function stable(expectedState,raw){
  const j=saved(),p=j.payments[0];assert(p);assert.equal(j.payments.length,1);assert.equal(p.id,model.identity.id);assert.equal(p.createdAt,model.identity.createdAt);assert.equal(p.state,expectedState);assert.equal(p.bundleHex,f.bundleHex);
  assert.deepEqual(p.outpoints,b.inputs.map(wallet.outpoint));assert.deepEqual(wallet.reservedOutpoints(j),new Set(b.inputs.map(wallet.outpoint)));assert.equal(j.nextChangeIndex,1);assert.equal(j.issuedReceiveThrough,7);
  assert.equal(p.rawTx,raw);assert.equal(p.txid,raw?f.txid:undefined);wallet.validateStoredJournal(clone(j));
  if(raw){const tx=sdk.parseTransaction(raw);assert.equal(sdk.finalizeTransaction(b,tx.inputs.map(i=>i.witness[0])).rawTx,raw)}
  const frozen=clone(j);assert.throws(()=>wallet.discardDraft(j,p.id));assert.deepEqual(j,frozen,'Rejected discard changed the journal');
}
function broadcastCount(){return model.requests.filter(r=>r.route==='/api/broadcast').length}
async function broadcast(mode,approved=true){model.broadcastMode=mode;elements.get('broadcast-approval').checked=approved;await event('broadcast')}
async function run(name,fn){const start=performance.now();try{await fn();results.push({name,outcome:'pass',durationMs:Math.round(performance.now()-start),requests:model.requests.length,broadcasts:broadcastCount(),deviceSessions:model.endpoints.length,imports:model.imports});console.log('PASS '+name)}catch(e){const detail=String(e.stack??e).replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,'[bundled main.ts]');results.push({name,outcome:'fail',durationMs:Math.round(performance.now()-start),detail});console.log('FAIL '+name+' '+detail)}}

await run('receive rejection -> reload -> consecutive issuance -> prepare/discard preserves both high-water marks',async()=>{
  reset();await open(endpoint());app.sequenceReceive(0);await event('verify-receive');assert.equal(app.sequenceState().verifiedReceive,sdk.deriveAddress(a,0,0).address);assert.equal(saved().issuedReceiveThrough,0);
  await app.sequenceDevice(endpoint('receive-rejected'));app.sequenceReceive(1);await event('verify-receive');assert.equal(saved().issuedReceiveThrough,1);assert.equal(app.sequenceState().verifiedReceive,null);
  const backup=exportBackup();reset();await open();await importBackup(backup);assert.equal(saved().issuedReceiveThrough,1);assert.equal(app.sequenceState().verifiedReceive,null);
  await app.sequenceOpen(clone(a),snapshot(),endpoint());app.sequenceReceive(2);await event('verify-receive');assert.equal(saved().issuedReceiveThrough,2);
  app.sequenceForm(b);await event('prepare');assert.equal(payment().bundleHex,f.bundleHex);assert.equal(saved().issuedReceiveThrough,7);await event('discard');assert.equal(saved().payments.length,0);assert.equal(saved().nextChangeIndex,1);assert.equal(saved().issuedReceiveThrough,7);
  const round=wallet.importWalletBackup(exportBackup()).journal;assert.equal(round.nextChangeIndex,1);assert.equal(round.issuedReceiveThrough,7);assert.equal(broadcastCount(),0);
});

for(const mode of ['review-rejected','before-first-yield','after-first-yield','cancel-after-first-yield','ack-lost','storage-failed','ok'])for(const alternate of [false,true]){
  await run(`${mode} -> ${alternate?'alternate':'original'} signed bytes -> timeout/retry -> reload -> archive/reorg`,async()=>{
    reset();await open(endpoint(mode==='storage-failed'?'ok':mode,alternate));app.sequenceForm(b);await event('prepare');assert.equal(payment().bundleHex,f.bundleHex);const draft=exportBackup(),id=payment().id;model.identity={id,createdAt:payment().createdAt};
    if(mode==='storage-failed')model.signedWriteFailure=true;
    await event('sign');assert.equal(broadcastCount(),0);
    const first=model.endpoints[0];assert(first.stages.some(s=>s.name==='review'),'Initial signing must reach review');
    const reached=first.stages.filter(s=>s.name==='signature').map(s=>s.index);
    assert.deepEqual(reached,mode==='review-rejected'?[]:mode==='before-first-yield'?[0]:[0,1],'Intended signature stage was not reached');
    assert.equal(first.acknowledgements(),['ack-lost','ok'].includes(mode)?1:0,'Unexpected final ACK boundary');
    assert.equal(first.stages.filter(s=>s.name==='ack').length,['ack-lost','ok'].includes(mode)?1:0);
    if(mode!=='ok')assert(first.closes()>0,'Failed attempt must close its mock transport');
    if(mode==='cancel-after-first-yield')assert.equal(model.signCancelObserved,1,'Actual signing cancellation was not observed');
    if(mode==='ack-lost')assert.match(app.sequenceState().notification,/acknowledgement was not confirmed/);
    const unsigned=['review-rejected','before-first-yield','after-first-yield','cancel-after-first-yield','storage-failed'].includes(mode);
    let exact=alternate?alt.rawTx:f.rawTx;
    if(unsigned){
      stable('signing',undefined);const uncertain=exportBackup();const emergency=app.sequenceState().emergencySignedRecovery;
      if(mode==='storage-failed'){
        assert(emergency&&!emergency.pending);assert.equal(wallet.importWalletBackup(emergency.text).journal.payments[0].rawTx,exact);
        await importBackup(emergency.text);stable('signed',exact);assert.equal(app.sequenceState().emergencySignedRecovery,null);
      }else{
        await open();await importBackup(uncertain);stable('signing',undefined);assert.equal(payment().signingAttempt,undefined);
        await app.sequenceOpen(clone(a),snapshot(),endpoint('review-rejected'));await event('recover-signing');stable('signing',undefined);
        const denied=model.endpoints.at(-1);assert(denied.stages.some(s=>s.name==='export'));assert(denied.stages.some(s=>s.name==='review'));assert.equal(denied.yields(),0);assert.equal(denied.acknowledgements(),0);assert(denied.closes()>0);
        await app.sequenceDevice(endpoint('ok',alternate));await event('recover-signing');exact=alternate?alt.rawTx:f.rawTx;stable('signed',exact);
        const recovered=model.endpoints.at(-1);assert(recovered.stages.some(s=>s.name==='export'));assert(recovered.stages.some(s=>s.name==='review'));assert.deepEqual(recovered.stages.filter(s=>s.name==='signature').map(s=>s.index),[0,1]);assert.equal(recovered.acknowledgements(),1);
      }
      await importBackup(uncertain);stable('signed',exact);
    }else stable('signed',exact);
    assert.equal(payment().id,id);assert.equal(broadcastCount(),0);await importBackup(draft);stable('signed',exact);
    await broadcast('accept',false);assert.equal(broadcastCount(),0);stable('signed',exact);
    for(const failure of ['timeout','wrong-txid','http-error','cancel']){await broadcast(failure);if(failure==='cancel')assert.equal(model.broadcastCancelObserved,1,'Actual broadcast cancellation was not observed');stable('broadcast-unknown',exact);await open();stable('broadcast-unknown',exact);await importBackup(draft);stable('broadcast-unknown',exact)}
    await broadcast('accept');stable('accepted',exact);const accepted=exportBackup();
    await broadcast('timeout');stable('broadcast-unknown',exact);await importBackup(accepted);stable('broadcast-unknown',exact);
    await broadcast('accept');stable('accepted',exact);
    model.archiveMode='confirmed';await event('reconcile');stable('accepted',exact);assert(payment().archived);const archived=exportBackup();const before=broadcastCount();await broadcast('accept');assert.equal(broadcastCount(),before,'Archived record was submitted');stable('accepted',exact);
    await open();assert(payment().archived);model.archiveMode='detached';await event('reconcile');stable('accepted',exact);assert.equal(payment().archived,undefined);
    await importBackup(archived);stable('accepted',exact);assert.equal(payment().archived,undefined,'Stale backup reasserted archival authority');
    await broadcast('timeout');stable('broadcast-unknown',exact);await importBackup(accepted);stable('broadcast-unknown',exact);await broadcast('accept');stable('accepted',exact);
    // Migration into a fresh empty profile must also strip a saved archive receipt.
    model.rows.clear();await open();await importBackup(archived);stable('accepted',exact);assert.equal(payment().archived,undefined);assert.equal(app.sequenceState().snapshot,null);assert.equal(app.sequenceState().validation,null);
    model.archiveMode='unknown';await event('reconcile');stable('accepted',exact);assert.equal(payment().archived,undefined);
    model.archiveMode='confirmed';await event('reconcile');stable('accepted',exact);assert(payment().archived);
    // Different valid witnesses for the same canonical txid are a conflict on import,
    // not permission to replace the already retained exact recovery bytes.
    const conflicting=JSON.parse(accepted);conflicting.journal.payments[0].rawTx=exact===f.rawTx?alt.rawTx:f.rawTx;
    const current=saved();await importBackup(JSON.stringify(conflicting));assert.deepEqual(saved(),current);assert.match(app.sequenceState().notification,/Conflicting signed transaction bytes/);
  });
}
const afterHashes=hashes(),sourceUnchanged=JSON.stringify(beforeHashes)===JSON.stringify(afterHashes);
const report={startedAt,finishedAt:new Date().toISOString(),node:process.version,sourceUnchanged,sourceHashes:beforeHashes,results,passed:results.filter(r=>r.outcome==='pass').length,failed:results.filter(r=>r.outcome==='fail').length,limits:['Finite host-only sequence checks; no security proof or exhaustive interleaving coverage.','Actual main.ts handlers, SDK signatures, wallet state/import/merge and PSBT adapter execute.','Storage, DOM, node replies and module-worker dispatch are mocks; no IndexedDB, browser/WebHID, physical firmware, native emulator, endpoints, credentials, funds or secret keys.','Mock snapshot starts after prior-output admission; this does not test raw prevout import or chain truth.','Frozen public signatures and existing frozen PSBT endpoint are reused; cryptography and endpoint are not independently implemented.','Reload creates a new app module over an in-memory cloned durable store; this is not power-loss durability.']};
fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
console.log(`SUMMARY ${report.passed} passed; ${report.failed} failed; sources unchanged=${sourceUnchanged}`);
if(report.failed||!sourceUnchanged)process.exitCode=1;
