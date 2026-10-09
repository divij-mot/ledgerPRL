import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { HDKey } from "@scure/bip32";
import { bech32m } from "@scure/base";
import * as sdk from "../src/index.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = sdk.accountFromJson(fixture.publicAccount);
const fresh = () => sdk.bundleFromJson(fixture.bundle);
const signatures = () => fixture.signatures.map(sdk.fromHex) as Uint8Array[];
test("exact grains accept the Pearl maximum and >2^53", () => {
  assert.equal(sdk.parseGrains("9007199254740993"), 9007199254740993n);
  assert.equal(sdk.parsePrl("21000000000.00000000"), sdk.MAX_GRAINS);
  assert.equal(sdk.formatPrl(sdk.MAX_GRAINS), "21000000000.00000000");
  assert.equal(sdk.formatPrl(1n), "0.00000001");
  assert.equal(sdk.parsePrl("90071992.54740993"), 9007199254740993n);
});
for (const value of [
  "-1",
  "+1",
  "01",
  " 1",
  "1 ",
  "1e8",
  "1.0",
  "",
  "Infinity",
  "2100000000000000001",
])
  test(`reject invalid atomic string ${JSON.stringify(value)}`, () =>
    assert.throws(() => sdk.parseGrains(value)));
for (const value of [
  "-1",
  ".1",
  "1.",
  "1.000000001",
  "01.0",
  "21000000000.00000001",
  "NaN",
])
  test(`reject invalid PRL string ${JSON.stringify(value)}`, () =>
    assert.throws(() => sdk.parsePrl(value)));
