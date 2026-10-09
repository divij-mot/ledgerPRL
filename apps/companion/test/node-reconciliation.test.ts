import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";
import { NETWORKS } from "@pearl-ledger/sdk";
import {
  checkKnownPayments,
  createBridge,
  type NodeRpc,
  type BridgeConfig,
} from "../src/bridge.js";
import { blockHash } from "../../../packages/wallet/test/fixtures.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const payment = {
  bundleHex: fixture.bundleHex as string,
  rawTx: fixture.rawTx as string,
  expectedTxid: fixture.txid as string,
};
function node(
  options: {
    tx?: unknown;
    missing?: boolean;
    detached?: boolean;
    reorg?: boolean;
    network?: string;
    genesis?: string;
    height?: number;
  } = {},
) {
  const calls: [string, unknown[]][] = [];
  let tipReads = 0;
  const rpc: NodeRpc = async (method, params) => {
    calls.push([method, params]);
    if (method === "getblockchaininfo")
      return { chain: options.network ?? "regtest" };
    if (method === "getblockcount") {
      tipReads++;
      return options.height ?? 200;
    }
    if (method === "getblockhash") {
      const height = Number(params[0]);
      if (height === 0) return options.genesis ?? NETWORKS.regtest.genesisHash;
      if (options.reorg && tipReads > 1) return blockHash(height + 1);
      return options.detached && height === 195
        ? blockHash(194)
        : blockHash(height);
    }
    assert.equal(
      method,
      "getrawtransaction",
      "Only read-only RPC methods are allowed",
    );
    assert.deepEqual(params, [fixture.txid, 1]);
    if (options.missing) throw new Error("No indexed transaction");
    return (
      options.tx ?? {
        txid: fixture.txid,
        hex: fixture.rawTx,
        confirmations: 6,
        blockhash: blockHash(195),
      }
    );
  };
  return { rpc, calls };
}
test("known local payment needs exact verified bytes and six active-chain confirmations", async () => {
  const { rpc, calls } = node();
  const result = await checkKnownPayments(
    rpc,
    "regtest",
    { payments: [payment], checkpoints: [] },
    1234,
  );
  assert.deepEqual(result.transactions, [
    {
      txid: fixture.txid,
      state: "confirmed",
      block: { height: 195, hash: blockHash(195) },
      confirmations: 6,
    },
  ]);
  assert.equal(result.checkedAt, 1234);
  assert.equal(result.rpcCalls, calls.length);
  assert.equal(result.rpcCalls, 10);
});
for (const [name, tx, state] of [
  [
    "five confirmations",
    {
      txid: fixture.txid,
      hex: fixture.rawTx,
      confirmations: 5,
      blockhash: blockHash(196),
    },
    "confirmed",
  ],
  [
    "explicit pending",
    { txid: fixture.txid, hex: fixture.rawTx, confirmations: 0 },
    "pending",
  ],
  [
    "Pearl omitted pending fields",
    { txid: fixture.txid, hex: fixture.rawTx },
    "pending",
  ],
  [
    "contradictory pending block",
    {
      txid: fixture.txid,
      hex: fixture.rawTx,
      confirmations: 0,
      blockhash: blockHash(195),
    },
    "unknown",
  ],
  [
    "altered signed bytes",
    {
      txid: fixture.txid,
      hex: fixture.rawTx + "00",
      confirmations: 6,
      blockhash: blockHash(195),
    },
    "unknown",
  ],
  [
    "negative confirmations",
    { txid: fixture.txid, hex: fixture.rawTx, confirmations: -1 },
    "unknown",
  ],
  [
    "impossible confirmations",
    {
      txid: fixture.txid,
      hex: fixture.rawTx,
      confirmations: 202,
      blockhash: blockHash(195),
    },
    "unknown",
  ],
] as const)
  test(`known local payment handles ${name} conservatively`, async () => {
    const result = await checkKnownPayments(node({ tx }).rpc, "regtest", {
      payments: [payment],
      checkpoints: [],
    });
    assert.equal(result.transactions[0]!.state, state);
    if (name === "five confirmations")
      assert.equal(result.transactions[0]!.confirmations, 5);
  });
