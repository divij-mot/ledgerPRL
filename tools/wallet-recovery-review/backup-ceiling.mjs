// PUBLIC BIP32 TEST VECTOR ONLY. Offline, deterministic, no device or network.
// Generates valid 16-input signed records via the actual wallet state machine.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const root = process.env.PRL_ROOT ?? process.cwd();
const output = process.env.PRL_REVIEW_OUTPUT ?? path.join(os.tmpdir(), 'prl-final-wallet-boundary-review');
fs.mkdirSync(output, { recursive: true });
const require = createRequire(root + '/package.json');
const { HDKey } = require('@scure/bip32');
const { schnorr, secp256k1 } = require('@noble/curves/secp256k1');
const s = await import(pathToFileURL(root + '/packages/sdk/src/index.ts'));
const w = await import(pathToFileURL(root + '/packages/wallet/src/index.ts'));
const fixture = JSON.parse(fs.readFileSync(root + '/fixtures/protocol-v1.json', 'utf8'));
const account = s.accountFromJson(fixture.publicAccount);
const initial = s.decodeBundle(s.fromHex(fixture.bundleHex));
const key = HDKey.fromMasterSeed(s.fromHex('000102030405060708090a0b0c0d0e0f')).derive("m/86'/1'/0'/0/0");
let secret = BigInt('0x' + s.hex(key.privateKey));
if (key.publicKey[0] === 3) secret = secp256k1.CURVE.n - secret;
const tweaked = s.fromHex(((secret + BigInt('0x' + s.hex(s.taggedHash('TapTweak', key.publicKey.slice(1))))) % secp256k1.CURVE.n).toString(16).padStart(64, '0'));
const journal = w.emptyJournal();
const first = Number(process.env.COUNT ?? 2000);
let totalRaw = 0;
let lastTxid;
for (let i = 0; i < first; i++) {
  const bundle = structuredClone(initial);
  // Model sixteen distinct, account-owned outputs from one ordinary prior tx.
  const prior = s.concat(s.i32(1), Uint8Array.of(1), s.sha256(new TextEncoder().encode(`public-prior-${i}`)), s.u32(0), Uint8Array.of(0), s.u32(0xffffffff), Uint8Array.of(16), ...Array.from({length:16}, () => s.serializeOutput({amount:100000n, scriptPubKey:initial.inputs[0].scriptPubKey})), s.u32(0));
  const priorParsed = s.parseTransaction(s.hex(prior));
  bundle.inputs = priorParsed.outputs.map((output,vout)=>({...initial.inputs[0], txid:priorParsed.txid, vout, amount:output.amount, scriptPubKey:output.scriptPubKey}));
  bundle.outputs[0].amount = 100000n;
  bundle.outputs[1] = {...bundle.outputs[1], amount:1498000n, index:i, scriptPubKey:s.deriveAddress(account,1,i).scriptPubKey};
  w.assertPaymentPolicy(bundle);
  const id = `00000000-0000-4000-8000-${i.toString().padStart(12,'0')}`;
  const p = w.reservePayment(journal, bundle, id, 1791572400000);
  w.transitionPayment(journal,id,'signing');
  const signed = s.finalizeTransaction(bundle,bundle.inputs.map((_,inputIndex)=>schnorr.sign(s.computeSighash(bundle,inputIndex),tweaked,new Uint8Array(32))));
  w.transitionPayment(journal,id,'signed',{rawTx:signed.rawTx,txid:signed.txid});
  w.transitionPayment(journal,id,'broadcast-unknown');
  w.transitionPayment(journal,id,'accepted');
  const block = {height:100000,hash:'ab'.repeat(32)};
  // Read-only chain evidence is modeled, but actual archive transition is exercised.
  w.reconcileConfirmed({...journal,payments:[p]}, [{txid:signed.txid,state:'confirmed',received:0n,spent:0n,block}], {height:100005,hash:'cd'.repeat(32)}, 1791572400000);
  assert(p.archived);
  totalRaw += signed.rawTx.length;
  lastTxid = signed.txid;
  if ((i+1)%200===0) console.log(`Generated and independently verified ${i+1} distinct signed records`);
}
assert.equal(journal.payments.length,first);
assert.equal(w.reservedOutpoints(journal).size,first*16);
const shape = {schema:2,kind:'pearl-watch-backup',account:s.accountToJson(account),journal};
const bytes = Buffer.byteLength(JSON.stringify(shape,null,2));
const compactBytes = Buffer.byteLength(JSON.stringify(shape));
fs.writeFileSync(path.join(output, 'backup-ceiling-journal.json'),JSON.stringify(shape));
const result = {records:first,inputs:first*16,totalRaw,backupBytes:bytes,compactBytes,maxBackupBytes:w.MAX_BACKUP_BYTES,lastTxid};
if(process.argv.includes('--expect-fixed')){
  const exported=w.exportWalletBackup(account,journal);
  assert.deepEqual(JSON.parse(exported),shape);
  assert.equal(Buffer.byteLength(exported),compactBytes);
  console.log('PASS fixed full-journal export',JSON.stringify(result));
}else if(bytes>w.MAX_BACKUP_BYTES){
  assert.throws(()=>w.exportWalletBackup(account,journal),/Backup exceeds 16 MiB/);
  console.log('REPRODUCED: valid bounded journal cannot export full backup',JSON.stringify(result));
}else{
  assert.equal(Buffer.byteLength(w.exportWalletBackup(account,journal)),bytes);
  console.log('Control export succeeded',JSON.stringify(result));
}
fs.writeFileSync(path.join(output, 'backup-ceiling-result.json'),JSON.stringify(result,null,2)+'\n');
