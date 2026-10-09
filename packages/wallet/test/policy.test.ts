import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountFromJson,
  decodeBundle,
  fromHex,
  deriveAddress,
  formatPrl,
  parsePrl,
  serializeUnsignedTransaction,
  concat,
  finalizeTransaction,
  MAX_GRAINS,
} from "@pearl-ledger/sdk";
import {
  assertPaymentPolicy,
  inspectPaymentPolicy,
  minimumRelayFee,
  DEFAULT_DUST_GRAINS,
  parseWatchSnapshot,
  preparePayment,
  previewPaymentPolicy,
  outpoint,
} from "../src/index.js";
import { publicAccount, rawTransaction, snapshotFixture } from "./fixtures.js";
const vector = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
function request(inputs: number, outputs: number, fee: bigint) {
  const snapshot = parseWatchSnapshot(
    JSON.stringify(
      snapshotFixture(
        Array.from({ length: inputs }, (_, index) =>
          rawTransaction(500000000n, index, false),
        ),
      ),
    ),
  );
  const amount = outputs === 1 ? BigInt(inputs) * 500000000n - fee : 100000000n;
  return {
    snapshot,
    request: {
      selected: snapshot.coins.map(outpoint),
      recipient: deriveAddress(publicAccount, 0, 18).address,
      amountPrl: formatPrl(amount),
      feePrl: formatPrl(fee),
      changeIndex: 20,
    },
  };
}
for (let inputs = 1; inputs <= 16; inputs++)
  for (const outputs of [1, 2])
    test(`exact signed size and explicit relay floor for ${inputs} inputs / ${outputs} outputs`, () => {
      const expected =
        10 + 41 * inputs + 43 * outputs + Math.ceil((2 + 66 * inputs) / 4);
      const fixture = request(inputs, outputs, BigInt(expected));
      const before = structuredClone(fixture.request);
      const bundle = preparePayment(fixture.snapshot, fixture.request);
      const policy = assertPaymentPolicy(bundle);
      assert.equal(policy.vsize, expected);
      assert.equal(policy.minimumFee, BigInt(expected));
      assert.equal(policy.fee, BigInt(expected));
      assert.equal(policy.outputCount, outputs);
      assert.deepEqual(
        fixture.request,
        before,
        "No repricing or amount mutation",
      );
      // Serialization-only dummy witnesses establish byte size, not valid signatures.
      const stripped = serializeUnsignedTransaction(bundle);
      const sized = concat(
        stripped.slice(0, 4),
        Uint8Array.of(0, 1),
        stripped.slice(4, -4),
        ...bundle.inputs.map(() =>
          concat(Uint8Array.of(1, 64), new Uint8Array(64)),
        ),
        stripped.slice(-4),
      );
      assert.equal(
        policy.vsize,
        Math.ceil((stripped.length * 3 + sized.length) / 4),
      );
      const low = request(inputs, outputs, BigInt(expected - 1));
      assert.throws(
        () => preparePayment(low.snapshot, low.request),
        /Fee below declared relay policy/,
      );
    });
test("default1000 grains fails for16 inputs with change, while preview preserves it", () => {
  const { snapshot, request: r } = request(16, 2, 1000n);
  const before = structuredClone(r);
  assert.deepEqual(previewPaymentPolicy(snapshot, r), {
    inputCount: 16,
    outputCount: 2,
    vsize: 1017,
    fee: 1000n,
    minimumFee: 1017n,
    dustThreshold: 333n,
  });
  assert.throws(
    () => preparePayment(snapshot, r),
    /1017.*0\.00001017|0\.00001017.*1017/,
  );
  assert.deepEqual(r, before);
  r.amountPrl = formatPrl(8000000000n - 1000n);
  assert.equal(previewPaymentPolicy(snapshot, r).vsize, 974);
  assert.equal(preparePayment(snapshot, r).outputs.length, 1);
  r.amountPrl = formatPrl(8000000000n - 1000n - 332n);
  assert.equal(previewPaymentPolicy(snapshot, r).outputCount, 2);
  assert.throws(() => preparePayment(snapshot, r));
});
test("genuine frozen signed fixture size agrees with the independent finalizer", () => {
  const bundle = decodeBundle(fromHex(vector.bundleHex));
  const signed = finalizeTransaction(bundle, vector.signatures.map(fromHex));
  assert.equal(inspectPaymentPolicy(bundle).vsize, signed.vsize);
});
test("configurable declared rates preserve upstream integer floor, fallback and cap", () => {
  for (const rate of [0n, 1n, 2n, 9n, 999n, 1000n, 2000n, 2001n]) {
    const scaled = (154n * rate) / 1000n;
    assert.equal(
      minimumRelayFee(154, { minRelayFeeGrainsPerKvB: rate }),
      scaled === 0n && rate > 0n ? rate : scaled,
    );
  }
  assert.equal(
    minimumRelayFee(1017, { minRelayFeeGrainsPerKvB: MAX_GRAINS }),
    MAX_GRAINS,
  );
  assert.throws(() => minimumRelayFee(0));
  assert.throws(() => minimumRelayFee(154, { minRelayFeeGrainsPerKvB: -1n }));
  const f = request(16, 2, 1017n),
    bundle = preparePayment(f.snapshot, f.request);
  assert.throws(
    () => assertPaymentPolicy(bundle, { minRelayFeeGrainsPerKvB: 2000n }),
    /2034/,
  );
});
test("P2TR dust follows the pinned witness policy at default and configured rates", () => {
  assert.equal(DEFAULT_DUST_GRAINS, 333n);
  for (const [rate, threshold] of [
    [1000n, 333n],
    [2000n, 666n],
    [1001n, 334n],
  ] as const) {
    for (const role of ["recipient", "change"] as const) {
      const { snapshot, request: r } = request(1, 2, 1000n);
      const bundle = preparePayment(snapshot, r);
      const output = bundle.outputs.find((o) => o.role === role)!;
      const other = bundle.outputs.find((o) => o !== output)!;
      other.amount += output.amount - threshold;
      output.amount = threshold;
      assert.equal(
        assertPaymentPolicy(bundle, { minRelayFeeGrainsPerKvB: rate })
          .dustThreshold,
        threshold,
      );
      output.amount--;
      other.amount++;
      assert.throws(
        () => assertPaymentPolicy(bundle, { minRelayFeeGrainsPerKvB: rate }),
        /dust/,
      );
    }
  }
});
test("policy checks keep exact values above Number precision and do not mutate drafts", () => {
  const bundle = decodeBundle(fromHex(vector.bundleHex));
  const before = structuredClone(bundle);
  assert(bundle.inputs[0]!.amount > BigInt(Number.MAX_SAFE_INTEGER));
  assert.equal(assertPaymentPolicy(bundle).fee, 1000n);
  assert.deepEqual(bundle, before);
  assert.equal(
    parsePrl(formatPrl(bundle.inputs[0]!.amount)),
    bundle.inputs[0]!.amount,
  );
  assert(accountFromJson(vector.publicAccount));
});
