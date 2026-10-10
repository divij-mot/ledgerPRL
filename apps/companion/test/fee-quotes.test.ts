import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAddress,
  formatPrl,
  MAX_GRAINS,
  NETWORKS,
  parsePrl,
} from "@pearl-ledger/sdk";
import {
  outpoint,
  preparePayment,
  parseWatchSnapshot,
  previewPaymentPolicy,
  type PaymentRequest,
} from "@pearl-ledger/wallet";
import {
  rawTransaction,
  snapshotFixture,
} from "../../../packages/wallet/test/fixtures.js";
import { BlockbookSource } from "../src/blockbook-source.js";
import { browserPublicSource } from "../src/public-source.js";
import {
  FEE_QUOTE_LIFETIME_MS,
  loadFeeQuotes,
  parseFeeQuote,
  quotedPayment,
  quoteRate,
  paymentAtRate,
  maximumPaymentAtRate,
  confirmationTime,
} from "../src/fee-quotes.js";

const watch = (amounts: bigint[]) =>
  parseWatchSnapshot(
    JSON.stringify(
      snapshotFixture(
        amounts.map((amount, i) => rawTransaction(amount, i)),
        200,
        "mainnet",
      ),
    ),
  );
const request = (
  snapshot: ReturnType<typeof watch>,
  amountPrl = "0.00008000",
): PaymentRequest => ({
  selected: [outpoint(snapshot.coins[0]!)],
  recipient: deriveAddress(snapshot.account, 0, 7).address,
  amountPrl,
  feePrl: "0.00001000",
  changeIndex: 0,
});

test("confirmation labels approximate the pinned 194-second block target", () => {
  assert.equal(confirmationTime(1), "≈3 min");
  assert.equal(confirmationTime(10), "≈32 min");
  assert.equal(confirmationTime(25), "≈1 h 21 min");
  for (const target of [0, -1, 2, 1.5, Infinity, NaN])
    assert.throws(() => confirmationTime(target as 1), /Unsupported/);
});

test("fee estimates require exact positive PRL/kvB strings and never float-convert", () => {
  assert.equal(
    parseFeeQuote({ result: "90071992.54740993" }, 1, "mainnet").grainsPerKvB,
    9_007_199_254_740_993n,
  );
  for (const result of [
    -1,
    1,
    0.00001,
    "-1",
    "0",
    "0.00000001",
    "1e-5",
    "NaN",
    "0.000010001",
    null,
    " 0.00001",
    "0.00001 ",
  ])
    assert.throws(() => parseFeeQuote({ result }, 1, "mainnet"));
  assert.throws(() =>
    parseFeeQuote({ result: "0.00001", other: true }, 1, "mainnet"),
  );
});

test("quote rate validation is independent of selected inputs and enforces network, target, time and rate bounds", () => {
  const quote = parseFeeQuote({ result: "0.00001001" }, 10, "mainnet", 1000);
  assert.equal(
    quoteRate(quote, "mainnet", 1000 + FEE_QUOTE_LIFETIME_MS),
    1001n,
  );
  assert.throws(() => quoteRate(quote, "testnet2", 1000), /network/);
  for (const now of [999, 1001 + FEE_QUOTE_LIFETIME_MS, NaN, 1000.5])
    assert.throws(() => quoteRate(quote, "mainnet", now), /expired/);
  assert.throws(
    () => quoteRate({ ...quote, blocks: 2 as 10 }, "mainnet", 1000),
    /unavailable/,
  );
  for (const grainsPerKvB of [999n, MAX_GRAINS + 1n, 1000 as unknown as bigint])
    assert.throws(() => quoteRate({ ...quote, grainsPerKvB }, "mainnet", 1000));
});

test("explicit quote uses upward whole-grain rounding and recalculates added input size without mutating amount or fee", () => {
  const snapshot = watch([10_000n, 9_000n]),
    original = request(snapshot),
    copy = structuredClone(original);
  const quote = parseFeeQuote({ result: "0.00020000" }, 10, "mainnet", 1000);
  const selected = quotedPayment(
    snapshot,
    original,
    new Set(),
    quote,
    false,
    1000,
  );
  assert.equal(selected.selected.length, 2);
  assert.equal(selected.feePrl, "0.00004240");
  assert.equal(previewPaymentPolicy(snapshot, selected).vsize, 212);
  assert.equal(selected.amountPrl, original.amountPrl);
  assert.deepEqual(original, copy);
  const rounded = quotedPayment(
    snapshot,
    original,
    new Set(),
    parseFeeQuote({ result: "0.00001001" }, 1, "mainnet", 1000),
    false,
    1000,
  );
  assert.equal(parsePrl(rounded.feePrl), 155n);
});

