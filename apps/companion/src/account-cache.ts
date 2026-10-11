/** Optional local display cache. It never restores spend validation or a device session. */
import { assert, parseGrains, type AccountPublicKey } from "@pearl-ledger/sdk";
import {
  accountId,
  chainTip,
  hash,
  parseWatchSnapshot,
  record,
  snapshotToJson,
  type HistoryEntry,
  type WatchSnapshot,
} from "@pearl-ledger/wallet";

export function accountCache(snapshot: WatchSnapshot, history: HistoryEntry[]) {
  const value = {
    schema: 1,
    snapshot: JSON.parse(snapshotToJson(snapshot)),
    history: history.map((item) => ({
      ...item,
      received: item.received.toString(),
      spent: item.spent.toString(),
    })),
  };
  assert(
    JSON.stringify(value).length <= 8 * 1024 * 1024,
    "Account cache exceeds its limit",
  );
  return value;
}
export function parseAccountCache(value: unknown, account: AccountPublicKey) {
  assert(
    JSON.stringify(value)?.length <= 8 * 1024 * 1024,
    "Account cache exceeds its limit",
  );
  const data = record(value, "account cache");
  assert(
    data.schema === 1 &&
      Array.isArray(data.history) &&
      data.history.length <= 2000,
    "Invalid account cache",
  );
  const snapshot = parseWatchSnapshot(JSON.stringify(data.snapshot));
  assert(
    accountId(snapshot.account) === accountId(account),
    "Account cache identity mismatch",
  );
  const seen = new Set<string>();
  const history: HistoryEntry[] = data.history.map((value) => {
    const item = record(value, "cached transaction"),
      txid = hash(item.txid);
    assert(!seen.has(txid), "Duplicate cached transaction");
    seen.add(txid);
    assert(
      item.state === "confirmed" ||
        item.state === "pending" ||
        item.state === "detached",
      "Invalid cached transaction state",
    );
    const block = item.block === null ? null : chainTip(item.block);
    assert(
      (item.state === "confirmed") === (block !== null) &&
        (!block || block.height <= snapshot.tip.height),
      "Invalid cached block",
    );
    return {
      txid,
      received: parseGrains(item.received as string),
      spent: parseGrains(item.spent as string),
      block,
      state: item.state,
    };
  });
  return { snapshot, history };
}
