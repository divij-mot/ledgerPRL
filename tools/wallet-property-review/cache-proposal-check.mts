/** Tests a virtual, UNAPPLIED SDK candidate; production files are not changed. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import * as s from "../../packages/sdk/src/index.ts";
import * as w from "../../packages/wallet/src/index.ts";
const root = process.cwd(), original = readFileSync("packages/sdk/src/keys.ts", "utf8");
const patch = readFileSync("tools/wallet-property-review/p2tr-cache-proposal.patch", "utf8");
// Reconstruct the unified-diff candidate in memory. Refuse mismatched context.
const lines = original.split("\n"), proposed: string[] = [];
let at = 0, inHunk = false;
for (const line of patch.split("\n")) {
  const hunk = /^@@ -(\d+)(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(line);
  if (hunk) { const start = Number(hunk[1]) - 1; proposed.push(...lines.slice(at, start)); at = start; inHunk = true; continue; }
  if (!inHunk) continue;
  if (line.startsWith(" ")) { assert.equal(lines[at], line.slice(1)); proposed.push(lines[at++]!); }
  else if (line.startsWith("-")) { assert.equal(lines[at], line.slice(1)); at++; }
  else if (line.startsWith("+")) proposed.push(line.slice(1));
}
proposed.push(...lines.slice(at));
const candidate = proposed.join("\n"), sha = (text: string) => createHash("sha256").update(text).digest("hex");
const temp = mkdtempSync(join(tmpdir(), "prl-cache-proposal-"));
const output = process.env.PRL_OUTPUT ?? "tools/wallet-property-review/cache-proposal-results.json";
const result: any = { productionChangeApplied: false, originalKeysHash: sha(original), candidateKeysHash: sha(candidate), proposalPatchHash: sha(patch), results: [], startedAt: new Date().toISOString() };
try {
  const built = await build({ stdin: { contents: `export * from './packages/sdk/src/index.ts'; export * from './packages/wallet/src/index.ts'; export { secp256k1 as curve } from '@noble/curves/secp256k1';`, resolveDir: root, loader: "ts" }, bundle: true, format: "esm", platform: "node", write: false, logLevel: "silent",
    plugins: [{ name: "unapplied-point-cache-only", setup(b) { b.onLoad({ filter: /packages\/sdk\/src\/keys\.ts$/ }, args => ({ contents: candidate, resolveDir: dirname(args.path), loader: "ts" })); } }],
  });
  const file = join(temp, "candidate.mjs"); writeFileSync(file, built.outputFiles[0]!.text);
  result.bundleHash = sha(built.outputFiles[0]!.text);
  const c = await import(pathToFileURL(file).href);
  const originalLift = c.curve.ProjectivePoint.fromHex;
  let lifts = 0;
  c.curve.ProjectivePoint.fromHex = function(...args: any[]) { lifts++; return originalLift.apply(this, args); };
  const script = (n: number) => c.concat(Uint8Array.of(0x51, 0x20), c.curve.ProjectivePoint.BASE.multiply(BigInt(n)).toRawBytes(true).slice(1));
  try {
    const first = script(10001), before = lifts;
    c.validateP2trScript(first); c.validateP2trScript(first.slice());
    assert.equal(lifts - before, 1); result.results.push("same exact bytes lift once across separate arrays");
    const changed = first.slice(); changed[0] = 0x52; assert.throws(() => c.validateP2trScript(changed));
    changed.set(first); changed.fill(0xff, 2); assert.throws(() => c.validateP2trScript(changed));
    assert.throws(() => c.validateP2trScript(changed)); result.results.push("caller byte mutation and invalid x coordinates never reuse a positive cache entry");
    c.validateP2trScript(first); const beforeOther = lifts;
    const next = script(10002); first.set(next); c.validateP2trScript(first);
    assert.equal(lifts - beforeOther, 1); result.results.push("same mutable array with different valid bytes is independently checked");
    const old = script(20001); c.validateP2trScript(old);
    for (let n = 20002; n <= 20258; n++) c.validateP2trScript(script(n));
    const beforeEvicted = lifts; c.validateP2trScript(old);
    assert.equal(lifts - beforeEvicted, 1); c.validateP2trScript(old); assert.equal(lifts - beforeEvicted, 1);
    result.results.push("positive cache evicts within the fixed 256-entry bound");
    const root = new Uint8Array(34).fill(0xff); root[0] = 0x52; root[1] = 0x20;
    const beforeRoot = lifts; c.validateRecipientScript(root); assert.equal(lifts, beforeRoot); assert.throws(() => c.validateP2trScript(root));
    result.results.push("P2MR roots remain on the separate non-curve recipient path");
  } finally { c.curve.ProjectivePoint.fromHex = originalLift; }

  const f = JSON.parse(readFileSync("fixtures/protocol-v1.json", "utf8")), initial = s.decodeBundle(s.fromHex(f.bundleHex)), journal = w.emptyJournal();
  journal.nextChangeIndex = 1; journal.issuedReceiveThrough = 7;
  const constructStart = performance.now();
  for (let n = 0; n < 2000; n++) {
    const b = structuredClone(initial);
    b.inputs = Array.from({ length: 16 }, (_, i) => ({ ...b.inputs[0]!, amount: 1000n, txid: BigInt(n * 16 + i + 1).toString(16).padStart(64, "0") }));
    b.outputs[0]!.amount = 1000n; b.outputs[1]!.amount = 14000n;
    const bundleHex = s.hex(s.encodeBundle(b)), unsigned = s.serializeUnsignedTransaction(b);
    const rawTx = s.hex(s.concat(unsigned.slice(0, 4), Uint8Array.of(0, 1), unsigned.slice(4, -4), ...b.inputs.map(() => s.concat(Uint8Array.of(1, 64), new Uint8Array(64))), unsigned.slice(-4)));
    journal.payments.push({ id: `performance-${n}`, state: "signed", createdAt: 1000, bundleHex, outpoints: b.inputs.map(w.outpoint), txid: s.hex(s.hash256(unsigned).reverse()), rawTx });
  }
  result.constructionMs = Math.round(performance.now() - constructStart);
  const cold = await import(pathToFileURL(file).href + "?cold-validation");
  result.validationMs = [];
  for (let i = 0; i < 3; i++) { const start = performance.now(); cold.validateStoredJournal(journal); result.validationMs.push(Math.round(performance.now() - start)); }
  result.records = 2000; result.inputs = 32000;
  result.boundary = "Virtual unapplied point-cache candidate; synthetic canonical transactions with repeated public scripts and dummy witnesses. Performance and cache correctness only, no signature/hardware/browser qualification.";
  result.outcome = "pass";
} catch (error) { result.outcome = "fail"; result.error = error instanceof Error ? error.stack : String(error); process.exitCode = 1; }
finally {
  rmSync(temp, { recursive: true, force: true }); result.finishedAt = new Date().toISOString();
  result.productionKeysUnchanged = sha(readFileSync("packages/sdk/src/keys.ts", "utf8")) === sha(original);
  writeFileSync(output, JSON.stringify(result, null, 2) + "\n"); console.log(JSON.stringify(result, null, 2));
}
