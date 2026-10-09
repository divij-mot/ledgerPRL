/** Public-only frozen protocol transcript from the hash-pinned official Python host oracle. */
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { compactSize, concat, fromHex, hex, sha256 } from "@pearl-ledger/sdk";
import {
  buildPrlPsbt,
  createPrlWalletPolicy,
  serializePrlPsbt,
} from "../src/index.js";
import { publicFixture, testAccount } from "./fixtures.js";
const { account, bundle } = publicFixture();
const xpub = testAccount().xpub,
  policy = createPrlWalletPolicy(account, xpub),
  psbt = buildPrlPsbt(bundle, account);
const psbtHex = hex(serializePrlPsbt(psbt));
const output = spawnSync(
  "python3",
  [fileURLToPath(new URL("upstream_oracle.py", import.meta.url))],
  {
    input: JSON.stringify({
      psbtHex,
      policyKey: policy.keys[0],
      maps: [psbt.globalMap, ...psbt.inputMaps, ...psbt.outputMaps].map((m) =>
        [...m].map(([k, v]) => [k, hex(v)]),
      ),
    }),
    encoding: "utf8",
    maxBuffer: 4_000_000,
  },
);
assert.equal(output.status, 0, output.stderr);
const oracle = JSON.parse(output.stdout);
const data = concat(
  fromHex(oracle.commitments[0]),
  compactSize(bundle.inputs.length),
  fromHex(oracle.inputRoot),
  compactSize(bundle.outputs.length),
  fromHex(oracle.outputRoot),
  fromHex(oracle.policyId),
  new Uint8Array(32),
);
const fixture = {
  description:
    "PUBLIC protocol-v1.json account and unsigned payment. Never fund. Byte commitments verified by unmodified official Ledger Python host.",
  ledgerRevision: "44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a",
  accountXpub: xpub,
  policyKey: policy.keys[0],
  policyHex: oracle.policy,
  policyId: oracle.policyId,
  psbtHex,
  mapCommitments: oracle.commitments,
  inputRoot: oracle.inputRoot,
  outputRoot: oracle.outputRoot,
  signPsbtApduHex: hex(
    concat(Uint8Array.of(0xe1, 0x04, 0, 1, data.length), data),
  ),
  transcriptCommandsChecked: oracle.transcript.length,
  oracleTranscriptSha256: hex(
    sha256(new TextEncoder().encode(JSON.stringify(oracle.transcript))),
  ),
};
writeFileSync(
  new URL("fixtures/ledger-psbt-v2.json", import.meta.url),
  JSON.stringify(fixture, null, 2) + "\n",
);
console.log(
  `Pinned Ledger Python oracle checked ${oracle.transcript.length} commands.`,
);
