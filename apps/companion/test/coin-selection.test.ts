import test from "node:test";
import assert from "node:assert/strict";
import { deriveAddress, formatPrl } from "@pearl-ledger/sdk";
import {
  DEFAULT_DUST_GRAINS,
  outpoint,
  parseWatchSnapshot,
  preparePayment,
} from "@pearl-ledger/wallet";
import {
  publicAccount,
  rawTransaction,
  snapshotFixture,
} from "../../../packages/wallet/test/fixtures.js";
import {
  selectPaymentInputs,
  maximumPayment,
} from "../src/coin-selection.js";

const watch = (values: bigint[]) =>
  parseWatchSnapshot(
    JSON.stringify(
      snapshotFixture(
        values.map((amount, index) => rawTransaction(amount, index)),
      ),
    ),
  );

test("automatic selection uses eligible unlocked inputs deterministically and preserves the exact amount and fee", () => {
  const snapshot = watch([100_000n, 500_000n, 500_000n]);
  const reserved = new Set([outpoint(snapshot.coins[1]!)]);
  const selected = selectPaymentInputs(snapshot, "0.004", "0.00001", reserved);
  assert.deepEqual(selected, [outpoint(snapshot.coins[2]!)]);
  const bundle = preparePayment(
    snapshot,
    {
      selected,
      recipient: deriveAddress(publicAccount, 0, 7).address,
      amountPrl: "0.004",
      feePrl: "0.00001",
      changeIndex: 0,
    },
    reserved,
  );
  assert.equal(
    bundle.outputs.find((o) => o.role === "recipient")?.amount,
    400_000n,
  );
  assert.equal(
    bundle.inputs.reduce((s, i) => s + i.amount, 0n) -
      bundle.outputs.reduce((s, o) => s + o.amount, 0n),
    1_000n,
  );
  assert.deepEqual(
    selectPaymentInputs(
      { ...snapshot, coins: snapshot.coins.slice().reverse() },
      "0.004",
      "0.00001",
      reserved,
    ),
    selected,
  );
});

test("automatic selection handles exact spends and avoids dust without silently donating change", () => {
  const snapshot = watch([10_000n, 5_000n]);
  assert.equal(
    selectPaymentInputs(snapshot, "0.00009", "0.00001", new Set()).length,
    1,
  );
  assert.equal(
    selectPaymentInputs(
      snapshot,
      formatPrl(9_000n - DEFAULT_DUST_GRAINS + 1n),
      "0.00001",
      new Set(),
    ).length,
    2,
  );
  assert.throws(
    () =>
      selectPaymentInputs(watch([10_000n]), "0.00008999", "0.00001", new Set()),
    /remaining change is too small/,
  );
});

test("automatic selection excludes immature, pending and reserved outputs and caps input count", () => {
  const snapshot = watch([100_000n]);
  assert.throws(
    () => selectPaymentInputs(snapshot, "0.001", "0.00001", new Set()),
    /Insufficient/,
  );
  assert.throws(
    () =>
      selectPaymentInputs(
        { ...snapshot, tip: { ...snapshot.tip, height: 20 } },
        "0.0001",
        "0.00001",
        new Set(),
      ),
    /Insufficient/,
  );
  assert.throws(
    () =>
      selectPaymentInputs(
        {
          ...snapshot,
          coins: snapshot.coins.map((c) => ({ ...c, block: null })),
        },
        "0.0001",
        "0.00001",
        new Set(),
      ),
    /Insufficient/,
  );
  assert.throws(
    () =>
      selectPaymentInputs(
        snapshot,
        "0.0001",
        "0.00001",
        new Set(snapshot.coins.map(outpoint)),
      ),
    /Insufficient/,
  );
  assert.throws(
    () =>
      selectPaymentInputs(
        watch(Array.from({ length: 17 }, () => 10_000n)),
        "0.00165",
        "0.00001",
        new Set(),
      ),
    /more than 16 inputs/,
  );
});

