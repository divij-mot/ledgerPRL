/** Public BIP32 vector 1 only. Read-only device account/address export, no signing. */
import assert from 'node:assert/strict';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { LedgerPearlClient, SpeculosTransport, accountToJson, deriveAddress, network, fromHex, type NetworkName, type AccountPublicKey } from '/workspace/scratch/5d237258d612/ledgerPRL/packages/sdk/src/index.ts';
import { Emulator, type Model } from '/workspace/scratch/5d237258d612/ledgerPRL/apps/ledger/tests/speculos-driver.ts';
const ROOT='/workspace/scratch/5d237258d612/ledgerPRL';
const require=createRequire(join(ROOT,'package.json'));
const {HDKey}=require('@scure/bip32');
const selected=process.env.PEARL_TEST_NETWORK as NetworkName;
assert(['mainnet','testnet','testnet2','regtest','simnet'].includes(selected));
const model=process.env.SPECULOS_MODEL as Model;
assert(['nanosp','nanox','stax','flex','apex_p'].includes(model));
const output=process.env.PEARL_EVIDENCE!;const elf=process.env.PEARL_APP_ELF!;
assert(output&&elf);
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
const nativeSnapshot=()=>JSON.parse(execFileSync('python3',[join(ROOT,'scripts/ledger-build-manifest.py'),'snapshot'],{cwd:ROOT,encoding:'utf8'}));
const before=nativeSnapshot();const elfHash=sha(await readFile(elf));
const sdkHashes=async()=>Object.fromEntries(await Promise.all((await readdir(join(ROOT,'packages/sdk/src'))).filter(x=>x.endsWith('.ts')).map(async x=>[x,sha(await readFile(join(ROOT,'packages/sdk/src',x)))])));
const sdkBefore=await sdkHashes();
const sourceSha256={harness:sha(await readFile(import.meta.filename)),driver:sha(await readFile(join(ROOT,'apps/ledger/tests/speculos-driver.ts'))),lockfile:sha(await readFile(join(ROOT,'package-lock.json')))};
// This is the published BIP32 vector-1 seed, already used by the emulator driver.
const master=HDKey.fromMasterSeed(fromHex('000102030405060708090a0b0c0d0e0f'));
const derived=master.derive(`m/86'/${network(selected).coinType}'/0'`);
const expected:AccountPublicKey={network:selected,account:0,masterFingerprint:fromHex(master.fingerprint.toString(16).padStart(8,'0')),publicKey:Uint8Array.from(derived.publicKey),chainCode:Uint8Array.from(derived.chainCode)};
master.wipePrivateData();derived.wipePrivateData();
const emulator=new Emulator(model,elf,output,5571);
const checks:string[]=[];const addresses:Record<string,string>={};
try {
 await emulator.start();
 const client=new LedgerPearlClient(new SpeculosTransport(emulator.url),selected);
 const capabilities=await client.capabilities();
 assert.deepEqual(capabilities,{protocol:1,version:'0.1.0',network:selected,maxInputs:16,maxBundleSize:1507});checks.push('exact-network-capabilities');
 for(const wrong of ['mainnet','testnet','testnet2','regtest','simnet'].filter(n=>n!==selected)){
  const mismatched=new LedgerPearlClient(new SpeculosTransport(emulator.url),wrong as NetworkName);
  await assert.rejects(()=>mismatched.capabilities(),/Wrong device network/);
 }
 checks.push('four-wrong-host-network-selections-rejected');
 const account=await emulator.approve(()=>client.exportAccount(0),'Approve export','account');
 assert.deepEqual(accountToJson(account),accountToJson(expected));checks.push('independent-public-vector-account-coin-path');
 for(const branch of [0,1] as const){
  const actual=await emulator.approve(()=>client.verifyAddress(account,branch,0),'Confirm',`address-${branch}`);
  assert.equal(actual,deriveAddress(expected,branch,0).address);
  assert(actual.startsWith(network(selected).hrp+'1p'));
  addresses[String(branch)]=actual;
 }
 checks.push('full-receive-and-change-address-review');
 assert.equal(sha(await readFile(join(output,'tested-firmware.elf'))),elfHash);assert.deepEqual(nativeSnapshot(),before);
 assert.equal(sha(await readFile(import.meta.filename)),sourceSha256.harness);
 assert.equal(sha(await readFile(join(ROOT,'apps/ledger/tests/speculos-driver.ts'))),sourceSha256.driver);
 assert.equal(sha(await readFile(join(ROOT,'package-lock.json'))),sourceSha256.lockfile);
 assert.deepEqual(await sdkHashes(),sdkBefore);
 await writeFile(join(output,'evidence.json'),JSON.stringify({sdkSourceHashes:sdkBefore,status:'passed',scope:'Emulated read-only capability/account/address verification; no signatures, broadcast or physical install',firmware:emulator.provenance,sourceSha256,capabilities,account:accountToJson(account),addresses,checks},null,2)+'\n');
 console.log(`PASS ${model} ${selected}: capabilities, network mismatch checks, account fixture, receive and change addresses`);
} finally {await emulator.stop();}
