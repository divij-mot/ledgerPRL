import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveAddress,
  hex,
  parseTransaction,
  concat,
  i32,
  u32,
  u64,
  compactSize,
  fromHex,
  NETWORKS,
} from "@pearl-ledger/sdk";
import { discoverAccount, type WatchSource, outpoint } from "../src/index.js";
import { publicAccount, blockHash, rawTransaction } from "./fixtures.js";
function sourceWithActivity(
  used: number[] = [],
  options: { reorg?: boolean; badRaw?: boolean; pendingSpend?: boolean } = {},
): WatchSource & { queries: string[] } {
  const receive = new Map(
    Array.from({ length: 1000 }, (_, i) => [
      deriveAddress(publicAccount, 0, i).address,
      i,
    ]),
  );
  const records = used.map((index) => rawTransaction(100_000_000n, index));
  const txMap = new Map(
    records.map((tx) => [
      tx.txid,
      { rawTransaction: tx.rawTransaction, block: tx.block },
    ]),
  );
  let pendingId: string | undefined;
  if (options.pendingSpend && records[0]) {
    const previous = records[0];
    const output = deriveAddress(publicAccount, 0, 1).scriptPubKey;
    const bytes = concat(
      i32(1),
      Uint8Array.of(1),
      fromHex(previous.txid).reverse(),
      u32(0),
      Uint8Array.of(0),
      u32(0xffffffff),
      Uint8Array.of(1),
      u64(99_999_000n),
      compactSize(output.length),
      output,
      u32(0),
    );
    const parsed = parseTransaction(bytes);
    pendingId = parsed.txid;
    txMap.set(parsed.txid, { rawTransaction: hex(bytes), block: null as any });
  }
  let reads = 0;
  return {
    network: "regtest",
    queries: [],
    async tip() {
      reads++;
      return {
        tip: {
          height: 200,
          hash: blockHash(options.reorg && reads > 1 ? 201 : 200),
        },
        genesisHash: NETWORKS.regtest.genesisHash,
      };
    },
    async blockHash(height) {
      return blockHash(height);
    },
    async address(address) {
      this.queries.push(address);
      const index = receive.get(address);
      const tx = records.find((t) => t.index === index);
      const pending = pendingId && (index === 0 || index === 1);
      return {
        used: !!tx || !!pending,
        txids: [...(tx ? [tx.txid] : []), ...(pending ? [pendingId!] : [])],
        utxos: tx ? [{ txid: tx.txid, vout: 0, height: 1 }] : [],
      };
    },
    async transaction(id) {
      const tx = txMap.get(id);
      assert(tx);
      return options.badRaw
        ? { ...tx, rawTransaction: records[1]?.rawTransaction ?? "00" }
        : tx;
    },
  };
}
test("empty account scans both branches through 20 unused addresses", async () => {
  const source = sourceWithActivity();
  const result = await discoverAccount(source, publicAccount);
  assert.equal(result.complete, true);
  assert.equal(source.queries.length, 40);
  assert.equal(result.snapshot.coins.length, 0);
  assert.deepEqual(result.lastUsed, [-1, -1]);
});
test("spent/used addresses extend the gap even with zero balance; resumes past known indexes", async () => {
  const source = sourceWithActivity([19, 39]);
  const result = await discoverAccount(source, publicAccount, {
    minimumIndex: [40, 2],
  });
  assert.equal(result.snapshot.coverage.externalScannedThrough, 60);
  assert.equal(result.snapshot.coverage.changeScannedThrough, 22);
  assert.equal(result.history.length, 2);
});
test("history raw transaction spends override stale indexer UTXO list, including pending spends", async () => {
  const result = await discoverAccount(
    sourceWithActivity([0], { pendingSpend: true }),
    publicAccount,
  );
  assert.equal(result.snapshot.coins.length, 0);
  const pending = result.history.find((tx) => tx.state === "pending");
  assert(pending);
  assert.equal(pending.spent, 100_000_000n);
  assert.equal(pending.received, 99_999_000n);
});
test("reorg during discovery and forged raw prevout fail closed", async () => {
  await assert.rejects(
    discoverAccount(sourceWithActivity([0], { reorg: true }), publicAccount),
    /tip changed/,
  );
  await assert.rejects(
    discoverAccount(sourceWithActivity([0], { badRaw: true }), publicAccount),
  );
});
test("discovery never claims completion above its recovery bound", async () => {
  await assert.rejects(
    discoverAccount(sourceWithActivity(), publicAccount, {
      minimumIndex: [980, 0],
    }),
    /limit/,
  );
});
test("detached transaction remains visible after a replacement chain view", async () => {
  const source = sourceWithActivity();
  const result = await discoverAccount(source, publicAccount, {
    previousHistory: [
      {
        txid: "11".repeat(32),
        received: 1000n,
        spent: 0n,
        block: { height: 100, hash: blockHash(100) },
        state: "confirmed",
      },
    ],
  });
  assert.equal(result.history[0]!.state, "detached");
  assert.equal(result.history[0]!.block, null);
});
