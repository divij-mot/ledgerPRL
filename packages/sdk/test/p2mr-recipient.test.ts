import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { bech32m } from "@scure/base";
import {
  accountFromJson,
  addressToScript,
  bundleFromJson,
  concat,
  encodeBundle,
  decodeBundle,
  hex,
  LedgerPearlClient,
  NETWORKS,
  scriptToAddress,
  validateBundle,
  validateP2trScript,
  type NetworkName,
} from "../src/index.js";
// Exact outputs cross-checked against btcutil.NewAddressMerkleRoot in pinned Pearl
// 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701, not merely a self-round-trip.
const vectors: readonly [NetworkName, number, string][] = [
  [
    "mainnet",
    0,
    "prl1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq3wv8ty",
  ],
  [
    "mainnet",
    255,
    "prl1zlllllllllllllllllllllllllllllllllllllllllllllllllllsns0kzn",
  ],
  [
    "testnet",
    0,
    "tprl1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6pge53",
  ],
  [
    "testnet",
    255,
    "tprl1zlllllllllllllllllllllllllllllllllllllllllllllllllllscltgax",
  ],
  [
    "testnet2",
    0,
    "tprl1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq6pge53",
  ],
  [
    "testnet2",
    255,
    "tprl1zlllllllllllllllllllllllllllllllllllllllllllllllllllscltgax",
  ],
  [
    "regtest",
    0,
    "rprl1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc5p3e",
  ],
  [
    "regtest",
    255,
    "rprl1zlllllllllllllllllllllllllllllllllllllllllllllllllllszxhscw",
  ],
  [
    "simnet",
    0,
    "rprl1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqc5p3e",
  ],
  [
    "simnet",
    255,
    "rprl1zlllllllllllllllllllllllllllllllllllllllllllllllllllszxhscw",
  ],
];
function fixture() {
  const f = JSON.parse(
    readFileSync(
      new URL("../../../fixtures/protocol-v1.json", import.meta.url),
      "utf8",
    ),
  );
  return {
    account: accountFromJson(f.publicAccount),
    bundle: bundleFromJson(f.bundle),
  };
}
test("Pearl P2MR recipient address vectors match the pinned node on every network", () => {
  for (const [name, fill, address] of vectors) {
    const script = concat(
      Uint8Array.of(0x52, 0x20),
      new Uint8Array(32).fill(fill),
    );
    assert.equal(scriptToAddress(script, name), address);
    assert.deepEqual(addressToScript(address, name), script);
    assert.deepEqual(addressToScript(address.toUpperCase(), name), script);
    assert.throws(() => validateP2trScript(script), /Only witness v1/);
  }
});
test("recipient codec rejects unsupported witness version, wrong root length/network and bad checksum", () => {
  for (const version of [0, 3, 4, 16]) {
    const addr = bech32m.encode("prl", [
      version,
      ...bech32m.toWords(new Uint8Array(32)),
    ]);
    assert.throws(() => addressToScript(addr, "mainnet"));
  }
  for (const length of [0, 1, 20, 31, 33, 40]) {
    const addr = bech32m.encode("prl", [
      2,
      ...bech32m.toWords(new Uint8Array(length)),
    ]);
    assert.throws(() => addressToScript(addr, "mainnet"));
  }
  assert.throws(() => addressToScript(vectors[0]![2], "testnet2"), /network/);
  assert.throws(() =>
    addressToScript(vectors[0]![2].slice(0, -1) + "q", "mainnet"),
  );
});
test("P2MR is external-recipient-only; old PRL1 device rejects before all APDUs", () => {
  const { account, bundle } = fixture();
  const p2mr = concat(Uint8Array.of(0x52, 0x20), new Uint8Array(32));
  bundle.outputs[0]!.scriptPubKey = p2mr;
  validateBundle(bundle, account);
  assert.equal(
    hex(decodeBundle(encodeBundle(bundle)).outputs[0]!.scriptPubKey),
    hex(p2mr),
  );
  let calls = 0;
  const oldClient = new LedgerPearlClient(
    {
      exchange: async () => {
        calls++;
        return new Uint8Array();
      },
    },
    "regtest",
  );
  assert.throws(() => oldClient.signBundle(bundle, account), /Only witness v1/);
  assert.equal(calls, 0);
  assert.equal(oldClient.sessionState, "ready");
  bundle.inputs[0]!.scriptPubKey = p2mr;
  assert.throws(() => validateBundle(bundle, account));
  const fresh = fixture();
  fresh.bundle.outputs[1]!.scriptPubKey = p2mr;
  assert.throws(() => validateBundle(fresh.bundle, fresh.account));
  // Same HRP does not identify a chain; separate PSBT/network and backend genesis bindings remain required.
  assert.equal(NETWORKS.testnet.hrp, NETWORKS.testnet2.hrp);
  assert.notEqual(NETWORKS.testnet.genesisHash, NETWORKS.testnet2.genesisHash);
});
