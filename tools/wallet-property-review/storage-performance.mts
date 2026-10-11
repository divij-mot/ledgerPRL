/** Storage validation cost only. Dummy witnesses are never signed/broadcast. */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import * as s from "../../packages/sdk/src/index.ts";
import * as w from "../../packages/wallet/src/index.ts";
const f = JSON.parse(readFileSync("fixtures/protocol-v1.json", "utf8"));
const initial = s.decodeBundle(s.fromHex(f.bundleHex)), journal = w.emptyJournal();
const count = Number(process.env.PRL_RECORDS ?? 2000), inputCount = Number(process.env.PRL_INPUTS ?? 16);
if (!Number.isInteger(count) || count < 1 || count > 2000 || !Number.isInteger(inputCount) || inputCount < 2 || inputCount > 16) throw Error("Bounded performance fixture required");
journal.nextChangeIndex = 1; journal.issuedReceiveThrough = 7;
const constructionStart = performance.now();
for (let n = 0; n < count; n++) {
  const b = structuredClone(initial);
  b.inputs = Array.from({ length: inputCount }, (_, i) => ({ ...b.inputs[0]!, amount: 1000n, txid: BigInt(n * 16 + i + 1).toString(16).padStart(64, "0") }));
  b.outputs[0]!.amount = 1000n; b.outputs[1]!.amount = BigInt(inputCount - 1) * 1000n - 100n;
  const bundleHex = s.hex(s.encodeBundle(b)), unsigned = s.serializeUnsignedTransaction(b);
  const rawTx = s.hex(s.concat(unsigned.slice(0, 4), Uint8Array.of(0, 1), unsigned.slice(4, -4),
    ...b.inputs.map(() => s.concat(Uint8Array.of(1, 64), new Uint8Array(64))), unsigned.slice(-4)));
  journal.payments.push({ id: `performance-${n}`, state: "signed", createdAt: 1000, bundleHex, outpoints: b.inputs.map(w.outpoint), txid: s.hex(s.hash256(unsigned).reverse()), rawTx });
}
const constructionMs = Math.round(performance.now() - constructionStart);
// A fresh process prevents fixture construction from priming any validation cache.
const validation = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
import fs from 'node:fs'; import {validateStoredJournal} from './packages/wallet/src/index.ts';
const journal=JSON.parse(fs.readFileSync(0,'utf8')),times=[];
for(let i=0;i<3;i++){const start=performance.now();validateStoredJournal(journal);times.push(Math.round(performance.now()-start));}
console.log(JSON.stringify(times));`], { input: JSON.stringify(journal), encoding: "utf8", timeout: 120_000, maxBuffer: 1024 * 1024 });
if (validation.error || validation.status !== 0) throw validation.error ?? new Error(validation.stderr);
const timings = JSON.parse(validation.stdout);
const paths = ["packages/wallet/src/journal.ts", "packages/sdk/src/keys.ts", "packages/sdk/src/bundle.ts", "packages/sdk/src/transaction.ts", "apps/companion/src/storage.ts"];
const report = { at: new Date().toISOString(), records: count, inputs: count * inputCount, constructionMs, validationMs: timings,
  sourceHashes: Object.fromEntries(paths.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")])),
  bytes: Buffer.byteLength(JSON.stringify(journal)), node: process.version,
  boundary: "Synthetic canonical serialization with repeated owned public scripts and dummy witnesses; performance only, no valid-signature, account-ownership or real-world latency claim.",
};
const output = process.env.PRL_OUTPUT ?? "tools/wallet-property-review/storage-performance.json";
writeFileSync(output, JSON.stringify(report, null, 2) + "\n"); console.log(JSON.stringify(report, null, 2));
