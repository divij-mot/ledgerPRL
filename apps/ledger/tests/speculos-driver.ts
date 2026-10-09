/** Public-test-only physical UI driver. Does not patch the firmware or bypass consent. */
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
export type Model = 'nanosp' | 'nanox' | 'stax' | 'flex' | 'apex_p';
export type ScreenEvent = {text:string,x:number,y:number,w:number,h:number};
const dimensions = {nanosp:[128,64],nanox:[128,64],stax:[400,672],flex:[480,600],apex_p:[300,400]} as const;
export const pause = (ms:number) => new Promise(r=>setTimeout(r,ms));
export class Emulator {
  child?:ChildProcess;
  readonly url:string;
  readonly screens:{label:string,text:string,events:ScreenEvent[]}[]=[];
  constructor(readonly model:Model, readonly elf:string, readonly output:string, readonly port=5031) {
    this.url=`http://127.0.0.1:${port}`;
  }
  async start() {
    await mkdir(this.output,{recursive:true});
    const log=createWriteStream(join(this.output,'speculos.log'));
    this.child=spawn(process.env.SPECULOS_BIN||'speculos',[
      '--display','headless','--model',this.model,'--api-port',String(this.port),
      '--apdu-port',String(this.port+1),'--seed','hex:000102030405060708090a0b0c0d0e0f',this.elf,
    ],{env:process.env,stdio:['ignore','pipe','pipe']});
    this.child.stdout!.pipe(log);this.child.stderr!.pipe(log);
    for(let i=0;i<100;i++) {
      if(this.child.exitCode!==null)throw new Error(`Speculos exited ${this.child.exitCode}`);
      try { await this.events();await pause(200);return; } catch { await pause(100); }
    }
    throw new Error('Speculos did not start');
  }
  async stop() {
    await writeFile(join(this.output,'screens.json'),JSON.stringify(this.screens,null,2));
    this.child?.kill('SIGTERM');
  }
  async json(path:string,data?:unknown) {
    const response=await fetch(this.url+path,{method:data===undefined?'GET':'POST',
      headers:{'content-type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),
      signal:AbortSignal.timeout(125_000)});
    assert(response.ok,`Speculos ${path} HTTP${response.status}`);return response.json();
  }
  async events():Promise<ScreenEvent[]> { return (await this.json('/events?currentscreenonly=true')).events; }
  async capture(label:string,events:ScreenEvent[]) {
    const text=events.map(e=>e.text).join(' | ');
    this.screens.push({label,text,events});
    const png=await fetch(this.url+'/screenshot');assert(png.ok);
    await writeFile(join(this.output,`${String(this.screens.length).padStart(3,'0')}-${label}.png`),Buffer.from(await png.arrayBuffer()));
    console.log(`UI ${this.model} ${label}: ${text}`);
  }
  async button(button:'left'|'right'|'both',action='press-and-release') { return this.json(`/button/${button}`,{action}); }
  async touch(event:ScreenEvent,delay=.15) {
    return this.json('/finger',{x:event.x+Math.max(5,Math.floor(event.w/2)),
      y:event.y+Math.max(5,Math.floor(event.h/2)),action:'press-and-release',delay});
  }
  async next() {
    if(this.model==='nanosp'||this.model==='nanox')return this.button('right');
    const [w,h]=dimensions[this.model];
    return this.json('/finger',{x:Math.floor(w*.85),y:Math.floor(h*.52),x2:Math.floor(w*.15),
      y2:Math.floor(h*.52),action:'press-and-release',delay:.2});
  }
  async approve<T>(operation:()=>Promise<T>,finalLabel:string,label:string):Promise<T> {
    let done=false,approved=false,prior='';
    const pending=operation().finally(()=>{done=true;});pending.catch(()=>{});
    for(let i=0;i<250&&!done;i++) {
      await pause(180);if(done)break;
      const events=await this.events();const text=events.map(e=>e.text).join(' | ');
      if(text!==prior){await this.capture(label,events);prior=text;}
      if(text.includes('app is ready')||text.includes('This app enables signing'))continue;
      const final=events.find(e=>e.text===finalLabel);
      const warning=events.find(e=>e.text==='Review anyway');
      if(this.model==='nanosp'||this.model==='nanox') {
        if(final||warning){if(final)approved=true;await this.button('both');}
        else await this.next();
      } else {
        const hold=events.find(e=>e.text.startsWith('Hold to'));
        if(final&&hold){approved=true;await this.touch(hold,2.5);}
        else if(finalLabel==='Confirm'&&final){approved=true;await this.touch(final);}
        else if(warning)await this.touch(warning);
        else await this.next();
      }
    }
    assert(done,`${label}: UI did not finish`);
    const result=await pending;
    assert(approved,`${label}: no explicit physical final approval observed`);
    return result;
  }
}
