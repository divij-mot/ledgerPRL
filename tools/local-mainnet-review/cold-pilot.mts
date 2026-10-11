import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createLightRuntime} from '../../apps/companion/src/light-runtime.ts';
import {publicAccount} from '../../packages/wallet/test/fixtures.ts';
import {LocalWatchSource} from '../../apps/companion/src/local-source.ts';
import {discoverAccount} from '../../packages/wallet/src/index.ts';
const parent=await fs.mkdtemp('/private/tmp/pearl-full-sync-');
await fs.chmod(parent,0o700);
const executable=fileURLToPath(new URL('../../apps/light-client/bin/pearl-watch',import.meta.url));
const executableSha256=createHash('sha256').update(await fs.readFile(executable)).digest('hex');
const runtime=createLightRuntime({dataRoot:parent+'/state',executable,executableSha256});
const account={...publicAccount,network:'mainnet' as const};
console.log(JSON.stringify({event:'start',directory:parent,executableSha256,fixture:'publicAccount',broadcast:false}));
const deadline=Date.now()+4*60*60*1000;
let previous='';
try {
 await runtime.start(account,[-1,-1]);
 while(Date.now()<deadline){
  const status:any=await runtime.request('status',{});
  const compact={headers:status.headerHeight,filters:status.filterHeight,wallet:status.tip.height,peers:status.connections,ready:status.ready};
  const text=JSON.stringify(compact);
  if(text!==previous){console.log(text); previous=text; await fs.writeFile(parent+'/progress.json',JSON.stringify(status,null,2),{mode:0o600});}
  if(status.ready){
    const snapshot=await runtime.request('snapshot',{});
    const source=new LocalWatchSource(account,snapshot,(method,params)=>runtime.request(method,params));
    const discovery=await discoverAccount(source,account);
    const result={ok:true,tip:discovery.sourceTip,coins:discovery.snapshot.coins.length,history:discovery.history.length,coverage:discovery.snapshot.coverage,executableSha256,broadcast:false};
    await fs.writeFile(parent+'/result.json',JSON.stringify(result,null,2),{mode:0o600});console.log(JSON.stringify(result));break;
  }
  await new Promise(r=>setTimeout(r,5000));
 }
 if(Date.now()>=deadline) throw Error('Initial local sync did not complete within four hours');
}finally{await runtime.stop();}
