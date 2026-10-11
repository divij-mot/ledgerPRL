import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createLightRuntime} from '../../apps/companion/src/light-runtime.ts';
import {publicAccount} from '../../packages/wallet/test/fixtures.ts';
import {LocalWatchSource,localStatus} from '../../apps/companion/src/local-source.ts';
import {discoverAccount} from '../../packages/wallet/src/index.ts';
const root=fileURLToPath(new URL('../../',import.meta.url));
const manifest=JSON.parse(await fs.readFile(root+'/.tools/light-client/manifest.json','utf8'));
const runtime=createLightRuntime({dataRoot:'/private/tmp/pearl-full-sync-Goqeij/state',executable:manifest.executable,executableSha256:manifest.executableSha256});
const account={...publicAccount,network:'mainnet' as const};
const results:any={executableSha256:manifest.executableSha256,sourceCommit:manifest.sourceCommit,broadcast:false};
async function ready(label:string){
 const end=Date.now()+180000;
 for(;;){
  const s=localStatus(await runtime.request('status',{}),account);
  if(s.ready){console.log(JSON.stringify({label,ready:true,tip:s.tip,coverage:s.registeredThrough}));return s;}
  assert(Date.now()<end,'Resume did not become ready within three minutes');
  await new Promise(r=>setTimeout(r,1000));
 }
}
async function discover(minimumIndex:[number,number]){
 const data=await runtime.request('snapshot',{});
 return discoverAccount(new LocalWatchSource(account,data,(m,p)=>runtime.request(m,p)),account,{minimumIndex});
}
try{
 await runtime.start(account,[-1,-1]);
 results.initial=await ready('resume');
 results.resume=(await discover([-1,-1])).complete;
 const cancel=new AbortController();
 const request=runtime.request('status',{},cancel.signal);cancel.abort();
 await assert.rejects(request);
 await new Promise(r=>setTimeout(r,100));
 assert(localStatus(await runtime.request('status',{}),account).ready);
 results.readCancellationPreservedSync=true;
 const extension:any=await runtime.request('register',{minimumIndex:[0,-1]});
 assert.equal(extension.ready,false);assert.equal(extension.restartRequired,true);
 await runtime.stop();
 await runtime.start(account,[0,-1]);
 results.afterExtension=await ready('historical rescan');
 const recovered=await discover([0,-1]);
 assert.equal(recovered.snapshot.coverage.externalScannedThrough,20);
 results.discovery={complete:recovered.complete,coverage:recovered.snapshot.coverage,coins:recovered.snapshot.coins.length,history:recovered.history.length};
 await runtime.stop();
 await runtime.start(account,[0,-1]);
 results.afterRestart=await ready('persisted recovery');
 results.ok=true;
 await fs.writeFile('/private/tmp/pearl-full-sync-Goqeij/resume-result.json',JSON.stringify(results,null,2),{mode:0o600});
 console.log(JSON.stringify({ok:true,discovery:results.discovery,readCancellationPreservedSync:true,broadcast:false}));
}finally{await runtime.stop();}
