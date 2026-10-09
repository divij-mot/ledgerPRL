/** Real secure SDK app in Speculos. Public BIP32 vector-one seed only. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdtemp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Emulator, type Model } from './emulator.ts';
import { accountFromJson, accountToJson, bundleFromJson, deriveAddress, SpeculosTransport } from '../../../packages/sdk/src/index.ts';
import { LedgerBitcoinPrlClient } from '../../../packages/bitcoin-prl-adapter/src/index.ts';
const root = resolve(import.meta.dirname, '../../..');
const model = (process.env.SPECULOS_MODEL ?? 'nanosp') as Model;
const target = model === 'nanosp' ? 'nanos2' : model;
const output = process.env.PEARL_EVIDENCE ?? await mkdtemp('/workspace/shared/prl-bitcoin-pilot-');
const elf = process.env.PEARL_APP_ELF ?? join(root, `apps/ledger-bitcoin-prl/build/${target}/bin/app.elf`);
const emulator = new Emulator(model, elf, output, Number(process.env.SPECULOS_API_PORT ?? 5121));
const fixture = JSON.parse(await readFile(join(root, 'fixtures/protocol-v1.json'),'utf8'));
const expected = accountFromJson({...fixture.publicAccount, network:'regtest'});
const bundle = bundleFromJson({...fixture.bundle, network:'regtest'});
try {
 await emulator.start();
 const client = new LedgerBitcoinPrlClient(new SpeculosTransport(emulator.url), 'regtest');
 assert.equal((await client.capabilities()).capabilityFlags,3);
 const account = await emulator.approve(()=>client.exportAccount(0),'Approve public key','account');
 assert.deepEqual(accountToJson(account),accountToJson(expected));
 const address = await emulator.approve(()=>client.verifyAddress(account,0,0),'Confirm','address');
 assert.equal(address,deriveAddress(account,0,0).address);
 const signed = await emulator.approve(()=>client.signBundle(bundle,account),'Sign transaction','sign');
 assert.equal(signed.signatures.length,2);
 await writeFile(join(output,'result.json'), JSON.stringify({status:'passed',firmware:emulator.provenance,txid:signed.txid,rawTx:Buffer.from(signed.bytes).toString('hex')},null,2));
 console.log(`PASS ${model}: tagged app-bitcoin PRL fork, full account/address/signature proof`);
} finally {await emulator.stop();}
