/** Explicit emulator-only native test, with public BIP32 vector-one seed and no broadcast. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Emulator } from "../../../apps/ledger-bitcoin-prl/prl-tests/emulator.ts";
import { accountFromJson, accountToJson, bundleFromJson, bundleToJson, computeSighash, deriveAddress,
  hex, scriptToAddress, SpeculosTransport } from "../../sdk/src/index.ts";
import { LedgerBitcoinPrlClient } from "../src/index.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = process.env.SPECULOS_MODEL ?? "nanosp";
assert(["nanosp", "nanox", "stax", "flex", "apex_p"].includes(model));
const target = model === "nanosp" ? "nanos2" : model;
const output = process.env.PEARL_EVIDENCE ?? await mkdtemp("/workspace/shared/prl-psbt-native-");
const elf = process.env.PEARL_APP_ELF ?? join(root, `apps/ledger-bitcoin-prl/build-artifacts/${target}-regtest/app.elf`);
const emulator = new Emulator(model, elf, output, Number(process.env.SPECULOS_API_PORT ?? 5151), 1_000_000);
const fixtures = [];
for (const name of ["p2mr-payment", "max-grains-payment"]) {
  const f = JSON.parse(await readFile(new URL(`fixtures/${name}.json`, import.meta.url), "utf8"));
  fixtures.push({ name, account: accountFromJson(f.publicAccount), bundle: bundleFromJson(f.bundle) });
}
const high = structuredClone(fixtures[1]);
high.name = "high-fee-payment"; high.bundle.inputs[0].amount = 100_000_000n; high.bundle.outputs[0].amount = 1000n;
fixtures.push(high);
const results = [];
try {
  await emulator.start();
  const client = new LedgerBitcoinPrlClient(new SpeculosTransport(emulator.url), "regtest");
  assert.equal((await client.capabilities()).capabilityFlags, 3);
  const account = await emulator.approve(() => client.exportAccount(0), "Approve public key", "account");
  assert.deepEqual(accountToJson(account), accountToJson(fixtures[0].account));
  for (const { name, bundle } of fixtures) {
    let saved;
    const signed = await emulator.approve(() => client.signBundle(bundle, account, {
      onVerifiedSigned: async (tx) => {
        saved = tx;
        await writeFile(join(output, `${name}-signed-checkpoint.json`), JSON.stringify({ rawTx: tx.rawTx, txid: tx.txid, wtxid: tx.wtxid }));
      },
    }), "Sign transaction", name);
    assert.equal(signed.completionWarning, undefined);
    assert.equal(saved.rawTx, signed.rawTx);
    assert.equal(signed.signatures.length, bundle.inputs.length);
    const oracle = { description: "Native PRL app in Speculos with PUBLIC vector-one seed. Never fund. No broadcast.",
      publicAccount: accountToJson(account), bundle: bundleToJson(bundle),
      sighashes: bundle.inputs.map((_, i) => hex(computeSighash(bundle, i))), signatures: signed.signatures.map(hex),
      addresses: { input: deriveAddress(account, bundle.inputs[0].branch, bundle.inputs[0].index).address,
        recipient: scriptToAddress(bundle.outputs[0].scriptPubKey, bundle.network) },
      rawTx: signed.rawTx, txid: signed.txid, wtxid: signed.wtxid, vsize: signed.vsize };
    await writeFile(join(output, `${name}-oracle.json`), JSON.stringify(oracle, null, 2) + "\n");
    results.push({ name, txid: signed.txid, wtxid: signed.wtxid, inputs: bundle.inputs.length,
      amount: bundle.outputs[0].amount.toString(), fee: (bundle.inputs.reduce((n, i) => n + i.amount, 0n) - bundle.outputs.reduce((n, o) => n + o.amount, 0n)).toString() });
  }
  await writeFile(join(output, "result.json"), JSON.stringify({ status: "passed", firmware: emulator.provenance, results }, null, 2));
  console.log(`PASS ${model}: native PSBT adapter P2MR, max-grains and high-fee cases; oracle files in ${output}`);
} finally { await emulator.stop(); }
