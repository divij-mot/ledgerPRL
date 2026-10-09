/** Independent offline adversarial checks. All fetch responses are local mocks. */
import test from "node:test";
import assert from "node:assert/strict";
import { BlockbookSource } from "../../apps/companion/src/blockbook-source.js";
import { NETWORKS } from "../../packages/sdk/src/network.js";

const address =
  "prl1pdmqd2wzd3e2unrkvq880t24acsrf8zffzqjqr356pmd93cve9eqs4u7tjx";
const txid = (n: number) => n.toString(16).padStart(64, "0");
const reply = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });
const fake =
  (fn: (url: URL) => unknown): typeof fetch =>
  async (input, init) => {
    assert.equal(init?.redirect, "error");
    assert.equal(init?.method ?? "GET", "GET");
    const url = new URL(String(input));
    assert.equal(url.origin, "https://blockbook.pearlresearch.ai");
    return reply(fn(url));
  };

test("independent identity matrix rejects each incompatible or unsynced claim", async () => {
  const mutations: Array<[string, (status: any) => void]> = [
    ["chain", (s) => (s.backend.chain = "testnet")],
    ["decimal scale", (s) => (s.blockbook.decimals = 9)],
    ["string decimal scale", (s) => (s.blockbook.decimals = "8")],
    ["indexer sync", (s) => (s.blockbook.inSync = false)],
    ["initial sync", (s) => (s.blockbook.initialSync = true)],
    ["mempool sync", (s) => (s.blockbook.inSyncMempool = false)],
    ["mempool sync omitted", (s) => delete s.blockbook.inSyncMempool],
    ["height disagreement", (s) => (s.backend.blocks = 199)],
    ["invalid tip hash", (s) => (s.backend.bestBlockHash = "00")],
  ];
  for (const [label, mutate] of mutations) {
    const status = {
      blockbook: {
        decimals: 8,
        inSync: true,
        initialSync: false,
        inSyncMempool: true,
        bestHeight: 200,
      },
      backend: { chain: "mainnet", blocks: 200, bestBlockHash: txid(200) },
    };
    mutate(status);
    const source = new BlockbookSource(
      "mainnet",
      fake(() => status),
    );
    await assert.rejects(source.tip(), undefined, label);
  }
  assert.throws(
    () => new BlockbookSource("testnet"),
    /only for mainnet and testnet2/,
  );
});

test("independent genesis mismatch rejects otherwise coherent mainnet claims", async () => {
  const source = new BlockbookSource(
    "mainnet",
    fake((url) =>
      url.pathname === "/api/v2/"
        ? {
            blockbook: {
              decimals: 8,
              inSync: true,
              initialSync: false,
              inSyncMempool: true,
              bestHeight: 200,
            },
            backend: {
              chain: "mainnet",
              blocks: 200,
              bestBlockHash: txid(200),
            },
          }
        : {
            blockHash: url.pathname.endsWith("/0")
              ? NETWORKS.testnet.genesisHash
              : txid(200),
          },
    ),
  );
  await assert.rejects(source.tip(), /genesis mismatch/);
});

test("legacy deployed pending-prepend pagination skips one confirmed txid and fails closed", async () => {
  let calls = 0;
  const source = new BlockbookSource(
    "mainnet",
    fake((url) => {
      calls++;
      const page = Number(url.searchParams.get("page"));
      assert.equal(url.pathname, `/api/v2/address/${address}`);
      return {
        address,
        txs: 1500,
        unconfirmedTxs: 1,
        page,
        totalPages: 2,
        itemsOnPage: 1000,
        txids:
          page === 1
            ? [
                txid(99999),
                ...Array.from({ length: 999 }, (_, i) => txid(i + 1)),
              ]
            : Array.from({ length: 500 }, (_, i) => txid(1001 + i)),
      };
    }),
  );
  await assert.rejects(source.address(address), /Truncated account history/);
  assert.equal(calls, 2);
});

test("stable complete confirmed two-page history retains used status with zero UTXOs", async () => {
  let calls = 0;
  const source = new BlockbookSource(
    "mainnet",
    fake((url) => {
      calls++;
      if (url.pathname.startsWith("/api/v2/utxo/")) return [];
      const page = Number(url.searchParams.get("page"));
      return {
        address,
        txs: 1500,
        unconfirmedTxs: 0,
        page,
        totalPages: 2,
        itemsOnPage: 1000,
        txids: Array.from({ length: page === 1 ? 1000 : 500 }, (_, i) =>
          txid((page - 1) * 1000 + i + 1),
        ),
      };
    }),
  );
  const result = await source.address(address);
  assert.equal(result.used, true);
  assert.equal(result.txids.length, 1500);
  assert.deepEqual(result.utxos, []);
  assert.equal(calls, 3);
});

test("truncated pending-only first page cannot become a complete address result", async () => {
  const source = new BlockbookSource(
    "mainnet",
    fake(() => ({
      address,
      txs: 0,
      unconfirmedTxs: 1001,
      page: 1,
      totalPages: 1,
      itemsOnPage: 1000,
      txids: Array.from({ length: 1000 }, (_, i) => txid(i + 1)),
    })),
  );
  await assert.rejects(source.address(address), /Truncated account history/);
});

test("mutating GET and encoded paths are blocked without issuing fetch", async () => {
  let calls = 0;
  const source = new BlockbookSource(
    "mainnet",
    fake(() => {
      calls++;
      return {};
    }),
  );
  for (const path of [
    "/api/v2/sendtx/",
    "/api/v2/sendtx/00",
    "/api/v2/%73endtx/00",
    "/api/v2/address/a?details=txids&pageSize=1000&page=1&sendtx=00",
    "/api/v2/block-index/0/../sendtx/00",
    "/api/v2/tx/" + txid(1) + "?spending=true",
    "https://blockbook.pearlresearch.ai/api/v2/",
  ])
    await assert.rejects(
      source.get(path),
      /Unsupported read-only indexer path/,
    );
  assert.equal(calls, 0);
});
