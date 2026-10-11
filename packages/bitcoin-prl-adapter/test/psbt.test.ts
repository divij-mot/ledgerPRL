import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  compactSize,
  concat,
  encodeBundle,
  fromHex,
  hex,
  i32,
  MAX_GRAINS,
  parseTransaction,
  serializeOutput,
  u32,
  u64,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import {
  buildPrlPsbt,
  MAX_PREVIOUS_TX_BYTES,
  MAX_PSBT_BYTES,
  parsePrlPsbt,
  PRL_NETWORK_KEY,
  serializePrlPsbt,
  type PrlPsbtV2,
} from "../src/index.js";
import { publicFixture, p2mrFixture, withAmount } from "./fixtures.js";
function mutable(psbt: PrlPsbtV2) {
  return {
    globalMap: new Map(psbt.globalMap),
    inputMaps: psbt.inputMaps.map((m) => new Map(m)),
    outputMaps: psbt.outputMaps.map((m) => new Map(m)),
  };
}
function rejectsMutation(
  change: (p: ReturnType<typeof mutable>) => void,
  expected?: RegExp,
) {
  const { account, bundle } = publicFixture(),
    p = mutable(buildPrlPsbt(bundle, account));
  change(p);
  if (expected)
    assert.throws(() => parsePrlPsbt(serializePrlPsbt(p), account), expected);
  else assert.throws(() => parsePrlPsbt(serializePrlPsbt(p), account));
}
test("PSBTv2/BIP371 round trip preserves exact original canonical bundle", () => {
  const { account, bundle } = publicFixture();
  const psbt = buildPrlPsbt(bundle, account),
    bytes = serializePrlPsbt(psbt),
    decoded = parsePrlPsbt(bytes, account);
  assert.deepEqual(encodeBundle(decoded.bundle), encodeBundle(bundle));
  assert.deepEqual(serializePrlPsbt(decoded.psbt), bytes);
  assert.equal(hex(psbt.globalMap.get(PRL_NETWORK_KEY)!).slice(0, 4), "0103");
  assert.equal(
    psbt.inputMaps[0]!.get("01")!
      .slice(0, 8)
      .reduceRight((n, b) => n * 256n + BigInt(b), 0n),
    9007199254740993n,
  );
});
test("all values around 2^53 and PRL maximum stay bigint/exact LE u64", () => {
  const { account } = publicFixture();
  for (const amount of [
    9007199254740991n,
    9007199254740992n,
    9007199254740993n,
    MAX_GRAINS,
  ]) {
    const bundle = withAmount(amount),
      psbt = buildPrlPsbt(bundle, account);
    const expected = Buffer.alloc(8);
    expected.writeBigUInt64LE(amount);
    assert.equal(
      hex(psbt.inputMaps[0]!.get("01")!.slice(0, 8)),
      expected.toString("hex"),
    );
    const round = parsePrlPsbt(serializePrlPsbt(psbt), account).bundle;
    assert.equal(round.inputs[0]!.amount, amount);
    assert.equal(round.outputs[0]!.amount, amount - 1000n);
  }
  const numberBundle = withAmount(10000n);
  numberBundle.inputs[0]!.amount = 10000 as unknown as bigint;
  assert.throws(() => buildPrlPsbt(numberBundle, account), /Amount outside/);
});
test("P2MR external recipient is allowed with no curve interpretation; ownership stays P2TR", () => {
  const { account, bundle } = p2mrFixture();
  const result = parsePrlPsbt(
    serializePrlPsbt(buildPrlPsbt(bundle, account)),
    account,
  ).bundle;
  assert.equal(hex(result.outputs[0]!.scriptPubKey), "5220" + "00".repeat(32));
  bundle.inputs[0]!.scriptPubKey = result.outputs[0]!.scriptPubKey;
  assert.throws(() => buildPrlPsbt(bundle, account), /Only witness v1/);
  const fresh = p2mrFixture();
  fresh.bundle.outputs[1]!.scriptPubKey = result.outputs[0]!.scriptPubKey;
  assert.throws(
    () => buildPrlPsbt(fresh.bundle, fresh.account),
    /Only witness v1/,
  );
});
test("mandatory network and genesis binding rejects same-HRP and unsupported profile substitutions", () => {
  rejectsMutation((p) => {
    p.globalMap.delete(PRL_NETWORK_KEY);
  });
  rejectsMutation((p) => {
    p.globalMap.get(PRL_NETWORK_KEY)![1] = 4;
  }, /Wrong PSBT network/);
  rejectsMutation((p) => {
    p.globalMap.get(PRL_NETWORK_KEY)![2] =
      p.globalMap.get(PRL_NETWORK_KEY)![2]! ^ 1;
  }, /Wrong PSBT genesis/);
  rejectsMutation((p) => {
    p.globalMap.get(PRL_NETWORK_KEY)![0] = 2;
  }, /schema/);
  for (const [key, value] of [
    ["fb", u32(0)],
    ["02", i32(2)],
    ["03", u32(1)],
    ["06", Uint8Array.of(1)],
  ] as const)
    rejectsMutation((p) => p.globalMap.set(key, value));
  rejectsMutation((p) => p.globalMap.set("00", new Uint8Array()));
  rejectsMutation((p) => p.globalMap.set("fc0350524c02", new Uint8Array()));
});
test("strict maps reject duplicate, missing, unknown, signed, script-path and malformed fields", () => {
  const { account, bundle } = publicFixture(),
    psbt = buildPrlPsbt(bundle, account),
    bytes = serializePrlPsbt(psbt);
  const duplicate = concat(
    bytes.slice(0, 5),
    Uint8Array.of(1, 2, 4),
    i32(1),
    bytes.slice(5),
  );
  assert.throws(() => parsePrlPsbt(duplicate, account), /Duplicate PSBT/);
  assert.throws(
    () =>
      parsePrlPsbt(
        concat(bytes.slice(0, 5), Uint8Array.of(253, 1, 0), bytes.slice(6)),
        account,
      ),
    /Noncanonical/,
  );
  assert.throws(
    () => parsePrlPsbt(concat(bytes, Uint8Array.of(0)), account),
    /Trailing/,
  );
  for (let n = 0; n < bytes.length; n++)
    assert.throws(() => parsePrlPsbt(bytes.slice(0, n), account));
  assert.throws(
    () => parsePrlPsbt(new Uint8Array(MAX_PSBT_BYTES + 1), account),
    /size limit/,
  );
  for (const key of [
    "07",
    "08",
    "13",
    "14" + "00".repeat(64),
    "15" + "00".repeat(33),
    "18",
    "fc00",
  ]) {
    rejectsMutation((p) => p.inputMaps[0]!.set(key, new Uint8Array()));
  }
  rejectsMutation((p) => p.inputMaps[0]!.delete("17"));
  rejectsMutation((p) => p.inputMaps[0]!.set("03", u32(1)), /DEFAULT/);
  rejectsMutation((p) => p.inputMaps[0]!.set("03", Uint8Array.of(0)));
  rejectsMutation((p) => p.inputMaps[0]!.set("0e", new Uint8Array(31)), /txid/);
  rejectsMutation(
    (p) => p.inputMaps[0]!.set("10", u32(0xfffffffd)),
    /sequence/,
  );
  rejectsMutation((p) => p.inputMaps[0]!.set("0f", new Uint8Array(5)));
  rejectsMutation((p) => p.outputMaps[0]!.set("05", new Uint8Array(32)));
});
test("origin/ownership/change metadata is fully checked against the approved public account", () => {
  for (const byte of [0, 1, 5, 9, 13, 17, 21]) {
    rejectsMutation((p) => {
      const map = p.inputMaps[0]!,
        key = [...map.keys()].find((k) => k.startsWith("16"))!;
      const value = map.get(key)!.slice();
      value[byte] = byte === 0 ? 1 : value[byte]! ^ 1;
      map.set(key, value);
    });
  }
  rejectsMutation((p) => p.inputMaps[0]!.set("17", new Uint8Array(32)));
  rejectsMutation((p) => {
    const m = p.outputMaps[1]!,
      k = [...m.keys()].find((k) => k.startsWith("07"))!;
    m.get(k)![17] = 0;
  }, /Foreign change/);
  rejectsMutation((p) => {
    const value = p.inputMaps[0]!.get("01")!.slice();
    value[10] = value[10]! ^ 1;
    p.inputMaps[0]!.set("01", value);
  });
  rejectsMutation((p) => {
    p.inputMaps[1]!.set("0e", p.inputMaps[0]!.get("0e")!);
    p.inputMaps[1]!.set("0f", p.inputMaps[0]!.get("0f")!);
  }, /Duplicate input/);
});
test("amount zero, overflow, over-spend and aggregate overflow are rejected", () => {
  for (const amount of [0n, MAX_GRAINS + 1n, 0xffffffffffffffffn])
    rejectsMutation((p) => {
      const prev = p.inputMaps[0]!.get("01")!;
      p.inputMaps[0]!.set("01", concat(u64(amount), prev.slice(8)));
    });
  rejectsMutation(
    (p) => p.outputMaps[0]!.set("03", u64(MAX_GRAINS - 1000000000n)),
    /Outputs exceed/,
  );
  rejectsMutation((p) => {
    const prev = p.inputMaps[0]!.get("01")!;
    p.inputMaps[0]!.set("01", concat(u64(MAX_GRAINS), prev.slice(8)));
  }, /Amount outside/);
});
function previous(bundle: SigningBundle) {
  return concat(
    i32(1),
    Uint8Array.of(1),
    new Uint8Array(32),
    u32(0xffffffff),
    Uint8Array.of(2, 1, 1),
    u32(0xffffffff),
    compactSize(1),
    serializeOutput(bundle.inputs[0]!),
    u32(0),
  );
}
test("raw previous transactions are byte-bounded and txid/vout/amount/script checked", () => {
  const { account } = publicFixture(),
    bundle = withAmount(9007199254740993n),
    raw = previous(bundle),
    parsed = parseTransaction(raw);
  bundle.inputs[0]!.txid = parsed.txid;
  bundle.inputs[0]!.vout = 0;
  const psbt = buildPrlPsbt(bundle, account, { previousTransactions: [raw] });
  assert.equal(hex(psbt.inputMaps[0]!.get("00")!), hex(raw));
  assert.equal(
    parsePrlPsbt(serializePrlPsbt(psbt), account).bundle.inputs[0]!.amount,
    9007199254740993n,
  );
  assert.throws(
    () => buildPrlPsbt(bundle, account, { previousTransactions: [] }),
    /count/,
  );
  assert.throws(
    () =>
      buildPrlPsbt(bundle, account, {
        previousTransactions: [new Uint8Array(MAX_PREVIOUS_TX_BYTES + 1)],
      }),
    /limit/,
  );
  const wrong = raw.slice();
  wrong[wrong.length - 5] = wrong[wrong.length - 5]! ^ 1;
  assert.throws(
    () => buildPrlPsbt(bundle, account, { previousTransactions: [wrong] }),
    /outpoint/,
  );
  bundle.inputs[0]!.amount -= 1n;
  assert.throws(
    () => buildPrlPsbt(bundle, account, { previousTransactions: [raw] }),
    /value\/script/,
  );
});
test("canonical serializer is independent of source map insertion order", () => {
  const { account, bundle } = publicFixture(),
    psbt = buildPrlPsbt(bundle, account);
  const reverse = (m: ReadonlyMap<string, Uint8Array>) =>
    new Map([...m.entries()].reverse());
  assert.deepEqual(
    serializePrlPsbt({
      globalMap: reverse(psbt.globalMap),
      inputMaps: psbt.inputMaps.map(reverse),
      outputMaps: psbt.outputMaps.map(reverse),
    }),
    serializePrlPsbt(psbt),
  );
});