const maxRequest = (
  snapshot: ReturnType<typeof watch>,
  feePrl = "0.00001000",
) => ({
  recipient: deriveAddress(snapshot.account, 0, 7).address,
  feePrl,
  changeIndex: 0,
});
test("Max preserves grain precision above 2^53 and spends without change at the exact entered fee", () => {
  const snapshot = watch([9_007_199_254_740_993n, 7_000n]);
  const request = maxRequest(snapshot),
    original = { ...request };
  const maximum = maximumPayment(snapshot, request, new Set());
  assert.equal(maximum.amountPrl, formatPrl(9_007_199_254_746_993n));
  assert.deepEqual(request, original);
  const bundle = preparePayment(snapshot, maximum);
  assert.equal(bundle.outputs.length, 1);
  assert.equal(
    bundle.inputs.reduce((total, coin) => total + coin.amount, 0n) -
      bundle.outputs[0]!.amount,
    1_000n,
  );
});
test("Max excludes reservations, immature rewards and pending coins; manual selection never silently drops them", () => {
  const snapshot = watch([10_000n, 20_000n, 30_000n, 40_000n]);
  snapshot.coins[0]!.block = { ...snapshot.tip };
  snapshot.coins[2]!.block = null;
  const reserved = new Set([outpoint(snapshot.coins[1]!)]);
  const maximum = maximumPayment(snapshot, maxRequest(snapshot), reserved);
  assert.deepEqual(maximum.selected, [outpoint(snapshot.coins[3]!)]);
  assert.equal(maximum.amountPrl, "0.00039000");
  for (const index of [0, 1, 2])
    assert.throws(
      () =>
        maximumPayment(snapshot, maxRequest(snapshot), reserved, [
          outpoint(snapshot.coins[index]!),
        ]),
      /reserved|immature/,
    );
});
test("Max caps automatic inputs at 16 and honors an explicit smaller selection", () => {
  const snapshot = watch(
    Array.from({ length: 17 }, (_, i) => 10_000n + BigInt(i)),
  );
  const maximum = maximumPayment(snapshot, maxRequest(snapshot), new Set());
  assert.equal(maximum.selected.length, 16);
  assert(!maximum.selected.includes(outpoint(snapshot.coins[0]!)));
  const selected = [outpoint(snapshot.coins[0]!), outpoint(snapshot.coins[1]!)];
  const manual = maximumPayment(
    snapshot,
    maxRequest(snapshot),
    new Set(),
    selected,
  );
  assert.deepEqual(manual.selected, selected);
  assert.equal(manual.amountPrl, "0.00019001");
  assert.throws(
    () =>
      maximumPayment(
        snapshot,
        maxRequest(snapshot),
        new Set(),
        snapshot.coins.map(outpoint),
      ),
    /1–16/,
  );
});
test("Max enforces recipient dust, positive minimum fee and distinct inputs without changing authorization", () => {
  const dust = watch([1_000n + DEFAULT_DUST_GRAINS - 1n]);
  assert.throws(
    () => maximumPayment(dust, maxRequest(dust), new Set()),
    /dust/,
  );
  const threshold = watch([1_000n + DEFAULT_DUST_GRAINS]);
  assert.equal(
    maximumPayment(threshold, maxRequest(threshold), new Set()).amountPrl,
    formatPrl(DEFAULT_DUST_GRAINS),
  );
  const snapshot = watch([10_000n]);
  assert.throws(
    () =>
      maximumPayment(snapshot, maxRequest(snapshot, "0.00000001"), new Set()),
    /Fee below/,
  );
  assert.throws(
    () =>
      maximumPayment(snapshot, maxRequest(snapshot, "0.00010000"), new Set()),
    /must exceed/,
  );
  const id = outpoint(snapshot.coins[0]!);
  assert.throws(
    () => maximumPayment(snapshot, maxRequest(snapshot), new Set(), [id, id]),
    /distinct|1–16/,
  );
});
