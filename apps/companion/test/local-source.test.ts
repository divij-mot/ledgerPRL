import test from "node:test";
import assert from "node:assert/strict";
import { accountToJson, NETWORKS } from "@pearl-ledger/sdk";
import { discoverAccount } from "@pearl-ledger/wallet";
import {
  publicAccount,
  rawTransaction,
  blockHash,
} from "../../../packages/wallet/test/fixtures.js";
import {
  LOCAL_SOURCE_COMMIT,
  LocalWatchSource,
  localStatus,
} from "../src/local-source.js";
import { checkLightSnapshot } from "../src/blockbook-source.js";

const account = { ...publicAccount, network: "mainnet" as const };
function fixture(amount = 500_000_000n) {
  const tx = rawTransaction(amount, 0, true, account);
  return {
    schema: 1,
    sourceCommit: LOCAL_SOURCE_COMMIT,
    watchOnly: true,
    network: "mainnet",
    account: 0,
    publicAccount: accountToJson(account),
    genesisHash: NETWORKS.mainnet.genesisHash,
    tip: { height: 200, hash: blockHash(200) },
    headerHeight: 200,
    filterHeight: 200,
    bestPeerHeight: 200,
    connections: 2,
    walletSynced: true,
    synced: true,
    ready: true,
    needsRegistration: false,
    lastUsed: [0, -1],
    registeredThrough: [20, 19],
    coverage: {
      externalScannedThrough: 20,
      changeScannedThrough: 19,
      gapLimit: 20,
      scanComplete: true,
    },
    complete: true,
    transactions: [
      { txid: tx.txid, rawTransaction: tx.rawTransaction, block: tx.block },
    ],
    unspent: [{ txid: tx.txid, vout: 0 }],
  };
}
function source(value = fixture(), refresh: () => unknown = () => value) {
  return new LocalWatchSource(account, value, async (method, params) => {
    if (method === "snapshot") return refresh();
    const { height } = params as { height: number };
    return {
      height,
      hash: height === 0 ? NETWORKS.mainnet.genesisHash : blockHash(height),
      tip: value.tip,
    };
  });
}

test("local raw history flows through ordinary discovery and input preflight with exact grains", async () => {
  const data = fixture(9_007_199_254_740_993n);
  const discovered = await discoverAccount(source(data), account);
  assert.equal(discovered.snapshot.coins[0]!.amount, 9_007_199_254_740_993n);
  assert.equal(discovered.history[0]!.received, 9_007_199_254_740_993n);
  assert.deepEqual(discovered.lastUsed, [0, -1]);
  const validation = await checkLightSnapshot(
    source(data),
    discovered.snapshot,
  );
  assert.equal(validation.coins[0]!.state, "unspent");
});

test("local snapshots reject account substitution, incomplete coverage, missing raw history and duplicates", () => {
  for (const mutate of [
    (d: ReturnType<typeof fixture>) => {
      d.publicAccount = accountToJson({
        ...account,
        chainCode: new Uint8Array(32).fill(1),
      });
    },
    (d: ReturnType<typeof fixture>) => {
      d.watchOnly = false;
    },
    (d: ReturnType<typeof fixture>) => {
      d.walletSynced = false;
    },
    (d: ReturnType<typeof fixture>) => {
      d.coverage.scanComplete = false;
    },
    (d: ReturnType<typeof fixture>) => {
      d.connections = 0;
    },
    (d: ReturnType<typeof fixture>) => {
      d.filterHeight--;
    },
    (d: ReturnType<typeof fixture>) => {
      d.bestPeerHeight++;
    },
    (d: ReturnType<typeof fixture>) => {
      d.transactions = [];
    },
    (d: ReturnType<typeof fixture>) => {
      d.transactions.push(d.transactions[0]!);
    },
    (d: ReturnType<typeof fixture>) => {
      d.unspent.push(d.unspent[0]!);
    },
  ]) {
    const data = fixture();
    mutate(data);
    assert.throws(() => source(data));
  }
});

test("same-tip changes in local spendability invalidate a discovery snapshot", async () => {
  const data = fixture(),
    changed = { ...data, unspent: [] };
  await assert.rejects(
    discoverAccount(
      source(data, () => changed),
      account,
    ),
    /changed during/,
  );
});

test("sync progress is usable before readiness but cannot produce a spendable snapshot", () => {
  const data = fixture();
  data.ready = false;
  data.synced = false;
  data.connections = 0;
  data.coverage.scanComplete = false;
  assert.equal(localStatus(data, account).ready, false);
  assert.throws(() => source(data), /still syncing/);
});
