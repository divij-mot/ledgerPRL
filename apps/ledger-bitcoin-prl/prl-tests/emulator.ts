/** Public-seed UI automation only. No firmware patch or automatic approval flag. */
import assert from 'node:assert/strict';
import { Emulator as Base, pause } from '../../ledger/tests/speculos-driver.ts';
export { type Model, pause } from '../../ledger/tests/speculos-driver.ts';
export class Emulator extends Base {
 override async approve<T>(operation:()=>Promise<T>,finalLabel:string,label:string):Promise<T> {
  let done=false, approved=false, prior='';
  const pending=operation().finally(()=>{done=true}); pending.catch(()=>{});
  const normalize=(s:string)=>s.replace(/\s+/g,' ').trim();
  for(let i=0;i<350&&!done;i++) {
   await pause(160); if(done)break;
   const events=await this.events(), text=events.map(e=>e.text).join(' | ');
   if(text!==prior){await this.capture(label,events);prior=text;}
   if(text.includes('app is ready')||text.includes('This app enables signing'))continue;
   const final=events.find(e=>normalize(e.text).startsWith(finalLabel));
   const warning=events.find(e=>e.text==='Review anyway');
   if(this.model==='nanosp'||this.model==='nanox') {
    if(final||warning){if(final)approved=true;await this.button('both')}else await this.next();
   } else {
    const hold=events.find(e=>e.text.startsWith('Hold to'));
    if(final&&hold){approved=true;await this.touch(hold,2.5)}
    else if(final&&(finalLabel==='Confirm'||finalLabel==='Approve public key')){approved=true;await this.touch(events.find(e=>e.text==='Approve')??final)}
    else if(warning)await this.touch(warning);
    else await this.next();
   }
  }
  assert(done,`${label}: UI did not finish`);
  const result=await pending;assert(approved,`${label}: explicit approval was not observed`);return result;
 }
}
