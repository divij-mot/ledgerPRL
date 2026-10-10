import test from "node:test";
import assert from "node:assert/strict";
import { deriveAddress, NETWORKS, parsePrl } from "@pearl-ledger/sdk";
import {
  outpoint,
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
