/** Compare only public static assets; never fetch an account, address or valid broadcast. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const origin=process.argv[2];
assert.equal(new URL(origin).origin,origin); assert(origin.startsWith('https://'));
const checkpoint=JSON.parse(await readFile(new URL('./prebuilt-validation.json',import.meta.url),'utf8'));
const checks=JSON.parse(await readFile(new URL('./preview-results.json',import.meta.url),'utf8'));
assert.equal(checks.origin,origin); assert.equal(checks.outcome,'passed');
const result=[];
const remaining=[];
for(const [file,expectedSha256] of Object.entries(checkpoint.staticFiles)) {
 const target=file==='index.html'?'/':`/${file}`;
 const previous=checks.results.find(r=>r.target===target && r.status===200 && r.bytes>0);
 if(previous) {
   assert.equal(previous.bodySha256,expectedSha256,file);
   result.push({file,target,sha256:previous.bodySha256,bytes:previous.bytes,match:true,reusedImmediateLiveCheck:true,cacheControl:previous.headers['cache-control']});
 } else remaining.push({file,target,expectedSha256});
}
async function readBounded(response) {
 assert(response.body); const reader=response.body.getReader(); const chunks=[]; let size=0;
 try {
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=8*1024*1024);chunks.push(value);}
 } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks,size);
}
let cursor=0;
async function worker(){
 while(cursor<remaining.length){
  const {file,target,expectedSha256}=remaining[cursor++];
  const response=await fetch(origin+target,{redirect:'manual',signal:AbortSignal.timeout(30_000)});
  assert.equal(response.status,200,file);
  const bytes=await readBounded(response),sha256=createHash('sha256').update(bytes).digest('hex');
  assert.equal(sha256,expectedSha256,file);
  result.push({file,target,sha256,bytes:bytes.length,match:true,reusedImmediateLiveCheck:false,cacheControl:response.headers.get('cache-control'),contentEncoding:response.headers.get('content-encoding')});
 }
}
await Promise.all([worker(),worker(),worker()]);
result.sort((a,b)=>a.file.localeCompare(b.file));
assert.equal(result.length,Object.keys(checkpoint.staticFiles).length);
await writeFile(new URL('./deployed-byte-comparison.json',import.meta.url),JSON.stringify({origin,checkedAt:new Date().toISOString(),outcome:'passed',comparedFiles:result.length,newRequests:remaining.length,totalMatchedBytes:result.reduce((sum,r)=>sum+r.bytes,0),results:result},null,2)+'\n');
console.log(`All ${result.length} deployed public files exactly match the prebuilt checkpoint (${result.reduce((sum,r)=>sum+r.bytes,0)} bytes).`);
