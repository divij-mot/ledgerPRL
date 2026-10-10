import test from "node:test";
import assert from "node:assert/strict";
import { historyConfirmations, pageItems } from "../src/activity.js";
import type { HistoryEntry } from "@pearl-ledger/wallet";
const tip = { height: 100, hash: "aa".repeat(32) };
const entry: HistoryEntry = {
  txid: "bb".repeat(32),
  received: 1n,
  spent: 0n,
  state: "confirmed",
  block: { height: 95, hash: "cc".repeat(32) },
};
test("confirmation counts require a confirmed record and the exact validated history tip", () => {
  assert.equal(historyConfirmations(entry, tip, tip), 6);
  assert.equal(historyConfirmations(entry, tip, null), null);
  assert.equal(
    historyConfirmations(entry, { ...tip, hash: "dd".repeat(32) }, tip),
    null,
  );
  assert.equal(historyConfirmations(entry, { ...tip, height: 101 }, tip), null);
  assert.equal(
    historyConfirmations({ ...entry, state: "detached" }, tip, tip),
    null,
  );
  assert.equal(
    historyConfirmations({ ...entry, state: "pending", block: null }, tip, tip),
    null,
  );
  assert.equal(
    historyConfirmations(
      { ...entry, block: { ...entry.block!, height: 101 } },
      tip,
      tip,
    ),
    null,
  );
});
test("display pagination preserves all underlying records and clamps a stale page", () => {
  const records = Array.from({ length: 23 }, (_, i) => i);
  assert.deepEqual(pageItems(records, 0).items, records.slice(0, 10));
  assert.deepEqual(pageItems(records, 1).items, records.slice(10, 20));
  assert.deepEqual(pageItems(records, 9), {
    items: [20, 21, 22],
    page: 2,
    pages: 3,
  });
  assert.equal(records.length, 23);
  assert.deepEqual(pageItems([], 9), { items: [], page: 0, pages: 1 });
});