test("expired, future, wrong-network or newly reserved quote application fails without changing input", () => {
  const snapshot = watch([10_000n]),
    original = request(snapshot),
    copy = structuredClone(original);
  const quote = parseFeeQuote({ result: "0.00001000" }, 1, "mainnet", 1000);
  assert.throws(
    () =>
      quotedPayment(
        snapshot,
        original,
        new Set(),
        quote,
        false,
        1001 + FEE_QUOTE_LIFETIME_MS,
      ),
    /expired/,
  );
  assert.throws(
    () => quotedPayment(snapshot, original, new Set(), quote, false, 999),
    /expired/,
  );
  assert.throws(
    () =>
      quotedPayment(
        snapshot,
        original,
        new Set(),
        { ...quote, network: "testnet2" },
        false,
        1000,
      ),
    /network/,
  );
  assert.throws(
    () =>
      quotedPayment(
        snapshot,
        original,
        new Set(original.selected),
        quote,
        false,
        1000,
      ),
    /reserved/,
  );
  assert.deepEqual(original, copy);
});

test("automatic rate ignores an obsolete total fee and recomputes extra input size without changing amount", () => {
  const snapshot = watch([10_000n, 9_000n]),
    original = request(snapshot),
    before = structuredClone(original);
  original.feePrl = "1.00000000";
  before.feePrl = original.feePrl;
  const next = paymentAtRate(snapshot, original, new Set(), 20_000n, false);
  assert.equal(next.selected.length, 2);
  assert.equal(next.feePrl, "0.00004240");
  assert.equal(next.amountPrl, original.amountPrl);
  assert.equal(previewPaymentPolicy(snapshot, next).vsize, 212);
  preparePayment(snapshot, next);
  assert.deepEqual(original, before);
});

test("automatic rate recognizes exact no-change fee without a change/no-change oscillation", () => {
  const snapshot = watch([10_000n]),
    original = request(snapshot, "0.00009889");
  const next = paymentAtRate(snapshot, original, new Set(), 1000n, false);
  assert.equal(next.feePrl, "0.00000111");
  assert.equal(next.amountPrl, original.amountPrl);
  assert.equal(previewPaymentPolicy(snapshot, next).vsize, 111);
  assert.equal(preparePayment(snapshot, next).outputs.length, 1);
});

test("dust change requires another input or explicit Max, never silent dust-to-fee absorption", () => {
  const snapshot = watch([10_000n, 500n]),
    original = request(snapshot, "0.00009700"),
    before = structuredClone(original);
  assert.throws(
    () => paymentAtRate(snapshot, original, new Set(), 1000n, true),
    /change is too small/,
  );
  const next = paymentAtRate(snapshot, original, new Set(), 1000n, false);
  assert.equal(next.selected.length, 2);
  assert.equal(next.feePrl, "0.00000212");
  assert.equal(next.amountPrl, original.amountPrl);
  assert.equal(preparePayment(snapshot, next).outputs[1]!.amount, 588n);
  const lone = watch([10_000n]);
  assert.throws(
    () =>
      paymentAtRate(lone, request(lone, "0.00009700"), new Set(), 1000n, false),
    /change is too small/,
  );
  assert.deepEqual(original, before);
});

test("manual input order is retained and returned selection never aliases caller state", () => {
  const snapshot = watch([10_000n, 9_000n]),
    original = request(snapshot);
  original.selected = snapshot.coins.map(outpoint).reverse();
  const before = structuredClone(original);
  const next = paymentAtRate(snapshot, original, new Set(), 1001n, true);
  assert.deepEqual(next.selected, before.selected);
  assert.equal(parsePrl(next.feePrl), 213n);
  next.selected.pop();
  assert.deepEqual(original, before);
});

test("Max at rate uses exact no-change size, preserves manual input constraints and never mutates request", () => {
  const snapshot = watch([10_000n, 9_000n]),
    original = request(snapshot),
    before = structuredClone(original);
  const next = maximumPaymentAtRate(snapshot, original, new Set(), 1001n);
  assert.equal(next.selected.length, 2);
  assert.equal(next.feePrl, "0.00000170");
  assert.equal(next.amountPrl, "0.00018830");
  assert.equal(previewPaymentPolicy(snapshot, next).vsize, 169);
  assert.equal(preparePayment(snapshot, next).outputs.length, 1);
  const selected = [outpoint(snapshot.coins[1]!)];
  const manual = maximumPaymentAtRate(
    snapshot,
    original,
    new Set(),
    1000n,
    selected,
  );
  assert.deepEqual(manual.selected, selected);
  assert.equal(manual.feePrl, "0.00000111");
  assert.equal(manual.amountPrl, "0.00008889");
  manual.selected.pop();
  assert.equal(selected.length, 1);
  assert.deepEqual(original, before);
});

