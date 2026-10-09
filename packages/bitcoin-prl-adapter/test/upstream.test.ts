import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { Buffer } from "buffer";
import { fileURLToPath } from "node:url";
import {
  compactSize,
  concat,
  encodeBundle,
  hex,
  sha256,
  u32,
  MAX_GRAINS,
} from "@pearl-ledger/sdk";
import {
  buildPrlPsbt,
  createPrlWalletPolicy,
  merkleMap,
  parsePrlPsbt,
  serializePrlPsbt,
} from "../src/index.js";
import { ClientCommandInterpreter } from "../src/upstream/clientCommands.js";
import { hashLeaf, Merkle } from "../src/upstream/merkle.js";
import { createVarint, parseVarint } from "../src/upstream/varint.js";
import { from64bitLE, uint64LE } from "../src/upstream/buffertools.js";
import { publicFixture, testAccount, withAmount } from "./fixtures.js";

test("exact PSBT, policy, Merkle roots/proofs and full interruption transcript match official pinned Python client", () => {
  const { account } = publicFixture(),
    bundle = withAmount(MAX_GRAINS);
  const psbt = buildPrlPsbt(bundle, account),
    policy = createPrlWalletPolicy(account, testAccount().xpub);
  const maps = [psbt.globalMap, ...psbt.inputMaps, ...psbt.outputMaps];
  const oracle = spawnSync(
    "python3",
    [fileURLToPath(new URL("upstream_oracle.py", import.meta.url))],
    {
      input: JSON.stringify({
        psbtHex: hex(serializePrlPsbt(psbt)),
        policyKey: policy.keys[0],
        maps: maps.map((m) => [...m].map(([k, v]) => [k, hex(v)])),
      }),
      encoding: "utf8",
      maxBuffer: 4_000_000,
    },
  );
  assert.equal(oracle.status, 0, oracle.stderr);
  const result = JSON.parse(oracle.stdout) as {
    policy: string;
    policyId: string;
    commitments: string[];
    roundtripPsbt: string;
    inputAmounts: string[];
    outputAmounts: string[];
    transcript: { request: string; response: string }[];
    merkleVectors: {
      count: number;
      root: string;
      proofs: Record<string, string[]>;
    }[];
  };
  assert.equal(policy.serialize().toString("hex"), result.policy);
  assert.equal(policy.getId().toString("hex"), result.policyId);
  const merkleMaps = maps.map(merkleMap),
    commitments = merkleMaps.map((m) => m.commitment());
  assert.deepEqual(
    commitments.map((c) => c.toString("hex")),
    result.commitments,
  );
  assert.deepEqual(result.inputAmounts, [MAX_GRAINS.toString()]);
  assert.deepEqual(result.outputAmounts, [(MAX_GRAINS - 1000n).toString()]);
  assert.deepEqual(
    encodeBundle(
      parsePrlPsbt(Buffer.from(result.roundtripPsbt, "hex"), account).bundle,
    ),
    encodeBundle(bundle),
  );
  const interpreter = new ClientCommandInterpreter();
  interpreter.addKnownWalletPolicy(policy);
  merkleMaps.forEach((m) => interpreter.addKnownMapping(m));
  interpreter.addKnownList(commitments.slice(1, 1 + bundle.inputs.length));
  interpreter.addKnownList(commitments.slice(1 + bundle.inputs.length));
  interpreter.addKnownList(
    Array.from({ length: 300 }, (_, i) =>
      Buffer.concat([
        Buffer.alloc(i === 0 ? 1024 : 2, i % 256),
        Buffer.from([i & 255, i >>> 8]),
      ]),
    ),
  );
  for (const { request, response } of result.transcript)
    assert.equal(
      interpreter.execute(Buffer.from(request, "hex")).toString("hex"),
      response,
      `Transcript request ${request}`,
    );
  assert(result.transcript.length > 300);
  for (const vector of result.merkleVectors) {
    const tree = new Merkle(
      Array.from({ length: vector.count }, (_, i) =>
        Buffer.from(sha256(u32(i))),
      ),
    );
    assert.equal(tree.getRoot().toString("hex"), vector.root);
    for (const [index, proof] of Object.entries(vector.proofs))
      assert.deepEqual(
        tree.getProof(Number(index)).map((p) => p.toString("hex")),
        proof,
      );
  }
});
test("retained varint and u64 helpers reject unsafe numbers/noncanonical values and preserve uint64", () => {
  for (const value of [
    0n,
    252n,
    253n,
    65535n,
    65536n,
    4294967295n,
    4294967296n,
    9007199254740993n,
    0xffffffffffffffffn,
  ]) {
    assert.equal(parseVarint(createVarint(value), 0)[0], value);
    assert.equal(from64bitLE(uint64LE(value)), value);
  }
  for (const value of [NaN, Infinity, 1.5, -1, 9007199254740992])
    assert.throws(() => createVarint(value));
  assert.throws(() => uint64LE(1 as unknown as bigint));
  for (const bytes of [
    Buffer.from("fdfc00", "hex"),
    Buffer.from("feffff0000", "hex"),
    Buffer.from("ffffffffff00000000", "hex"),
  ])
    assert.throws(() => parseVarint(bytes, 0), /Noncanonical/);
});
test("interpreter rejects malformed/unknown requests, noncanonical proof counts and interleaved continuations", () => {
  const interpreter = new ClientCommandInterpreter(),
    value = Buffer.alloc(1024, 1);
  interpreter.addKnownList([value]);
  const root = new Merkle([hashLeaf(value)]).getRoot();
  for (const bad of [
    new Uint8Array(),
    Uint8Array.of(0x99),
    concat(Uint8Array.of(0x40, 0), new Uint8Array(32)),
    concat(Uint8Array.of(0x41), root, Uint8Array.of(253, 1, 0, 0)),
    concat(
      Uint8Array.of(0x41),
      root,
      compactSize(1),
      compactSize(0),
      Uint8Array.of(0),
    ),
    concat(Uint8Array.of(0x41), root, compactSize(1), compactSize(1)),
  ])
    assert.throws(() => interpreter.execute(Buffer.from(bad)));
  interpreter.execute(
    Buffer.from(concat(Uint8Array.of(0x40, 0), hashLeaf(value))),
  );
  assert.throws(
    () =>
      interpreter.execute(
        Buffer.from(
          concat(Uint8Array.of(0x41), root, compactSize(1), compactSize(0)),
        ),
      ),
    /queue/,
  );
  assert.throws(() => interpreter.execute(Buffer.from([0x10, 1])), /queue/);
});

test("retained host source hashes, license and exact adaptation patch are reproducible", () => {
  const result = spawnSync(
    "python3",
    [
      fileURLToPath(
        new URL("../provenance/verify_upstream.py", import.meta.url),
      ),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /6 Ledger host source files/);
});