test("reject floats and unsafe Number at parser boundary", () => {
  assert.throws(() => sdk.parseGrains(9007199254740992 as unknown as string));
  const b = structuredClone(fixture.bundle);
  b.inputs[0].amount = 9007199254740992;
  assert.throws(() => sdk.bundleFromJson(b));
});
test("all networks bind genesis and coin type", () => {
  assert.equal(sdk.accountPath("mainnet", 0), "m/86'/808276'/0'");
  assert.equal(
    sdk.derivationPath("regtest", 2147483647, 1, 2147483647),
    "m/86'/1'/2147483647'/1/2147483647",
  );
  assert.notEqual(
    sdk.NETWORKS.testnet.genesisHash,
    sdk.NETWORKS.testnet2.genesisHash,
  );
  assert.equal(
    sdk.NETWORKS.regtest.genesisHash,
    sdk.NETWORKS.simnet.genesisHash,
  );
  for (const n of [-1, 2147483648, 0.5, NaN])
    assert.throws(() => sdk.checkedIndex(n));
  assert.throws(() => sdk.network("__proto__" as sdk.NetworkName));
});
test("BIP86 public vector independently validates CKDpub + empty-tree tweak", () => {
  const key = HDKey.fromExtendedKey(
    "xpub6BgBgsespWvERF3LHQu6CnqdvfEvtMcQjYrcRzx53QJjSxarj2afYWcLteoGVky7D3UKDP9QyrLprQ3VCECoY49yfdDEHGCtMMj92pReUsQ",
  );
  const a = {
    ...account,
    publicKey: key.publicKey!,
    chainCode: key.chainCode!,
  };
  const d = sdk.deriveAddress(a, 0, 0);
  assert.equal(
    sdk.hex(d.internalKey),
    "cc8a4bc64d897bddc5fbc2f670f7a8ba0b386779106cf1223c6fc5d7cd6fc115",
  );
  assert.equal(
    sdk.hex(d.outputKey),
    "a60869f0dbcf1dc659c9cecbaf8050135ea9e8cdc487053f1dc6880949dc684c",
  );
  assert.equal(
    sdk.hex(sdk.deriveAddress(a, 1, 0).outputKey),
    "882d74e5d0572d5a816cef0041a96b6c1de832f6f9676d9605c44d5e9a97d3dc",
  );
});
test("public fixture addresses reproduce and validate", () => {
  assert.equal(
    sdk.deriveAddress(account, 0, 0).address,
    fixture.addresses.input,
  );
  assert.equal(
    sdk.deriveAddress(account, 1, 0).address,
    fixture.addresses.change,
  );
  for (const name of Object.keys(sdk.NETWORKS) as sdk.NetworkName[]) {
    const d = sdk.deriveAddress({ ...account, network: name }, 0, 0);
    assert.deepEqual(sdk.addressToScript(d.address, name), d.scriptPubKey);
    assert.deepEqual(
      sdk.addressToScript(d.address.toUpperCase(), name),
      d.scriptPubKey,
    );
  }
});
test("reject wrong HRP, checksum, v2, mixed case and non-curve program", () => {
  const address = fixture.addresses.input;
  assert.throws(() => sdk.addressToScript(address, "mainnet"));
  assert.throws(() =>
    sdk.addressToScript(address.slice(0, -1) + "x", "regtest"),
  );
  assert.throws(() =>
    sdk.addressToScript(
      address.slice(0, 4).toUpperCase() + address.slice(4),
      "regtest",
    ),
  );
  const program = sdk.deriveAddress(account, 0, 0).outputKey;
  assert.throws(() =>
    sdk.addressToScript(
      bech32m.encode("rprl", [2, ...bech32m.toWords(program)]),
      "regtest",
    ),
  );
  assert.throws(() =>
    sdk.addressToScript(
      bech32m.encode("rprl", [
        1,
        ...bech32m.toWords(new Uint8Array(32).fill(255)),
      ]),
      "regtest",
    ),
  );
});
test("canonical bundle matches frozen bytes and exact fee", () => {
  const b = fresh();
  assert.equal(sdk.hex(sdk.encodeBundle(b)), fixture.bundleHex);
  assert.equal(sdk.hex(sdk.sha256(sdk.encodeBundle(b))), fixture.bundleSha256);
  assert.deepEqual(
    sdk.bundleToJson(sdk.decodeBundle(sdk.fromHex(fixture.bundleHex))),
    fixture.bundle,
  );
  assert.equal(sdk.validateBundle(b, account).fee, 1000n);
  assert.equal(sdk.encodeBundle(b).length, 289);
});
test("all truncated bundles and trailing bytes fail", () => {
  const bytes = sdk.fromHex(fixture.bundleHex);
  for (let length = 0; length < bytes.length; length++)
    assert.throws(
      () => sdk.decodeBundle(bytes.slice(0, length)),
      `length ${length}`,
    );
  assert.throws(() => sdk.decodeBundle(sdk.concat(bytes, Uint8Array.of(0))));
});
const invalidBundles: Record<string, (b: sdk.SigningBundle) => void> = {
  version: (b) => {
    b.version = 2 as 1;
  },
  locktime: (b) => {
    b.lockTime = 1 as 0;
  },
  sequence: (b) => {
    b.inputs[0]!.sequence = 0xfffffffd;
  },
  "zero input": (b) => {
    b.inputs[0]!.amount = 0n;
  },
  "oversize amount": (b) => {
    b.inputs[0]!.amount = sdk.MAX_GRAINS + 1n;
  },
  "oversize aggregate": (b) => {
    b.inputs[0]!.amount = sdk.MAX_GRAINS;
  },
  "outputs exceed inputs": (b) => {
    b.outputs[0]!.amount = sdk.MAX_GRAINS;
  },
  "duplicate inputs": (b) => {
    b.inputs[1] = { ...b.inputs[0]! };
  },
  "negative vout": (b) => {
    b.inputs[0]!.vout = -1;
  },
  "invalid txid": (b) => {
    b.inputs[0]!.txid = "AB".repeat(32);
  },
  "empty inputs": (b) => {
    b.inputs = [];
  },
  "too many inputs": (b) => {
    b.inputs = Array.from({ length: 17 }, (_, i) => ({
      ...b.inputs[0]!,
      vout: i,
    }));
  },
  "no recipient": (b) => {
    b.outputs = [b.outputs[1]!];
  },
  "two recipients": (b) => {
    b.outputs[1] = { ...b.outputs[0]! };
  },
  "recipient origin": (b) => {
    b.outputs[0]!.index = 1;
  },
  "change branch": (b) => {
    b.outputs[1]!.branch = 0;
  },
  "input hardening": (b) => {
    b.inputs[0]!.index = 2147483648;
  },
  "invalid script": (b) => {
    b.inputs[0]!.scriptPubKey[0] = 0x52;
  },
  "wrong account": (b) => {
    b.account = 1;
  },
  "wrong input origin": (b) => {
    b.inputs[0]!.index = 1;
  },
  "wrong change origin": (b) => {
    b.outputs[1]!.index = 1;
  },
};
for (const [label, mutate] of Object.entries(invalidBundles))
  test(`reject bundle ${label}`, () => {
    const b = fresh();
    mutate(b);
    assert.throws(() => sdk.validateBundle(b, account));
  });