test("rates above Number precision retain exact grain ceilings for payment and Max", () => {
  const snapshot = watch([MAX_GRAINS]),
    original = request(snapshot, "1.00000000"),
    rate = 9_007_199_254_740_993n;
  const next = paymentAtRate(snapshot, original, new Set(), rate, false);
  assert.equal(parsePrl(next.feePrl), 1_387_108_685_230_113n);
  const maximum = maximumPaymentAtRate(snapshot, original, new Set(), rate);
  assert.equal(parsePrl(maximum.feePrl), 999_799_117_276_251n);
  assert.equal(parsePrl(maximum.amountPrl), MAX_GRAINS - 999_799_117_276_251n);
});

test("automatic Max omits an uneconomic extra input while manual Max honors it", () => {
  const snapshot = watch([10_000n, 1n]),
    original = request(snapshot);
  const next = maximumPaymentAtRate(snapshot, original, new Set(), 1000n);
  assert.equal(next.selected.length, 1);
  assert.equal(next.amountPrl, "0.00009889");
  const manual = maximumPaymentAtRate(
    snapshot,
    original,
    new Set(),
    1000n,
    snapshot.coins.map(outpoint),
  );
  assert.equal(manual.selected.length, 2);
  assert.equal(manual.amountPrl, "0.00009832");
});

test("a valid maximum-rate no-change payment does not evaluate an overflowing change fee", () => {
  const snapshot = watch(Array.from({ length: 16 }, () => MAX_GRAINS / 16n));
  const original = request(snapshot, formatPrl(54_600_000_000_000_000n));
  const next = paymentAtRate(snapshot, original, new Set(), MAX_GRAINS, false);
  assert.equal(next.selected.length, 16);
  assert.equal(parsePrl(next.feePrl), 2_045_400_000_000_000_000n);
  assert.equal(preparePayment(snapshot, next).outputs.length, 1);
});

test("current reservations and immature coins are excluded automatically and rejected when selected manually", () => {
  const snapshot = watch([10_000n, 9_000n]),
    original = request(snapshot),
    reserved = new Set(original.selected);
  const next = paymentAtRate(snapshot, original, reserved, 1000n, false);
  assert.deepEqual(next.selected, [outpoint(snapshot.coins[1]!)]);
  assert.throws(
    () => paymentAtRate(snapshot, original, reserved, 1000n, true),
    /reserved/,
  );
  assert.throws(
    () =>
      maximumPaymentAtRate(
        snapshot,
        original,
        reserved,
        1000n,
        original.selected,
      ),
    /reserved/,
  );
  assert.deepEqual(
    maximumPaymentAtRate(snapshot, original, reserved, 1000n).selected,
    next.selected,
  );
  for (const block of [null, { height: 200, hash: snapshot.tip.hash }]) {
    const changed = structuredClone(snapshot);
    changed.coins.forEach((coin) => {
      coin.block = block;
    });
    assert.throws(
      () => paymentAtRate(changed, original, new Set(), 1000n, false),
      /available/,
    );
    assert.throws(
      () =>
        maximumPaymentAtRate(
          changed,
          original,
          new Set(),
          1000n,
          original.selected,
        ),
      /immature|unconfirmed/,
    );
  }
});

