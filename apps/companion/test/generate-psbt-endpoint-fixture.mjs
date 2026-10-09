/** Regenerate/check public-only mocked endpoint replies using the hash-pinned
 * unmodified Ledger Python host oracle. No seed, device or network access. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import * as sdk from "../../../packages/sdk/src/index.ts";
import {
  parsePrlPsbt,
  serializePrlPsbt,
} from "../../../packages/bitcoin-prl-adapter/src/index.ts";
const frozen = JSON.parse(
  fs.readFileSync(
    new URL(
      "../../../packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const original = JSON.parse(
  fs.readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = sdk.accountFromJson(original.publicAccount),
  { psbt, bundle } = parsePrlPsbt(sdk.fromHex(frozen.psbtHex), account);
const maps = [psbt.globalMap, ...psbt.inputMaps, ...psbt.outputMaps].map((m) =>
  [...m].map(([k, v]) => [k, sdk.hex(v)]),
);
const oracle = spawnSync(
  "python3",
  [
    fileURLToPath(
      new URL(
        "../../../packages/bitcoin-prl-adapter/test/upstream_oracle.py",
        import.meta.url,
      ),
    ),
  ],
  {
    input: JSON.stringify({
      psbtHex: frozen.psbtHex,
      policyKey: frozen.policyKey,
      maps,
    }),
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  },
);
assert.ifError(oracle.error);
assert.equal(oracle.status, 0, oracle.stderr);
const result = JSON.parse(oracle.stdout);
assert.equal(
  sdk.hex(
    serializePrlPsbt(
      parsePrlPsbt(sdk.fromHex(result.roundtripPsbt), account).psbt,
    ),
  ),
  frozen.psbtHex,
);
assert.equal(result.policy, frozen.policyHex);
assert.equal(result.policyId, frozen.policyId);
assert.deepEqual(result.commitments, frozen.mapCommitments);
const hash = (b) => createHash("sha256").update(b).digest();
const leaf = (b) => hash(Buffer.concat([Buffer.from([0]), b]));
function merkle(hashes) {
  if (!hashes.length) return Buffer.alloc(32);
  if (hashes.length === 1) return hashes[0];
  let n = 1;
  while (n * 2 < hashes.length) n *= 2;
  return hash(
    Buffer.concat([
      Buffer.from([1]),
      merkle(hashes.slice(0, n)),
      merkle(hashes.slice(n)),
    ]),
  );
}
const hashes = new Set([
  hash(Buffer.from(result.policy, "hex")).toString("hex"),
  hash(Buffer.from("tr(@0/**)")).toString("hex"),
]);
const roots = new Set();
function list(items) {
  const bytes = items.map((x) => Buffer.from(x));
  bytes.forEach((b) => hashes.add(leaf(b).toString("hex")));
  roots.add(merkle(bytes.map(leaf)).toString("hex"));
}
list([Buffer.from(frozen.policyKey)]);
for (const m of maps) {
  const sorted = [...m].sort(([a], [b]) => a.localeCompare(b));
  list(sorted.map(([k]) => Buffer.from(k, "hex")));
  list(sorted.map(([, v]) => Buffer.from(v, "hex")));
}
const inputs = result.commitments
  .slice(1, 1 + bundle.inputs.length)
  .map((c) => Buffer.from(c, "hex"));
const outputs = result.commitments
  .slice(1 + bundle.inputs.length)
  .map((c) => Buffer.from(c, "hex"));
list(inputs);
list(outputs);
assert.equal(merkle(inputs.map(leaf)).toString("hex"), frozen.inputRoot);
assert.equal(merkle(outputs.map(leaf)).toString("hex"), frozen.outputRoot);
// Omit oracle-only stress trees not registered by the real signing adapter.
let include = false;
const transcript = result.transcript.filter((t) => {
  const b = Buffer.from(t.request, "hex");
  if (b[0] === 0x40) include = hashes.has(b.subarray(2).toString("hex"));
  else if (b[0] === 0x41 || b[0] === 0x42)
    include = roots.has(b.subarray(1, 33).toString("hex"));
  else assert.equal(b[0], 0xa0);
  return include;
});
assert.equal(transcript.length, 122);
const output = {
  description:
    "PUBLIC BIP32 vector-one fixture. Never fund. PSBT round-trip, policy, map commitments and response transcript verified by hash-pinned unmodified Ledger Python oracle; no native/hardware execution claimed.",
  oracle: "packages/bitcoin-prl-adapter/test/upstream_oracle.py",
  transcript,
};
const destination = new URL(
  "./fixtures/psbt-apdu-public.json",
  import.meta.url,
);
if (process.argv.includes("--check"))
  assert.deepEqual(JSON.parse(fs.readFileSync(destination, "utf8")), output);
else fs.writeFileSync(destination, JSON.stringify(output, null, 2) + "\n");
console.log(
  "Verified 122 frozen PSBT endpoint replies against pinned official Python oracle",
);
