import test from "node:test";
import assert from "node:assert/strict";
import { parseWatchSnapshot } from "@pearl-ledger/wallet";
import {
  rawTransaction,
  snapshotFixture,
} from "../../../packages/wallet/test/fixtures.js";
import { accountCache, parseAccountCache } from "../src/account-cache.js";
const snapshot = parseWatchSnapshot(
  JSON.stringify(snapshotFixture([rawTransaction(100_000n, 0)], 200)),
);
const history = [
  {
    txid: snapshot.coins[0]!.txid,
    received: 100_000n,
    spent: 0n,
    block: snapshot.coins[0]!.block,
    state: "confirmed" as const,
  },
];
test("local account cache roundtrips amounts exactly without saving spend validation or a device session", () => {
  const value = accountCache(snapshot, history),
    restored = parseAccountCache(value, snapshot.account);
  assert.deepEqual(restored.snapshot, snapshot);
  assert.deepEqual(restored.history, history);
  assert.deepEqual(Object.keys(value).sort(), [
    "history",
    "schema",
    "snapshot",
  ]);
});
test("corrupt, cross-account, future, duplicate and over-limit display caches are rejected", () => {
  const value = accountCache(snapshot, history);
  assert.throws(() =>
    parseAccountCache(value, { ...snapshot.account, account: 1 }),
  );
  for (const mutate of [
    (v: any) => {
      v.schema = 2;
    },
    (v: any) => {
      v.history[0].received = "1e3";
    },
    (v: any) => {
      v.history[0].block.height = 999;
    },
    (v: any) => {
      v.history[0].state = "pending";
    },
    (v: any) => {
      v.history.push(v.history[0]);
    },
    (v: any) => {
      v.history = Array(2001).fill(v.history[0]);
    },
  ]) {
    const changed = structuredClone(value);
    mutate(changed);
    assert.throws(() => parseAccountCache(changed, snapshot.account));
  }
});