test("invalid rates, dust recipients, insufficient Max and input limits fail closed", () => {
  const snapshot = watch([10_000n]),
    original = request(snapshot);
  for (const rate of [
    0n,
    -1n,
    999n,
    MAX_GRAINS + 1n,
    1000 as unknown as bigint,
  ]) {
    assert.throws(() =>
      paymentAtRate(snapshot, original, new Set(), rate, false),
    );
    assert.throws(() =>
      maximumPaymentAtRate(snapshot, original, new Set(), rate),
    );
  }
  assert.throws(
    () =>
      paymentAtRate(
        snapshot,
        { ...original, amountPrl: "0.00000332" },
        new Set(),
        1000n,
        false,
      ),
    /dust/,
  );
  const tiny = watch([400n]);
  assert.throws(
    () => maximumPaymentAtRate(tiny, request(tiny), new Set(), 1000n),
    /dust/,
  );
  const smaller = watch([100n]);
  assert.throws(
    () => maximumPaymentAtRate(smaller, request(smaller), new Set(), 1000n),
    /exceed the fee/,
  );
  const many = watch(Array.from({ length: 17 }, () => 1000n)),
    all = many.coins.map(outpoint);
  assert.throws(
    () =>
      paymentAtRate(
        many,
        { ...request(many, formatPrl(17_000n)), selected: all },
        new Set(),
        1000n,
        false,
      ),
    /16 inputs/,
  );
  assert.throws(
    () =>
      paymentAtRate(
        many,
        { ...request(many), selected: all },
        new Set(),
        1000n,
        true,
      ),
    /1–16/,
  );
  assert.throws(
    () => maximumPaymentAtRate(many, request(many), new Set(), 1000n, all),
    /1–16/,
  );
  assert.equal(
    maximumPaymentAtRate(many, request(many), new Set(), 1000n).selected.length,
    16,
  );
  assert.throws(
    () =>
      paymentAtRate(
        snapshot,
        { ...original, selected: [...original.selected, ...original.selected] },
        new Set(),
        1000n,
        true,
      ),
    /distinct/,
  );
  assert.throws(
    () => maximumPaymentAtRate(snapshot, original, new Set(), 1000n, []),
    /1–16/,
  );
});

test("fee loading checks pinned chain before exact targets and treats malformed/failed targets as unavailable", async () => {
  const calls: string[] = [];
  const source = new BlockbookSource("mainnet", async (input, init) => {
    assert.equal(init?.redirect, "error");
    const path = new URL(String(input)).pathname;
    calls.push(path);
    let body: unknown;
    if (path === "/api/v2/")
      body = {
        blockbook: {
          inSync: true,
          initialSync: false,
          inSyncMempool: true,
          bestHeight: 200,
          decimals: 8,
        },
        backend: {
          chain: "mainnet",
          blocks: 200,
          bestBlockHash: "aa".repeat(32),
        },
      };
    else if (path === "/api/v2/block-index/0")
      body = { blockHash: NETWORKS.mainnet.genesisHash };
    else if (path === "/api/v2/block-index/200")
      body = { blockHash: "aa".repeat(32) };
    else if (path === "/api/v1/estimatefee/1") body = { result: "0.00001000" };
    else if (path === "/api/v1/estimatefee/10") body = { result: "-1" };
    else {
      assert.equal(path, "/api/v1/estimatefee/25");
      throw new Error("unavailable");
    }
    return new Response(JSON.stringify(body));
  });
  const quotes = await loadFeeQuotes(source);
  assert.deepEqual(
    quotes.map((q) => q.blocks),
    [1],
  );
  assert.deepEqual(calls, [
    "/api/v2/",
    "/api/v2/block-index/200",
    "/api/v2/block-index/0",
    "/api/v1/estimatefee/1",
    "/api/v1/estimatefee/10",
    "/api/v1/estimatefee/25",
  ]);
});

test("public quote paths remain exact, read-only and bounded to 1 KiB through the actual browser proxy boundary", async () => {
  const originalFetch = globalThis.fetch,
    paths: string[] = [];
  globalThis.fetch = async (input, init) => {
    assert.equal(input, "/api/indexer/read");
    const body = JSON.parse(String(init?.body));
    assert.deepEqual(Object.keys(body).sort(), ["consent", "network", "path"]);
    assert.equal(body.network, "mainnet");
    paths.push(body.path);
    return new Response(JSON.stringify({ result: "0.00001000" }));
  };
  try {
    const source = browserPublicSource("mainnet", true);
    for (const target of [1, 10, 25])
      await source.get(`/api/v1/estimatefee/${target}`);
    for (const path of [
      "/api/v1/estimatefee/2",
      "/api/v1/estimatefee/01",
      "/api/v1/estimatefee/1?x=1",
      "/api/v1/estimatefee/1/",
      "/api/v1/estimatefee/1\n",
      "/api/v2/estimatefee/1",
      "/api/v1/sendtx/00",
    ])
      await assert.rejects(source.get(path), /Unsupported/);
    assert.equal(paths.length, 3);
    globalThis.fetch = async () => new Response("x".repeat(1025));
    await assert.rejects(source.get("/api/v1/estimatefee/1"), /large|limit/i);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
