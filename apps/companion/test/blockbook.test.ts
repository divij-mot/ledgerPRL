import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BlockbookSource,
  checkLightSnapshot,
  lightMiddleware,
} from "../src/blockbook.js";
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
    confirmedTxCount: 0,
    pendingTxCount: 0,
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
    confirmations: 0,
  });
});

// Public bytes only. The fake HTTPS backend exercises the real light validator;
// no network, signer, hardware, browser upload, or broadcast is used.
import {
  accountToJson,
  concat,
  i32,
  fromHex,
  u32,
  u64,
  compactSize,
  hex,
  parseTransaction,
} from "@pearl-ledger/sdk";
import { parseWatchSnapshot, outpoint } from "@pearl-ledger/wallet";
import { rawTransaction } from "../../../packages/wallet/test/fixtures.js";
const confirmed = rawTransaction(500000000n, 0, false, account);
function pendingTransaction(previous: string, index: number, amount: bigint) {
  const script = deriveAddress(account, 0, index).scriptPubKey;
  const raw = concat(
    i32(1),
    Uint8Array.of(1),
    fromHex(previous).reverse(),
    u32(0),
    Uint8Array.of(0),
    u32(0xffffffff),
    Uint8Array.of(1),
    u64(amount),
    compactSize(script.length),
    script,
    u32(0),
  );
  return {
    txid: parseTransaction(raw).txid,
    vout: 0,
    rawTransaction: hex(raw),
    branch: 0,
    index,
    block: null,
  };
}
const spending = pendingTransaction(confirmed.txid, 1, 499999000n);
const unrelated = pendingTransaction("77".repeat(32), 0, 1000n);
type ViewMode =
  | "stable-unspent"
  | "stable-pending"
  | "cross-address-spend"
  | "new-pending"
  | "equal-count-replacement"
  | "utxo-disappears";
async function checkView(mode: ViewMode, reverse = false) {
  let calls = 0,
    changed = false;
  const fetcher = fake((url) => {
    assert(++calls <= 40, "Input validation must remain bounded");
    const path = new URL(url).pathname;
    if (path === "/api/v2/")
      return {
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
      };
    if (path.startsWith("/api/v2/block-index/"))
      return {
        blockHash: path.endsWith("/0")
          ? NETWORKS.mainnet.genesisHash
          : blockHash(Number(path.split("/").pop())),
      };
    if (path.startsWith("/api/v2/address/")) {
      const actualAddress = path.split("/").pop()!,
        isConfirmed = actualAddress === address;
      let txids = isConfirmed ? [confirmed.txid] : [spending.txid];
      if (
        isConfirmed &&
        (mode === "stable-pending" || (mode === "new-pending" && changed))
      )
        txids = [confirmed.txid, spending.txid];
      if (isConfirmed && mode === "equal-count-replacement")
        txids = [confirmed.txid, changed ? spending.txid : unrelated.txid];
      return {
        address: actualAddress,
        txs: isConfirmed ? 1 : 0,
        unconfirmedTxs: txids.length - (isConfirmed ? 1 : 0),
        page: 1,
        totalPages: 1,
        itemsOnPage: 1000,
        txids,
      };
    }
    if (path.startsWith("/api/v2/utxo/")) {
      const isConfirmed = path.endsWith(address),
        coin = isConfirmed ? confirmed : spending;
      return mode === "utxo-disappears" && changed && isConfirmed
        ? []
        : [{ txid: coin.txid, vout: 0, height: coin.block ? 1 : -1 }];
    }
    if (path.startsWith("/api/v2/tx/")) {
      const id = path.split("/").pop(),
        coin = [confirmed, spending, unrelated].find((c) => c.txid === id);
      assert(coin);
      if (
        (mode === "new-pending" || mode === "utxo-disappears") &&
        id === confirmed.txid
      )
        changed = true;
      if (mode === "equal-count-replacement" && id === unrelated.txid)
        changed = true;
      return {
        txid: coin.txid,
        hex: coin.rawTransaction,
        confirmations: coin.block ? 200 : 0,
        ...(coin.block
          ? { blockHeight: 1, blockHash: blockHash(1) }
          : { blockHeight: -1 }),
      };
    }
    throw new Error(`Unexpected test request ${path}`);
  });
  const coins =
    mode === "stable-pending" || mode === "cross-address-spend"
      ? reverse
        ? [spending, confirmed]
        : [confirmed, spending]
      : [confirmed];
  const snapshot = parseWatchSnapshot(
    JSON.stringify({
      schema: 1,
      account: accountToJson(account),
      genesisHash: NETWORKS.mainnet.genesisHash,
      tip: { height: 200, hash: blockHash(200) },
      coverage: {
        externalScannedThrough: 19,
        changeScannedThrough: 19,
        gapLimit: 20,
      },
      coins,
    }),
  );
  const validation = await checkLightSnapshot(
    new BlockbookSource("mainnet", fetcher),
    snapshot,
  );
  return validation.coins.find((c) => c.outpoint === outpoint(confirmed))!
    .state;
}
test("light preflight accepts a stable confirmed unspent view", async () => {
  assert.equal(await checkView("stable-unspent"), "unspent");
});
test("light preflight excludes a stable pending spend even if the UTXO endpoint is stale", async () => {
  assert.equal(await checkView("stable-pending"), "spent-or-unknown");
});
test("light preflight builds the entire spent set before classifying either coin order", async () => {
  assert.equal(await checkView("cross-address-spend"), "spent-or-unknown");
  assert.equal(
    await checkView("cross-address-spend", true),
    "spent-or-unknown",
  );
});
for (const mode of [
  "new-pending",
  "equal-count-replacement",
  "utxo-disappears",
] as const)
  test(`light preflight rejects ${mode} at a stable chain tip`, async () => {
    await assert.rejects(checkView(mode), /history or UTXO view changed/);
  });
