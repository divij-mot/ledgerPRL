/** Native fail-closed tests. Public seed only; no physical device or real chain. */
import assert from 'node:assert/strict';
import net from 'node:net';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {bundleFromJson,command,concat,encodeBundle,sha256,u16} from '../../../packages/sdk/src/index.ts';
import {Emulator,pause,type Model} from './speculos-driver.ts';
const root=resolve(import.meta.dirname,'../../..');
const model=(process.env.SPECULOS_MODEL||'nanosp') as Model;
const target=model==='nanosp'?'nanosplus':model;
const output=process.env.PEARL_EVIDENCE||`/tmp/pearl-native-${model}-faults`;
const elf=join(root,`apps/ledger/target/artifacts/pearl-${target}-simnet.elf`);
const fixture=JSON.parse(await readFile(join(root,'fixtures/protocol-v1.json'),'utf8'));
const payload=encodeBundle(bundleFromJson({...fixture.bundle,network:'simnet'}));
class Wire {
  socket:net.Socket;
  buffer=Buffer.alloc(0);
  responses:Buffer[]=[];
  pending:{resolve:(b:Buffer)=>void,reject:(e:Error)=>void,timer:NodeJS.Timeout}[]=[];
  closed=false;
  constructor(port:number) {
    this.socket=net.createConnection(port,'127.0.0.1');
    this.socket.on('data',chunk=>{
      this.buffer=Buffer.concat([this.buffer,chunk]);
      while(this.buffer.length>=4) {
        const length=this.buffer.readUInt32BE()+2;
        assert(length<=4096);
        if(this.buffer.length<length+4)break;
        const response=Buffer.from(this.buffer.subarray(4,4+length));
        this.buffer=this.buffer.subarray(4+length);this.responses.push(response);
        const pending=this.pending.shift();if(pending){clearTimeout(pending.timer);pending.resolve(response);}
      }
    });
    const close=(e:Error)=>{this.closed=true;for(const p of this.pending.splice(0)){clearTimeout(p.timer);p.reject(e);}};
    this.socket.on('error',close);this.socket.on('close',()=>close(new Error('Native app transport closed')));
  }
  async ready(){if(this.socket.connecting)await new Promise<void>((r,j)=>{this.socket.once('connect',r);this.socket.once('error',j);});}
  send(data:Uint8Array){const header=Buffer.alloc(4);header.writeUInt32BE(data.length);this.socket.write(Buffer.concat([header,data]));}
  exchange(data:Uint8Array):Promise<Buffer>{
    return new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>reject(new Error('APDU response timeout')),10_000);
      this.pending.push({resolve,reject,timer});this.send(data);
    });
  }
  stop(){this.socket.destroy();}
}
const status=(data:Uint8Array)=>Buffer.from(data).subarray(-2).toString('hex');
async function ok(w:Wire,apdu:Uint8Array){const r=await w.exchange(apdu);assert.equal(status(r),'9000');return r;}
async function upload(w:Wire){
  await ok(w,command(0x10,concat(u16(payload.length),sha256(payload))));
  for(let offset=0;offset<payload.length;offset+=253)await ok(w,command(0x11,concat(u16(offset),payload.slice(offset,offset+253))));
}
async function reachFinal(e:Emulator,w:Wire){
  w.send(command(0x12));
  for(let i=0;i<100;i++){
    await pause(150);const events=await e.events();
    if(events.some(x=>x.text==='Sign Pearl transfer')){await e.capture('final-before-fault',events);return;}
    if(!events.some(x=>x.text==='app is ready'||x.text==='This app enables signing'))await e.next();
  }
  throw new Error('Review never reached final approval');
}
async function stopped(e:Emulator,w:Wire,start:number){
  for(let i=0;i<50&&e.child!.exitCode===null;i++)await pause(50);
  assert.notEqual(e.child!.exitCode,null,'Fault did not tear down native app');
  assert(w.responses.slice(start).every(r=>status(r)!=='9000'),'Successful response after pre-approval fault');
}
const results:{name:string,status:string,detail?:unknown}[]=[];
async function test(name:string,fn:(e:Emulator,w:Wire)=>Promise<void>){
  const e=new Emulator(model,elf,join(output,name),5041);let w:Wire|undefined;
  const entry={name,status:'running',detail:undefined as unknown};results.push(entry);console.log('RUN',model,name);
  try{await e.start();w=new Wire(e.port+1);await w.ready();await fn(e,w);entry.status='passed';console.log('PASS',model,name);}
  catch(error){entry.status='failed';entry.detail=String(error);throw error;}
  finally{w?.stop();await e.stop();await mkdir(output,{recursive:true});await writeFile(join(output,'evidence.json'),JSON.stringify(results,null,2));await pause(150);}
}
await test('strict-short-apdu',async(e,w)=>{
  for(const malformed of ['e0000000','e0000000000000','e00000000000'])assert.equal(status(await w.exchange(Buffer.from(malformed,'hex'))),'6700');
  await ok(w,command(0));
});
await test('interleaved-account-wipes-transfer',async(e,w)=>{
  await ok(w,command(0x10,concat(u16(payload.length),sha256(payload))));
  assert.equal(status(await w.exchange(command(0x01,Buffer.alloc(4)))),'6986');
  assert.equal(status(await w.exchange(command(0x11,concat(u16(0),payload.slice(0,20))))),'6986');
});
for(const [name,intruder] of [
 ['nested-apdu-at-approval',command(0)],
 ['malformed-apdu-at-approval',Buffer.from('e0000000','hex')],
 ['extended-apdu-at-approval',Buffer.from('e0000000000000','hex')],
] as const){
 await test(name,async(e,w)=>{
  await upload(w);const start=w.responses.length;await reachFinal(e,w);
  // No physical approval has occurred. Inject fault before attempting consent.
  w.send(intruder);await pause(80);
  try{if(model==='nanosp'||model==='nanox')await e.button('both');else {
    const hold=(await e.events()).find(x=>x.text.startsWith('Hold to'));if(hold)await e.touch(hold,2.5);
  }}catch{}
  await stopped(e,w,start);
 });
}
await test('usb-power-loss-at-approval',async(e,w)=>{
  await upload(w);const start=w.responses.length;await reachFinal(e,w);
  // Speculos documented RAW! path injects a real SEPH status event, not APDU data.
  // Tag 0x15 is STATUS_EVENT; zero flags means USB is no longer powered.
  w.send(Buffer.from([0x52,0x41,0x57,0x21,0x15,0,0,0,0]));
  await stopped(e,w,start);
});
await test('timeout-during-review',async(e,w)=>{
  await upload(w);const start=w.responses.length;await reachFinal(e,w);
  await e.json('/ticker/',{action:'pause'});
  // Advance the real SDK ticker; no shortened test-only firmware timeout.
  let steps=0;for(;steps<1201&&e.child!.exitCode===null;steps++){
    try{await e.json('/ticker/',{action:'single-step'});}catch{break;}
  }
  assert(steps>1000,'Timeout fired much earlier than 1200 native ticks');
  await stopped(e,w,start);
});
console.log(`PASS ${model}: ${results.length} real native transport/review fault scenarios`);