test("sighash and signatures match frozen cross-language vectors", () => {
  const b = fresh();
  b.inputs.forEach((_, i) => {
    assert.equal(sdk.hex(sdk.computeSighash(b, i)), fixture.sighashes[i]);
    assert.equal(sdk.verifySignature(b, i, signatures()[i]!), true);
  });
});
test("each signed field is bound by all default signatures", () => {
  const mutations: ((b: sdk.SigningBundle) => void)[] = [
    (b) => {
      b.inputs[0]!.amount++;
    },
    (b) => {
      b.inputs[1]!.vout++;
    },
    (b) => {
      b.inputs.reverse();
    },
    (b) => {
      b.outputs.reverse();
    },
    (b) => {
      b.outputs[0]!.amount--;
    },
    (b) => {
      b.outputs[1]!.scriptPubKey = sdk.deriveAddress(
        account,
        1,
        1,
      ).scriptPubKey;
    },
    (b) => {
      b.inputs[0]!.scriptPubKey = sdk.deriveAddress(account, 0, 1).scriptPubKey;
    },
  ];
  for (const mutate of mutations) {
    const b = fresh();
    mutate(b);
    assert.equal(sdk.verifySignature(b, 0, signatures()[0]!), false);
    assert.equal(sdk.verifySignature(b, 1, signatures()[1]!), false);
  }
});
test("final witness serialization, independent parse, txid and vsize", () => {
  const result = sdk.finalizeTransaction(fresh(), signatures());
  assert.equal(result.rawTx, fixture.rawTx);
  assert.equal(result.txid, fixture.txid);
  assert.equal(result.wtxid, fixture.wtxid);
  assert.equal(result.vsize, fixture.vsize);
  const tx = sdk.parseTransaction(result.rawTx);
  assert.equal(tx.txid, result.txid);
  assert.equal(tx.wtxid, result.wtxid);
  assert.equal(tx.outputs[0]!.amount, 9007199254740000n);
  assert.equal(tx.inputs[0]!.witness.length, 1);
  assert.equal(tx.inputs[0]!.witness[0]!.length, 64);
  assert.equal(tx.coinbase, false);
});
test("signature count, 65-byte nondefault sigs and tampered signatures rejected", () => {
  assert.throws(() =>
    sdk.finalizeTransaction(fresh(), signatures().slice(0, 1)),
  );
  const sigs = signatures();
  sigs[0] = sdk.concat(sigs[0]!, Uint8Array.of(1));
  assert.throws(() => sdk.finalizeTransaction(fresh(), sigs));
  const bad = signatures();
  bad[0]![0] = bad[0]![0]! ^ 1;
  assert.throws(() => sdk.finalizeTransaction(fresh(), bad));
});
test("raw transaction parser rejects truncation, trailing and noncanonical count", () => {
  const bytes = sdk.fromHex(fixture.rawTx);
  for (let length = 0; length < bytes.length; length++)
    assert.throws(() => sdk.parseTransaction(bytes.slice(0, length)));
  assert.throws(() =>
    sdk.parseTransaction(sdk.concat(bytes, Uint8Array.of(0))),
  );
  const unsigned = sdk.serializeUnsignedTransaction(fresh());
  assert.throws(() =>
    sdk.parseTransaction(
      sdk.concat(
        unsigned.slice(0, 4),
        Uint8Array.of(253, 2, 0),
        unsigned.slice(5),
      ),
    ),
  );
});
test("raw previous transaction preserves maximum and identifies coinbase", () => {
  const script = sdk.deriveAddress(account, 0, 0).scriptPubKey;
  const bytes = sdk.concat(
    sdk.i32(1),
    Uint8Array.of(1),
    new Uint8Array(32),
    sdk.u32(0xffffffff),
    Uint8Array.of(2, 1, 1),
    sdk.u32(0xffffffff),
    Uint8Array.of(1),
    sdk.u64(sdk.MAX_GRAINS),
    Uint8Array.of(34),
    script,
    sdk.u32(0),
  );
  const tx = sdk.parseTransaction(bytes);
  assert.equal(tx.coinbase, true);
  assert.equal(tx.outputs[0]!.amount, sdk.MAX_GRAINS);
});

