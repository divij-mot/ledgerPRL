/** Warning UX tests against the real native app with public test fixtures only. */
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {accountFromJson,bundleFromJson,deriveAddress,LedgerPearlClient,SpeculosTransport,type SigningBundle} from '../../../packages/sdk/src/index.ts';
import {Emulator,type Model} from './speculos-driver.ts';
const root=resolve(import.meta.dirname,'../../..');
const model=(process.env.SPECULOS_MODEL||'nanosp') as Model;
const target=model==='nanosp'?'nanosplus':model;
const e=new Emulator(model,join(root,`apps/ledger/target/artifacts/pearl-${target}-simnet.elf`),process.env.PEARL_EVIDENCE||`/tmp/pearl-native-${model}-warnings`,5051);
const fixture=JSON.parse(await readFile(join(root,'fixtures/protocol-v1.json'),'utf8'));
const account=accountFromJson({...fixture.publicAccount,network:'simnet'});
function normal():SigningBundle {return bundleFromJson({...fixture.bundle,network:'simnet'});}
try {
 await e.start();
 const client=new LedgerPearlClient(new SpeculosTransport(e.url),'simnet');
 await e.approve(()=>client.exportAccount(101),'Approve export','unusual-account');
 assert(e.screens.some(s=>s.label==='unusual-account'&&s.text.includes('Unusual account')));
 await e.approve(()=>client.verifyAddress(account,0,50_001),'Confirm','unusual-address');
 assert(e.screens.some(s=>s.label==='unusual-address'&&s.text.includes('Unusual address')));
 const highFee=normal();
 highFee.inputs=[{...highFee.inputs[0]!,amount:1_000_000n}];
 highFee.outputs=[{...highFee.outputs[0]!,amount:800_000n}];
 await e.approve(()=>client.signBundle(highFee,account),'Sign Pearl transfer','high-fee');
 assert(e.screens.some(s=>s.label==='high-fee'&&s.text.includes('High transaction fee')));
 const recovery=normal();
 recovery.inputs[0]={...recovery.inputs[0]!,index:50_001,scriptPubKey:deriveAddress(account,0,50_001).scriptPubKey};
 recovery.outputs[1]={...recovery.outputs[1]!,index:50_001,scriptPubKey:deriveAddress(account,1,50_001).scriptPubKey};
 await e.approve(()=>client.signBundle(recovery,account),'Sign Pearl transfer','unusual-sign-paths');
 assert(e.screens.some(s=>s.label==='unusual-sign-paths'&&s.text.includes('Unusual input')));
 assert(e.screens.some(s=>s.label==='unusual-sign-paths'&&s.text.includes('Unusual change')));
 console.log(`PASS ${model}: account/address/input/change recovery-path and high-fee warnings require extra approval`);
}finally{await e.stop();}
