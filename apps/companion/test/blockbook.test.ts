import { test } from "node:test";
import assert from "node:assert/strict";
import { BlockbookSource, lightMiddleware } from "../src/blockbook.js";
import { deriveAddress, NETWORKS } from "@pearl-ledger/sdk";
import {
  publicAccount,
  blockHash,
} from "../../../packages/wallet/test/fixtures.js";
const account = { ...publicAccount, network: "mainnet" as const };
const address = deriveAddress(account, 0, 0).address;
const response = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
function fake(get: (url: string) => unknown) {
  return (async (input: any) => response(get(String(input)))) as typeof fetch;
}
test("read-only source rejects all broadcast/proxy paths before issuing fetch", async () => {
  let calls = 0;
  const source = new BlockbookSource(
    "mainnet",
    fake(() => {
      calls++;
      return {};
    }),
  );
  await assert.rejects(source.get("/api/v2/sendtx/abcd"));
  await assert.rejects(source.get("/api/v2/../../evil"));
  assert.equal(calls, 0);
});
test("empty address requires no UTXO request and correctly counts unused gap", async () => {
  let calls = 0;
  const source = new BlockbookSource(
    "mainnet",
    fake(() => {
      calls++;
      return {
        address,
        txs: 0,
        unconfirmedTxs: 0,
        page: 1,
        totalPages: 1,
        itemsOnPage: 1000,
      };
    }),
  );
  assert.deepEqual(await source.address(address), {
    used: false,
    txids: [],
    utxos: [],
  });
  assert.equal(calls, 1);
});
test("spent address remains used even when UTXO list is empty", async () => {
  const source = new BlockbookSource(
    "mainnet",
    fake((url) =>
      url.includes("/utxo/")
        ? []
        : {
            address,
            txs: 1,
            unconfirmedTxs: 0,
            page: 1,
            totalPages: 1,
            itemsOnPage: 1000,
            txids: ["ab".repeat(32)],
          },
    ),
  );
  assert.equal((await source.address(address)).used, true);
});
test("rejects truncated and contradictory history before final-balance claim", async () => {
  const source = new BlockbookSource(
    "mainnet",
    fake(() => ({
      address,
      txs: 1500,
      unconfirmedTxs: 0,
      page: 1,
      totalPages: 1,
      itemsOnPage: 1000,
      txids: ["ab".repeat(32)],
    })),
  );
  await assert.rejects(source.address(address), /pagination/);
  const short = new BlockbookSource(
    "mainnet",
    fake(() => ({
      address,
      txs: 3,
      unconfirmedTxs: 1,
      page: 1,
      totalPages: 1,
      itemsOnPage: 1000,
      txids: ["ab".repeat(32)],
    })),
  );
  await assert.rejects(short.address(address), /Truncated/);
});
test("confirmed and unconfirmed counts are both included in completeness", async () => {
  const source = new BlockbookSource(
    "mainnet",
    fake((url) =>
      url.includes("/utxo/")
        ? []
        : {
            address,
            txs: 1,
            unconfirmedTxs: 1,
            page: 1,
            totalPages: 1,
            itemsOnPage: 1000,
            txids: ["ab".repeat(32), "cd".repeat(32)],
          },
    ),
  );
  assert.equal((await source.address(address)).txids.length, 2);
});
test("status authenticates full chain name, genesis and 8 decimal units", async () => {
  const source = new BlockbookSource(
    "mainnet",
    fake((url) =>
      url.endsWith("/api/v2/")
        ? {
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
              bestBlockHash: blockHash(200),
            },
          }
        : {
            blockHash: url.endsWith("/0")
              ? NETWORKS.mainnet.genesisHash
              : blockHash(200),
          },
    ),
  );
  assert.equal((await source.tip()).genesisHash, NETWORKS.mainnet.genesisHash);
  const wrong = new BlockbookSource(
    "mainnet",
    fake(() => ({
      blockbook: { decimals: 8 },
      backend: { chain: "testnet2" },
    })),
  );
  await assert.rejects(wrong.tip(), /chain/);
});
test("pending raw transaction is represented without fabricated block hash", async () => {
  const id = "ab".repeat(32);
  const source = new BlockbookSource(
    "mainnet",
    fake(() => ({ txid: id, hex: "00", blockHeight: -1, confirmations: 0 })),
  );
  assert.deepEqual(await source.transaction(id), {
    rawTransaction: "00",
    block: null,
  });
});
