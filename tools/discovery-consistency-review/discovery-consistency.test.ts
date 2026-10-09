/** Independent offline review. Public synthetic scripts/transactions only. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  deriveAddress, hex, fromHex, concat, i32, u32, u64, compactSize,
  parseTransaction, NETWORKS,
} from "../../packages/sdk/src/index.js";
import {
  discoverAccount, balances, emptyJournal, outpoint,
  type AddressActivity, type ChainTip, type WatchSource,
  type DiscoveryOptions, type HistoryEntry,
} from "../../packages/wallet/src/index.js";
import { publicAccount as account, blockHash } from "../../packages/wallet/test/fixtures.js";

type Coordinate = readonly [0 | 1, number];
type Output = { coordinate?: Coordinate; amount: bigint; script?: Uint8Array };
type Input = { txid: string; vout: number; padding?: number };
type Tx = {
  txid: string;
  rawTransaction: string;
  block: ChainTip | null;
  outputs: Output[];
  inputs: Input[];
};
const external = Uint8Array.of(0x51);
const tip = { height: 200, hash: blockHash(200) };
const address = ([branch, index]: Coordinate) => deriveAddress(account, branch, index).address;
const own = (branch: 0 | 1, index: number, amount = 100_000n): Output =>
  ({ coordinate: [branch, index], amount });
const unowned = (amount = 99_000n): Output => ({ amount, script: external });
let nonce = 0;
function transaction(outputs: Output[], inputs?: Input[], height: number | null = 1): Tx {
  const ins = inputs ?? [{ txid: (++nonce).toString(16).padStart(64, "0"), vout: 0 }];
  const raw = concat(i32(1), compactSize(ins.length), ...ins.map((input) => {
    const sig = new Uint8Array(input.padding ?? 0);
    return concat(fromHex(input.txid).reverse(), u32(input.vout), compactSize(sig.length), sig, u32(0xffffffff));
  }), compactSize(outputs.length), ...outputs.map((output) => {
    const script = output.coordinate
      ? deriveAddress(account, ...output.coordinate).scriptPubKey : output.script!;
    return concat(u64(output.amount), compactSize(script.length), script);
  }), u32(0));
  return { txid: parseTransaction(raw).txid, rawTransaction: hex(raw), outputs, inputs: ins,
    block: height === null ? null : { height, hash: blockHash(height) } };
}
const empty = (): AddressActivity => ({ used: false, confirmedTxCount: 0, pendingTxCount: 0, txids: [], utxos: [] });
function sourceOf(txs: Tx[]) {
  const records = new Map(txs.map((tx) => [tx.txid, tx]));
  const rows = new Map<string, AddressActivity>();
  const row = (coordinate: Coordinate) => {
    const key = address(coordinate);
    if (!rows.has(key)) rows.set(key, empty());
    return rows.get(key)!;
  };
  const spent = new Set(txs.flatMap((tx) => tx.inputs.map(outpoint)));
  for (const tx of txs) {
    const involved = new Map<string, Coordinate>();
    for (const output of tx.outputs) if (output.coordinate)
      involved.set(address(output.coordinate), output.coordinate);
    for (const input of tx.inputs) {
      const previous = records.get(input.txid)?.outputs[input.vout];
      if (previous?.coordinate) involved.set(address(previous.coordinate), previous.coordinate);
    }
    for (const coordinate of involved.values()) {
      const activity = row(coordinate);
      activity.used = true;
      activity.txids.push(tx.txid);
      tx.block ? activity.confirmedTxCount++ : activity.pendingTxCount++;
    }
    tx.outputs.forEach((output, vout) => {
      if (output.coordinate && output.amount > 0n && tx.block && !spent.has(outpoint({ txid: tx.txid, vout })))
        row(output.coordinate).utxos.push({ txid: tx.txid, vout, height: tx.block.height });
    });
  }
  let tipReads = 0;
  const source: WatchSource & { rows: Map<string, AddressActivity>; queries: string[]; transactionReads: string[];
    tipReads(): number } = {
    network: account.network, rows, queries: [], transactionReads: [], tipReads: () => tipReads,
    async tip() { tipReads++; return { tip: { ...tip }, genesisHash: NETWORKS.regtest.genesisHash }; },
    async address(value) { this.queries.push(value); return rows.get(value) ?? empty(); },
    async transaction(id) {
      this.transactionReads.push(id);
      const tx = records.get(id);
      assert(tx, `Unexpected raw transaction request ${id}`);
      return { rawTransaction: tx.rawTransaction, block: tx.block,
        confirmations: tx.block ? tip.height - tx.block.height + 1 : 0 };
    },
    async blockHash(height) { return blockHash(height); },
  };
  return source;
}
function addHistory(source: ReturnType<typeof sourceOf>, coordinate: Coordinate, txs: Tx[]) {
  source.rows.set(address(coordinate), {
    used: txs.length > 0, txids: txs.map((tx) => tx.txid),
    confirmedTxCount: txs.filter((tx) => tx.block !== null).length,
    pendingTxCount: txs.filter((tx) => tx.block === null).length, utxos: [],
  });
}

test("honest empty source scans exactly both initial gaps", async () => {
  const source = sourceOf([]), result = await discoverAccount(source, account);
  assert.equal(result.complete, true);
  assert.equal(source.queries.length, 40);
  assert.deepEqual(result.lastUsed, [-1, -1]);
  assert.deepEqual(result.history, []);
  assert.deepEqual(result.snapshot.coins, []);
});

test("honest received outputs on both branches are preserved exactly", async () => {
  const fund = transaction([own(0, 0), own(1, 3, 250_000n), unowned()]);
  const result = await discoverAccount(sourceOf([fund]), account);
  assert.deepEqual(result.lastUsed, [0, 3]);
  assert.equal(result.snapshot.coins.length, 2);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0]!.received, 350_000n);
  assert.equal(balances(result.snapshot).available, 350_000n);
});

test("funding attributed to an unrelated change address fails closed", async () => {
  const fund = transaction([own(0, 0)]), source = sourceOf([fund]);
  addHistory(source, [1, 19], [fund]);
  await assert.rejects(discoverAccount(source, account), /history|ownership|script|address/i);
});

test("repeated cross-branch attribution cannot return a poisoned high-water checkpoint", async () => {
  const fund = transaction([own(0, 0)]), source = sourceOf([fund]);
  for (let i = 19; i <= 979; i += 20) addHistory(source, [1, i], [fund]);
  await assert.rejects(discoverAccount(source, account), /history|ownership|script|address/i);
  assert(source.queries.length <= 2000);
});

test("spent-only history proves use from a known matching prevout", async () => {
  const fund = transaction([own(0, 19), own(1, 19, 200_000n)]);
  const spend = transaction([unowned(299_000n)], [{ txid: fund.txid, vout: 0 }, { txid: fund.txid, vout: 1 }], 2);
  const source = sourceOf([fund, spend]);
  for (const activity of source.rows.values()) activity.txids.reverse();
  const result = await discoverAccount(source, account);
  assert.deepEqual(result.lastUsed, [19, 19]);
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(result.history.find((entry) => entry.txid === spend.txid)!.spent, 300_000n);
});

test("unknown unrelated inputs do not invalidate a transaction paying a watched script", async () => {
  const tx = transaction([own(0, 0)], [{ txid: "ab".repeat(32), vout: 123 }, { txid: "cd".repeat(32), vout: 456 }]);
  const result = await discoverAccount(sourceOf([tx]), account);
  assert.equal(result.snapshot.coins.length, 1);
  assert.equal(result.history[0]!.spent, 0n);
});

test("one known watched prevout suffices alongside an unknown unrelated input", async () => {
  const fund = transaction([own(0, 0)]);
  const spend = transaction([unowned()], [{ txid: fund.txid, vout: 0 }, { txid: "ab".repeat(32), vout: 9 }], 2);
  const result = await discoverAccount(sourceOf([fund, spend]), account);
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(result.history.find((entry) => entry.txid === spend.txid)!.spent, 100_000n);
});

test("spent-only claim with an unavailable prevout cannot prove queried address ownership", async () => {
  const unrelated = transaction([unowned()]);
  const source = sourceOf([unrelated]);
  addHistory(source, [0, 0], [unrelated]);
  await assert.rejects(discoverAccount(source, account), /history|ownership|script|address/i);
});

test("a spend of receive does not prove unrelated change-address history", async () => {
  const fund = transaction([own(0, 0)]);
  const spend = transaction([unowned()], [{ txid: fund.txid, vout: 0 }], 2);
  const source = sourceOf([fund, spend]);
  addHistory(source, [1, 5], [spend]);
  await assert.rejects(discoverAccount(source, account), /history|ownership|script|address/i);
});

test("omitted positive confirmed owned output fails rather than inventing a UTXO", async () => {
  const fund = transaction([own(0, 0)]), source = sourceOf([fund]);
  source.rows.get(address([0, 0]))!.utxos = [];
  await assert.rejects(discoverAccount(source, account), /UTXO|unspent|omitt|missing|output/i);
});

test("partial omission of two outputs to the same address fails closed", async () => {
  const fund = transaction([own(0, 0), own(0, 0, 200_000n)]), source = sourceOf([fund]);
  source.rows.get(address([0, 0]))!.utxos.pop();
  await assert.rejects(discoverAccount(source, account), /UTXO|unspent|omitt|missing|output/i);
});

test("an omitted output to another scanned owned script fails closed", async () => {
  const fund = transaction([own(0, 0), own(1, 0)]), source = sourceOf([fund]);
  source.rows.delete(address([1, 0]));
  await assert.rejects(discoverAccount(source, account), /UTXO|unspent|omitt|missing|output/i);
});

test("a candidate transaction absent from that address history is rejected", async () => {
  const fund = transaction([own(0, 0)]), extra = transaction([own(0, 0)]), source = sourceOf([fund, extra]);
  const activity = source.rows.get(address([0, 0]))!;
  activity.txids = [fund.txid]; activity.confirmedTxCount = 1;
  await assert.rejects(discoverAccount(source, account), /history|UTXO|missing|address/i);
});

test("pending spends suppress stale confirmed candidates and satisfy omission consistency", async () => {
  const fund = transaction([own(0, 0)]), spend = transaction([own(1, 0, 99_000n)], [{ txid: fund.txid, vout: 0 }], null);
  for (const stale of [false, true]) {
    const source = sourceOf([fund, spend]);
    if (stale) source.rows.get(address([0, 0]))!.utxos.push({ txid: fund.txid, vout: 0, height: 1 });
    const result = await discoverAccount(source, account);
    assert.equal(result.snapshot.coins.length, 0);
    assert.equal(result.history.find((entry) => entry.txid === spend.txid)!.state, "pending");
    assert.equal(result.history.find((entry) => entry.txid === spend.txid)!.spent, 100_000n);
  }
});

test("pending output omission is allowed because endpoint need not return mempool outputs", async () => {
  const pending = transaction([own(0, 0)], undefined, null);
  const result = await discoverAccount(sourceOf([pending]), account);
  assert.equal(result.history[0]!.received, 100_000n);
  assert.equal(result.snapshot.coins.length, 0);
});

test("reported pending outputs remain pending and never enter confirmed validation", async () => {
  const pending = transaction([own(0, 0)], undefined, null), source = sourceOf([pending]);
  source.rows.get(address([0, 0]))!.utxos.push({ txid: pending.txid, vout: 0, height: null });
  const result = await discoverAccount(source, account);
  assert.equal(result.snapshot.coins.length, 1);
  assert.equal(balances(result.snapshot).available, 0n);
  assert.equal(result.validation.coins.length, 0);
});

test("overlapping receive/change histories and shared transactions are counted once", async () => {
  const fund = transaction([own(0, 0), own(1, 0, 200_000n)]);
  const spend = transaction([own(0, 0, 90_000n), own(1, 0, 190_000n)],
    [{ txid: fund.txid, vout: 0 }, { txid: fund.txid, vout: 1 }], 2);
  const source = sourceOf([fund, spend]), result = await discoverAccount(source, account);
  assert.equal(source.transactionReads.length, 2);
  assert.equal(result.history.length, 2);
  assert.equal(result.snapshot.coins.length, 2);
  assert.equal(result.history.find((entry) => entry.txid === spend.txid)!.spent, 300_000n);
});

test("zero-only owned output proves activity without requiring or inventing a coin", async () => {
  const zero = transaction([own(0, 0, 0n)]);
  const result = await discoverAccount(sourceOf([zero]), account);
  assert.deepEqual(result.lastUsed, [0, -1]);
  assert.equal(result.history.length, 1);
  assert.equal(result.history[0]!.received, 0n);
  assert.equal(result.snapshot.coins.length, 0);
});

test("mixed zero and positive owned outputs require only the positive unspent output", async () => {
  const fund = transaction([own(0, 0, 0n), own(1, 0)]);
  const result = await discoverAccount(sourceOf([fund]), account);
  assert.equal(result.snapshot.coins.length, 1);
  assert.deepEqual(result.lastUsed, [0, 0]);
});

test("a correctly bound zero-valued candidate is checked then excluded from coins", async () => {
  const zero = transaction([own(0, 0, 0n)]), source = sourceOf([zero]);
  source.rows.get(address([0, 0]))!.utxos.push({ txid: zero.txid, vout: 0, height: 1 });
  const result = await discoverAccount(source, account);
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(result.validation.coins.length, 0);
  assert.deepEqual(result.lastUsed, [0, -1]);
});

test("zero-valued candidates retain ownership and height checks before exclusion", async () => {
  const zero = transaction([own(0, 0, 0n), own(1, 0, 0n)]);
  const wrongOwner = sourceOf([zero]);
  wrongOwner.rows.get(address([0, 0]))!.utxos.push({ txid: zero.txid, vout: 1, height: 1 });
  await assert.rejects(discoverAccount(wrongOwner, account), /ownership/i);
  const wrongHeight = sourceOf([zero]);
  wrongHeight.rows.get(address([0, 0]))!.utxos.push({ txid: zero.txid, vout: 0, height: 2 });
  await assert.rejects(discoverAccount(wrongHeight, account), /height/i);
});

test("used and history metadata cannot disagree", async () => {
  const source = sourceOf([]);
  source.rows.set(address([0, 0]), { ...empty(), used: true });
  await assert.rejects(discoverAccount(source, account), /history|used|activity|count/i);
});

test("reorg and confirmation inconsistencies still reject the entire scan", async () => {
  const fund = transaction([own(0, 0)]);
  const changed = sourceOf([fund]);
  let reads = 0;
  changed.tip = async () => ({ tip: { ...tip, hash: blockHash(++reads === 1 ? 200 : 201) }, genesisHash: NETWORKS.regtest.genesisHash });
  await assert.rejects(discoverAccount(changed, account), /tip changed/i);
  const detached = sourceOf([fund]);
  detached.blockHash = async () => blockHash(99);
  await assert.rejects(discoverAccount(detached, account), /detached/i);
  const badConfirmations = sourceOf([fund]);
  badConfirmations.transaction = async () => ({ rawTransaction: fund.rawTransaction, block: fund.block, confirmations: 1 });
  await assert.rejects(discoverAccount(badConfirmations, account), /confirmation/i);
});

test("recovery and options are not mutated on an integrity rejection", async () => {
  const fund = transaction([own(0, 0)]), source = sourceOf([fund]);
  addHistory(source, [1, 19], [fund]);
  const journal = emptyJournal();
  const previousHistory: HistoryEntry[] = [{ txid: "ef".repeat(32), received: 500n, spent: 0n,
    state: "confirmed", block: { height: 1, hash: blockHash(1) } }];
  const options: DiscoveryOptions = { minimumIndex: [-1, -1], previousHistory };
  const before = structuredClone({ account, journal, options, rows: source.rows });
  let commits = 0;
  await assert.rejects((async () => {
    const result = await discoverAccount(source, account, options);
    commits++;
    journal.issuedReceiveThrough = result.lastUsed[0];
    journal.nextChangeIndex = result.lastUsed[1] + 1;
  })());
  assert.equal(commits, 0);
  assert.deepEqual({ account, journal, options, rows: source.rows }, before);
});

test("successful detachment does not mutate previous history entries", async () => {
  const previousHistory: HistoryEntry[] = [{ txid: "ef".repeat(32), received: 500n, spent: 0n,
    state: "confirmed", block: { height: 1, hash: blockHash(1) } }];
  const before = structuredClone(previousHistory);
  const result = await discoverAccount(sourceOf([]), account, { previousHistory });
  assert.equal(result.history[0]!.state, "detached");
  assert.equal(result.history[0]!.block, null);
  assert.deepEqual(previousHistory, before);
});

test("recovery requirement beyond 979 fails before any address query", async () => {
  const source = sourceOf([]);
  await assert.rejects(discoverAccount(source, account, { minimumIndex: [980, -1] }), /limit|extended/i);
  assert.equal(source.queries.length, 0);
});

test("more than 256 candidates rejects before transaction fetching", async () => {
  const tx = transaction(Array.from({ length: 257 }, () => own(0, 0, 1n))), source = sourceOf([tx]);
  await assert.rejects(discoverAccount(source, account), /256|outputs|UTXO/i);
  assert.equal(source.transactionReads.length, 0);
});

test("more than 2000 unique history transactions rejects before fetching", async () => {
  const source = sourceOf([]);
  const ids = Array.from({ length: 2001 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  source.rows.set(address([0, 0]), { used: true, txids: ids, utxos: [], confirmedTxCount: ids.length, pendingTxCount: 0 });
  await assert.rejects(discoverAccount(source, account), /2000|history|budget/i);
  assert.equal(source.transactionReads.length, 0);
});

test("over 20000 aggregate history references rejects before fetching", async () => {
  const source = sourceOf([]);
  const ids = Array.from({ length: 1001 }, (_, i) => (i + 1).toString(16).padStart(64, "0"));
  for (let index = 0; index < 20; index++) source.rows.set(address([0, index]),
    { used: true, txids: ids, utxos: [], confirmedTxCount: ids.length, pendingTxCount: 0 });
  await assert.rejects(discoverAccount(source, account), /aggregate|budget|history/i);
  assert.equal(source.transactionReads.length, 0);
});

test("oversized raw transaction rejects without returning a partial result", async () => {
  const fund = transaction([own(0, 0)]), source = sourceOf([fund]);
  source.transaction = async () => ({ rawTransaction: "00".repeat(500_001), block: fund.block, confirmations: 200 });
  await assert.rejects(discoverAccount(source, account), /too large/i);
});

test("aggregate raw history retains its 3 MiB hex budget", async () => {
  const txs = Array.from({ length: 4 }, (_, i) => transaction([own(0, i)],
    [{ txid: (i + 1).toString(16).padStart(64, "0"), vout: 0, padding: 399_950 }]));
  const source = sourceOf(txs);
  await assert.rejects(discoverAccount(source, account), /aggregate|3 MiB/i);
});

test("self-consistently omitted history remains a stated source-trust boundary", async () => {
  const result = await discoverAccount(sourceOf([]), account);
  assert.equal(result.complete, true);
  // No local parser can infer a transaction withheld by every source response.
  assert.equal(result.snapshot.coins.length, 0);
});
