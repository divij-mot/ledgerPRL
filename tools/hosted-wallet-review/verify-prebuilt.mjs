/** Verify the actual CLI output without network, cloud mutation, wallet state or hardware. */
import assert from 'node:assert/strict';
import { readFile, readdir, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { PassThrough } from 'node:stream';
import { EventEmitter } from 'node:events';
const root = fileURLToPath(new URL('../../', import.meta.url));
const output = path.join(root, '.vercel/output');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function files(directory, prefix = '') {
  const list = [];
  for (const name of await readdir(directory)) {
    const relative = prefix + name, absolute = path.join(directory,name), stat = await lstat(absolute);
    assert(!stat.isSymbolicLink(), 'Prebuilt artifact must be a regular path');
    if (stat.isDirectory()) list.push(...await files(absolute,relative+'/'));
    else { assert(stat.isFile()); list.push(relative); }
  }
  return list.sort();
}
const config = JSON.parse(await readFile(path.join(output,'config.json'),'utf8'));
assert.equal(config.version,3);
assert.deepEqual(config.crons,[]);
const global = config.routes.find(route => route.headers?.['Content-Security-Policy']);
assert(global.headers['Content-Security-Policy'].includes("connect-src 'self'"));
assert(global.headers['Content-Security-Policy'].includes("frame-ancestors 'none'"));
assert.equal(global.headers['Cache-Control'],'no-store');
assert(global.headers['Permissions-Policy'].includes('camera=(self)'));
assert(config.routes.some(route => route.status === 404 && route.src === '^/api(/.*)?$'));
assert(config.routes.some(route => route.headers?.['Cache-Control'] === 'public, max-age=31536000, immutable'));
const publicFiles = await files(path.join(output,'static'));
assert.equal(publicFiles.filter(f => !f.startsWith('assets/')).join(','),'index.html,ledger-live.hosted.manifest.json,ledger-live.mobile.manifest.json,live.html,third-party-notices.txt');
const publicHashes = {}, publicSizes = {};
for (const file of publicFiles) {
  const bytes = await readFile(path.join(output,'static',file));
  assert.deepEqual(bytes,await readFile(path.join(root,'apps/companion/dist',file)));
  publicHashes[file] = digest(bytes); publicSizes[file] = bytes.length;
}
const oldFetch = globalThis.fetch;
process.env.PEARL_WEB_ORIGIN = 'https://pearl-ledger-wallet.vercel.app';
let upstreamFixtureCalls = 0;
globalThis.fetch = async url => {
  assert.equal(url,'https://blockbook.pearlresearch.ai/api/v2/');
  upstreamFixtureCalls++;
  return Response.json({ok:true});
};
const functions = [];
try {
  for (const name of ['read','broadcast']) {
    const dir=path.join(output,`functions/api/indexer/${name}.func`);
    const fn=JSON.parse(await readFile(path.join(dir,'.vc-config.json'),'utf8'));
    assert.equal(fn.runtime,'nodejs24.x'); assert.equal(fn.maxDuration,35);
    assert.equal(fn.shouldAddHelpers,false);
    assert.equal(fn.shouldDisableAutomaticFetchInstrumentation,true);
    assert.equal(fn.supportsCancellation,true);
    assert.deepEqual(fn.environment,{});
    const list=await files(dir);
    assert.deepEqual(list,['.vc-config.json',`api/indexer/${name}.js`,`api/indexer/${name}.js.map`,'apps/companion/server/dist/indexer.mjs','package.json']);
    assert.deepEqual(await readFile(path.join(dir,'apps/companion/server/dist/indexer.mjs')),await readFile(path.join(root,'apps/companion/server/dist/indexer.mjs')));
    const handler=(await import(pathToFileURL(path.join(dir,fn.handler)).href)).default;
    assert.equal(typeof handler,'function');
    const body=JSON.stringify({network:'mainnet',consent:true,path:'/api/v2/'});
    const headers={host:'pearl-ledger-wallet.vercel.app',origin:process.env.PEARL_WEB_ORIGIN,'x-forwarded-proto':'https','x-pearl-companion':'1','content-type':'application/json','content-length':String(body.length)};
    const request=Object.assign(new PassThrough(),{method:'POST',url:'/api/indexer/read',headers,rawHeaders:Object.entries(headers).flat()});
    let status=0,text='';
    const response=Object.assign(new EventEmitter(),{destroyed:false,writableEnded:false,setHeader(){},writeHead(value){status=value;},end(value){text=value;this.writableEnded=true;}});
    const pending=handler(request,response); request.end(body); await pending;
    assert.equal(status,200); assert.deepEqual(JSON.parse(text),{ok:true});
    const hashes={}; for(const file of list)hashes[file]=digest(await readFile(path.join(dir,file)));
    functions.push({name,runtime:fn.runtime,helpers:false,automaticFetchInstrumentationDisabled:true,maxDuration:fn.maxDuration,compiledFixture:'passed',files:hashes});
  }
} finally { globalThis.fetch=oldFetch; }
assert.equal(upstreamFixtureCalls,2);
const report={schema:1,checkedAt:new Date().toISOString(),outcome:'passed',configSha256:digest(await readFile(path.join(output,'config.json'))),staticFiles:publicHashes,staticBytes:publicSizes,totalStaticBytes:Object.values(publicSizes).reduce((a,b)=>a+b,0),assetCount:publicFiles.filter(f=>f.startsWith('assets/')).length,functions,externalRequests:0,broadcasts:0};
await writeFile(new URL('./prebuilt-validation.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify({outcome:report.outcome,assetCount:report.assetCount,totalStaticBytes:report.totalStaticBytes,functions:functions.map(({files,...f})=>({...f,fileCount:Object.keys(files).length}))},null,2));