test("missing and detached known payments cannot be archived", async () => {
  for (const [options, state] of [
    [{ missing: true }, "unknown"],
    [{ detached: true }, "detached"],
  ] as const)
    assert.equal(
      (
        await checkKnownPayments(node(options).rpc, "regtest", {
          payments: [payment],
          checkpoints: [],
        })
      ).transactions[0]!.state,
      state,
    );
});
test("chain identity, genesis and final tip disagreement reject the whole pass", async () => {
  for (const options of [
    { network: "simnet" },
    { genesis: "00".repeat(32) },
    { reorg: true },
  ])
    await assert.rejects(
      checkKnownPayments(node(options).rpc, "regtest", {
        payments: [payment],
        checkpoints: [],
      }),
      /mismatch|changed/,
    );
});
test("archived receipts sharing one height need only one active block lookup", async () => {
  const { rpc, calls } = node();
  const checkpoints = Array.from({ length: 1000 }, (_, i) => ({
    height: 10,
    hash: blockHash(i),
  }));
  const result = await checkKnownPayments(rpc, "regtest", {
    payments: [],
    checkpoints,
  });
  assert.equal(
    result.checkpoints.filter((c) => c.state === "confirmed").length,
    1,
  );
  assert.equal(
    result.checkpoints.filter((c) => c.state === "detached").length,
    999,
  );
  assert.equal(
    calls.filter(([m, p]) => m === "getblockhash" && p[0] === 10).length,
    1,
  );
  assert.equal(calls.filter(([m]) => m === "getrawtransaction").length, 0);
  assert.equal(result.rpcCalls, 9);
});
test("too-shallow and future archived checkpoints cannot retain archival", async () => {
  const result = await checkKnownPayments(node().rpc, "regtest", {
    payments: [],
    checkpoints: [
      { height: 196, hash: blockHash(196) },
      { height: 201, hash: blockHash(201) },
    ],
  });
  assert.deepEqual(
    result.checkpoints.map((c) => c.state),
    ["insufficient", "detached"],
  );
});
test("oversized, duplicate and invalid signed requests exhaust no node budget", async () => {
  const { rpc, calls } = node();
  for (const request of [
    { payments: Array(101).fill(payment), checkpoints: [] },
    {
      payments: [],
      checkpoints: Array(2001).fill({ height: 1, hash: blockHash(1) }),
    },
    { payments: [payment, payment], checkpoints: [] },
    {
      payments: [],
      checkpoints: [
        { height: 1, hash: blockHash(1) },
        { height: 1, hash: blockHash(1) },
      ],
    },
    {
      payments: [{ ...payment, rawTx: payment.rawTx + "00" }],
      checkpoints: [],
    },
  ])
    await assert.rejects(checkKnownPayments(rpc, "regtest", request));
  assert.equal(calls.length, 0);
});
const config: BridgeConfig = {
  rpcUrl: "http://127.0.0.1:8334",
  rpcUser: "test-user",
  rpcPassword: "test-password-placeholder",
  network: "regtest",
  origin: "http://127.0.0.1:5173",
  port: 8787,
  allowBroadcast: false,
};
// Dispatch in-process without binding a socket or requesting network permission.
function request(rpc: NodeRpc) {
  const server = createBridge(config, rpc);
  const input = Object.assign(
    Readable.from([
      Buffer.from(JSON.stringify({ payments: [payment], checkpoints: [] })),
    ]),
    {
      method: "POST",
      url: "/api/reconcile",
      headers: {
        origin: config.origin,
        host: "127.0.0.1:5173",
        "x-pearl-companion": "1",
        "content-type": "application/json",
      },
    },
  );
  let resolve!: (result: { status: number; value: any }) => void;
  const result = new Promise<{ status: number; value: any }>((r) => {
    resolve = r;
  });
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    status: 0,
    writeHead(status: number) {
      this.status = status;
    },
    end(text: string) {
      this.writableEnded = true;
      resolve({ status: this.status, value: JSON.parse(text) });
    },
  });
  server.emit("request", input, response);
  return { input, result };
}
test("exact local reconcile route works while broadcasting is disabled", async () => {
  const result = await request(node().rpc).result;
  assert.equal(result.status, 200);
  assert.equal(result.value.transactions[0].state, "confirmed");
});
test("client cancellation aborts an in-flight local reconciliation without a partial success", async () => {
  let entered!: () => void;
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  let signal: AbortSignal | undefined;
  const rpc: NodeRpc = async (_method, _params, current) => {
    signal = current;
    entered();
    return new Promise(() => {});
  };
  const operation = request(rpc);
  await started;
  operation.input.emit("aborted");
  const result = await operation.result;
  assert.equal(signal!.aborted, true);
  assert.equal(result.status, 400);
  assert.match(result.value.error, /cancelled|deadline/i);
});
