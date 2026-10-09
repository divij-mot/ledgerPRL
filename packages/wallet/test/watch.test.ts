import { test } from "node:test";
import assert from "node:assert/strict";
import { deriveAddress, MAX_GRAINS } from "@pearl-ledger/sdk";
import {
  parseWatchSnapshot,
  balances,
  preparePayment,
  outpoint,
  coinEligibility,
  emptyJournal,
  reservePayment,
  transitionPayment,
  discardDraft,
  reservedOutpoints,
  applyValidation,
  requireFreshValidation,
} from "../src/index.js";
import {
  publicAccount,
  rawTransaction,
  snapshotFixture,
  blockHash,
} from "./fixtures.js";
const parse = () => parseWatchSnapshot(JSON.stringify(snapshotFixture()));
const request = (coin = parse().coins[0]!) => ({
  selected: [outpoint(coin)],
  recipient: deriveAddress(publicAccount, 0, 8).address,
  amountPrl: "1",
  feePrl: "0.00001000",
  changeIndex: 20,
});
test("raw prevout amounts stay exact above Number precision", () => {
  const snap = parseWatchSnapshot(
    JSON.stringify(snapshotFixture([rawTransaction(20_000_000_000_000_001n)])),
  );
  assert.equal(snap.coins[0]!.amount, 20_000_000_000_000_001n);
});
test("rejects txid substitution, path substitution, duplicate outputs and wrong genesis", () => {
  for (const change of [
    (s: any) => (s.coins[0].txid = "ff".repeat(32)),
    (s: any) => (s.coins[0].index = 1),
    (s: any) => s.coins.push(s.coins[0]),
    (s: any) => (s.genesisHash = "00".repeat(32)),
    (s: any) => (s.account.seed = "not-accepted"),
  ]) {
    const v = snapshotFixture();
    change(v);
    assert.throws(() => parseWatchSnapshot(JSON.stringify(v)));
  }
});
test("coinbase maturity separates 99 and 100 confirmations exactly", () => {
  const immature = parseWatchSnapshot(
    JSON.stringify(snapshotFixture([rawTransaction()], 99)),
  );
  assert.equal(balances(immature).immature, 500_000_000n);
  assert.equal(balances(immature).available, 0n);
  const mature = parseWatchSnapshot(
    JSON.stringify(snapshotFixture([rawTransaction()], 100)),
  );
  assert.equal(balances(mature).available, 500_000_000n);
});
test("coin selection excludes immature, reserved, duplicated and unknown inputs", () => {
  const snap = parse();
  assert.throws(
    () => preparePayment(snap, request(), new Set(request().selected)),
    /reserved/,
  );
  assert.throws(() =>
    preparePayment(snap, {
      ...request(),
      selected: [...request().selected, ...request().selected],
    }),
  );
  assert.throws(
    () =>
      preparePayment(
        { ...snap, tip: { height: 30, hash: blockHash(30) } },
        request(),
      ),
    /immature/,
  );
  assert.throws(() =>
    preparePayment(snap, { ...request(), selected: ["unknown"] }),
  );
});
test("builds exact recipient, fee and reproducible change; rejects dust and exponent numbers", () => {
  const bundle = preparePayment(parse(), request());
  assert.equal(bundle.outputs[0]!.amount, 100_000_000n);
  assert.equal(bundle.outputs[1]!.amount, 399_999_000n);
  assert.equal(bundle.outputs[1]!.index, 20);
  assert.throws(() =>
    preparePayment(parse(), { ...request(), amountPrl: "1e0" }),
  );
  assert.throws(
    () => preparePayment(parse(), { ...request(), amountPrl: "4.99998999" }),
    /dust/,
  );
  assert.throws(
    () => preparePayment(parse(), { ...request(), amountPrl: "0.00000001" }),
    /dust/,
  );
});
test("reservations and change high-water survive draft cancellation; signed attempts stay locked", () => {
  const bundle = preparePayment(parse(), request()),
    journal = emptyJournal();
  reservePayment(journal, bundle, "payment-one");
  assert.throws(
    () => reservePayment(journal, bundle, "payment-two"),
    /reserved/,
  );
  assert.equal(journal.nextChangeIndex, 21);
  discardDraft(journal, "payment-one");
  assert.equal(journal.nextChangeIndex, 21);
  assert.throws(
    () => reservePayment(journal, bundle, "payment-two"),
    /Change index/,
  );
  bundle.outputs[1]!.index = 21;
  reservePayment(journal, bundle, "payment-three");
  transitionPayment(journal, "payment-three", "signing");
  assert.throws(
    () => discardDraft(journal, "payment-three"),
    /cannot be released/,
  );
  assert.equal(reservedOutpoints(journal).size, 1);
});
test("reorg validation removes detached coins and never releases journal reservations", () => {
  const snap = parse(),
    j = emptyJournal();
  reservePayment(j, preparePayment(snap, request()), "payment-one");
  const result = applyValidation(snap, {
    network: "regtest",
    genesisHash: snap.genesisHash,
    tip: { height: 199, hash: blockHash(999) },
    checkedAt: 1000,
    coins: [{ outpoint: outpoint(snap.coins[0]!), state: "reorged" }],
  });
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(reservedOutpoints(j).size, 1);
});
test("signing gate rejects stale, missing, mismatched and immature node data", () => {
  const snap = parse(),
    bundle = preparePayment(snap, request());
  const result = applyValidation(snap, {
    network: "regtest",
    genesisHash: snap.genesisHash,
    tip: snap.tip,
    checkedAt: 1_000,
    coins: [
      {
        outpoint: outpoint(snap.coins[0]!),
        state: "unspent",
        grains: "500000000",
        scriptPubKey: Buffer.from(snap.coins[0]!.scriptPubKey).toString("hex"),
        block: snap.coins[0]!.block,
        coinbase: true,
        confirmations: 200,
      },
    ],
  });
  assert.doesNotThrow(() =>
    requireFreshValidation(result.snapshot, result.validation, bundle, 2_000),
  );
  assert.throws(
    () =>
      requireFreshValidation(
        result.snapshot,
        result.validation,
        bundle,
        62_000,
      ),
    /expired/,
  );
  assert.throws(() => requireFreshValidation(snap, null, bundle), /node/);
  result.validation.coins[0]!.grains = "600000000";
  assert.throws(
    () =>
      requireFreshValidation(result.snapshot, result.validation, bundle, 2_000),
    /verified/,
  );
});