test("Node Buffer views obey byteOffset and never alias decoded fields", () => {
  const bytes = Buffer.from(fixture.bundleHex, "hex");
  const padded = Buffer.concat([
    Buffer.from("prefix"),
    bytes,
    Buffer.from("suffix"),
  ]);
  const decoded = sdk.decodeBundle(padded.subarray(6, 6 + bytes.length));
  assert.deepEqual(sdk.bundleToJson(decoded), fixture.bundle);
  padded.fill(0);
  assert.deepEqual(sdk.bundleToJson(decoded), fixture.bundle);
  assert.equal(
    sdk.parseTransaction(Buffer.from(fixture.rawTx, "hex")).txid,
    fixture.txid,
  );
});
for (const field of [
  "sighash",
  "annex",
  "tapMerkleRoot",
  "privateKey",
  "seed",
]) {
  test(`unknown JSON field ${field} is never silently discarded`, () => {
    const top = structuredClone(fixture.bundle);
    top[field] = "00";
    assert.throws(() => sdk.bundleFromJson(top), /fields/);
    const input = structuredClone(fixture.bundle);
    input.inputs[0][field] = "00";
    assert.throws(() => sdk.bundleFromJson(input), /fields/);
    const output = structuredClone(fixture.bundle);
    output.outputs[0][field] = "00";
    assert.throws(() => sdk.bundleFromJson(output), /fields/);
    assert.throws(
      () => sdk.accountFromJson({ ...fixture.publicAccount, [field]: "00" }),
      /fields/,
    );
  });
}
test("missing fields, oversized numeric strings and invalid JSON collections fail closed", () => {
  const b = structuredClone(fixture.bundle);
  delete b.outputs[0].branch;
  assert.throws(() => sdk.bundleFromJson(b));
  assert.throws(() => sdk.bundleFromJson({ ...fixture.bundle, inputs: {} }));
  assert.throws(() => sdk.parseGrains("1".repeat(100_000)));
  assert.throws(() => sdk.parsePrl("1".repeat(100_000)));
});

test("maximum 16-input 2-output bundle is exactly 1507 bytes", () => {
  const b = fresh();
  b.inputs = Array.from({ length: 16 }, (_, i) => ({
    ...b.inputs[0]!,
    vout: i,
  }));
  const bytes = sdk.encodeBundle(b);
  assert.equal(bytes.length, sdk.MAX_BUNDLE_SIZE);
  assert.deepEqual(
    sdk.bundleToJson(sdk.decodeBundle(bytes)),
    sdk.bundleToJson(b),
  );
});

test("internal key helper rejects malformed compressed prefixes", () => {
  const key = sdk.derivePublicKey(account, 0, 0);
  key[0] = 4;
  assert.throws(() => sdk.taprootOutputKey(key), /prefix/);
});
