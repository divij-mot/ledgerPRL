import test from "node:test";
import assert from "node:assert/strict";
import {
  concat, i32, u32, u64, compactSize, deriveAddress, fromHex, hex,
  parseTransaction, NETWORKS,
} from "@pearl-ledger/sdk";
import { discoverAccount, type AddressActivity, type WatchSource } from "../src/index.js";
import { publicAccount, blockHash } from "./fixtures.js";

const receive = deriveAddress(publicAccount, 0, 0);
const change = deriveAddress(publicAccount, 1, 19);
const foreign = deriveAddress({ ...publicAccount, chainCode: new Uint8Array(32).fill(0x43) }, 0, 0);
function transaction(outputs: { scriptPubKey: Uint8Array; amount: bigint }[],
  previous = "11".repeat(32), pending = false) {
  const bytes = concat(
    i32(1), Uint8Array.of(1), fromHex(previous).reverse(), u32(0),
    Uint8Array.of(0), u32(0xffffffff), compactSize(outputs.length),
    ...outputs.map((o) => concat(u64(o.amount), compactSize(o.scriptPubKey.length), o.scriptPubKey)),
    u32(0),
  );
  return { txid: parseTransaction(bytes).txid, rawTransaction: hex(bytes),
    block: pending ? null : { height: 1, hash: blockHash(1) }, confirmations: pending ? 0 : 200 };
}
type Tx = ReturnType<typeof transaction>;
const funding = transaction([{ scriptPubKey: receive.scriptPubKey, amount: 100_000n }]);
const utxo = (tx: Tx, vout = 0) => ({ txid: tx.txid, vout, height: tx.block?.height ?? null });
function activity(txs: Tx[], utxos: AddressActivity["utxos"] = []): AddressActivity {
  return { used: txs.length > 0, confirmedTxCount: txs.filter((tx) => tx.block).length,
    pendingTxCount: txs.filter((tx) => !tx.block).length, txids: txs.map((tx) => tx.txid), utxos };
}
function source(txs: Tx[], rows: Map<string, AddressActivity>): WatchSource {
  const records = new Map(txs.map((tx) => [tx.txid, tx]));
  return {
    network: "regtest",
    tip: async () => ({ tip: { height: 200, hash: blockHash(200) }, genesisHash: NETWORKS.regtest.genesisHash }),
    blockHash: async (height) => blockHash(height),
    address: async (address) => rows.get(address) ?? activity([]),
    transaction: async (id) => { const tx = records.get(id); assert(tx, "Only supplied raw transactions may be fetched"); return tx; },
  };
}

test("discovery binds every history record to its queried address before returning recovery ranges", async () => {
  await assert.rejects(discoverAccount(source([funding], new Map([
    [receive.address, activity([funding], [utxo(funding)])],
    [change.address, activity([funding])],
  ])), publicAccount), /does not involve the queried address/);
});

test("discovery rejects a UTXO whose funding ID is omitted from that address's full history", async () => {
  const extra = transaction([{ scriptPubKey: receive.scriptPubKey, amount: 200_000n }]);
  await assert.rejects(discoverAccount(source([funding, extra], new Map([
    [receive.address, activity([funding], [utxo(funding), utxo(extra)])],
  ])), publicAccount), /UTXO is missing from its address history/);
});

test("discovery rejects an omitted confirmed owned UTXO without any supplied spend", async () => {
  await assert.rejects(discoverAccount(source([funding], new Map([
    [receive.address, activity([funding])],
  ])), publicAccount), /missing from the UTXO view without a supplied spend/);
});

test("spent-only address history is proven by a known matching previous output", async () => {
  const spent = transaction([{ scriptPubKey: foreign.scriptPubKey, amount: 99_000n }], funding.txid);
  const result = await discoverAccount(source([funding, spent], new Map([
    [receive.address, activity([funding, spent])],
  ])), publicAccount);
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(result.history.find((h) => h.txid === spent.txid)!.spent, 100_000n);
});

for (const staleUtxo of [false, true])
  test(`pending spends override ${staleUtxo ? "stale" : "omitted"} confirmed UTXOs`, async () => {
    const spent = transaction([{ scriptPubKey: foreign.scriptPubKey, amount: 99_000n }], funding.txid, true);
    const result = await discoverAccount(source([funding, spent], new Map([
      [receive.address, activity([funding, spent], staleUtxo ? [utxo(funding)] : [])],
    ])), publicAccount);
    assert.equal(result.snapshot.coins.length, 0);
    assert.equal(result.history.find((h) => h.txid === spent.txid)!.state, "pending");
  });

test("a directly received output does not require fetching unrelated external input prevouts", async () => {
  const result = await discoverAccount(source([funding], new Map([
    [receive.address, activity([funding], [utxo(funding)])],
  ])), publicAccount);
  assert.equal(result.snapshot.coins.length, 1);
});

test("receive and change may legitimately share a transaction without duplicate account history", async () => {
  const spent = transaction([{ scriptPubKey: change.scriptPubKey, amount: 99_000n }], funding.txid);
  const result = await discoverAccount(source([funding, spent], new Map([
    [receive.address, activity([funding, spent], [utxo(funding)])],
    [change.address, activity([spent], [utxo(spent)])],
  ])), publicAccount);
  assert.deepEqual(result.lastUsed, [0, 19]);
  assert.equal(result.history.length, 2);
  assert.equal(result.snapshot.coins.length, 1);
  assert.equal(result.snapshot.coins[0]!.branch, 1);
});

for (const listed of [false, true])
  test(`zero-valued owned outputs preserve address usage when ${listed ? "listed" : "omitted"} as UTXOs`, async () => {
    const zero = transaction([{ scriptPubKey: change.scriptPubKey, amount: 0n }]);
    const result = await discoverAccount(source([zero], new Map([
      [change.address, activity([zero], listed ? [utxo(zero)] : [])],
    ])), publicAccount);
    assert.deepEqual(result.lastUsed, [-1, 19]);
    assert.equal(result.history.length, 1);
    assert.equal(result.history[0]!.received, 0n);
    assert.equal(result.snapshot.coins.length, 0);
  });

test("zero-valued remaining UTXO candidates still require exact output ownership and height", async () => {
  const zero = transaction([
    { scriptPubKey: receive.scriptPubKey, amount: 0n },
    { scriptPubKey: change.scriptPubKey, amount: 0n },
  ]);
  for (const [candidate, message] of [
    [utxo(zero, 0), /ownership mismatch/],
    [{ ...utxo(zero, 1), height: 2 }, /block height mismatch/],
  ] as const) {
    await assert.rejects(discoverAccount(source([zero], new Map([
      [receive.address, activity([zero])],
      [change.address, activity([zero], [candidate])],
    ])), publicAccount), message);
  }
});

test("pending owned outputs are not inferred as selectable when omitted by the source", async () => {
  const pending = transaction([{ scriptPubKey: receive.scriptPubKey, amount: 100_000n }], "11".repeat(32), true);
  const result = await discoverAccount(source([pending], new Map([
    [receive.address, activity([pending])],
  ])), publicAccount);
  assert.equal(result.history[0]!.state, "pending");
  assert.equal(result.snapshot.coins.length, 0);
});

test("generic discovery sources cannot contradict used flags or repeat address history IDs", async () => {
  for (const row of [
    { ...activity([funding], [utxo(funding)]), used: false },
    activity([funding, funding], [utxo(funding)]),
  ]) await assert.rejects(discoverAccount(source([funding], new Map([
    [receive.address, row],
  ])), publicAccount), /usage contradicts/);
});
