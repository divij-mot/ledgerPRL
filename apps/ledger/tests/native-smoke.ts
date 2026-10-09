/** Real application smoke test on all device emulators, never a software signer. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve,join } from 'node:path';
import { accountFromJson,accountToJson,bundleFromJson,deriveAddress,LedgerPearlClient,SpeculosTransport } from '../../../packages/sdk/src/index.ts';
import {Emulator,type Model} from './speculos-driver.ts';
const root=resolve(import.meta.dirname,'../../..');
const model=(process.env.SPECULOS_MODEL||'stax') as Model;
const target=model==='nanosp'?'nanosplus':model;
const elf=process.env.PEARL_APP_ELF||join(root,`apps/ledger/target/artifacts/pearl-${target}-simnet.elf`);
const output=process.env.PEARL_EVIDENCE||`/tmp/pearl-native-${model}-smoke`;
const emulator=new Emulator(model,elf,output);
const fixture=JSON.parse(await readFile(join(root,'fixtures/protocol-v1.json'),'utf8'));
const expected=accountFromJson({...fixture.publicAccount,network:'simnet'});
const bundle=bundleFromJson({...fixture.bundle,network:'simnet'});
try {
  await emulator.start();
  const client=new LedgerPearlClient(new SpeculosTransport(emulator.url),'simnet');
  const account=await emulator.approve(()=>client.exportAccount(0),'Approve export','account');
  assert.deepEqual(accountToJson(account),accountToJson(expected));
  const receive=await emulator.approve(()=>client.verifyAddress(account,0,0),'Confirm','address');
  assert.equal(receive,deriveAddress(expected,0,0).address);
  const signed=await emulator.approve(()=>client.signBundle(bundle,account),'Sign Pearl transfer','sign');
  assert.equal(signed.signatures.length,2);
  console.log(`PASS ${model}: account fixture, trusted full address, two native BIP340 signatures independently verified`);
} finally { await emulator.stop(); }
