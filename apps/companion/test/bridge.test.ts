import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createBridge,
  checkSnapshot,
  validateNodeUrl,
  type NodeRpc,
  type BridgeConfig,
} from "../src/bridge.js";
import { parseWatchSnapshot } from "@pearl-ledger/wallet";
import { hex, NETWORKS } from "@pearl-ledger/sdk";
import {
  snapshotFixture,
  blockHash,
} from "../../../packages/wallet/test/fixtures.js";
const config: BridgeConfig = {
  rpcUrl: "http://127.0.0.1:8334",
  rpcUser: "test-user",
  rpcPassword: "test-password-placeholder",
  network: "regtest",
  origin: "http://127.0.0.1:5173",
  port: 8787,
  allowBroadcast: false,
};
test("node boundary rejects remote plaintext, URL credentials and query", () => {
  assert.throws(() => validateNodeUrl("http://example.com"));
  assert.throws(() => validateNodeUrl("https://name:secret@example.com"));
  assert.throws(() =>
    validateNodeUrl("https://example.com?method=walletpassphrase"),
  );
  assert.equal(validateNodeUrl("http://127.0.0.1:1234").hostname, "127.0.0.1");
  assert.equal(validateNodeUrl("https://node.example.com").protocol, "https:");
});
test("checks exact raw amounts and ignores rounded JSON value fields", async () => {
  const snapshot = parseWatchSnapshot(JSON.stringify(snapshotFixture()));
  const c = snapshot.coins[0]!;
  const rpc: NodeRpc = async (method, params) => {
    switch (method) {
      case "getblockchaininfo":
        return { chain: "regtest" };
      case "getrawmempool":
        return [];
      case "getblockhash":
        return params[0] === 0
          ? NETWORKS.regtest.genesisHash
          : blockHash(Number(params[0]));
      case "getblockcount":
        return 200;
      case "gettxout":
        return {
          bestblock: blockHash(200),
          confirmations: 200,
          coinbase: true,
          value: 99999999.123,
          scriptPubKey: { hex: hex(c.scriptPubKey) },
        };
      case "getrawtransaction":
        assert.equal(params[1], 0);
        return c.rawTransaction;
      default:
        throw new Error("Unexpected RPC");
    }
  };
  const result = await checkSnapshot(rpc, "regtest", snapshot, 1234);
  assert.equal(result.coins[0]!.grains, "500000000");
  assert.equal(result.checkedAt, 1234);
});
test("reorg removes detached outputs before consulting gettxout", async () => {
  const snapshot = parseWatchSnapshot(JSON.stringify(snapshotFixture()));
  let checked = false;
  const rpc: NodeRpc = async (method, params) => {
    if (method === "getblockchaininfo") return { chain: "regtest" };
    if (method === "getrawmempool") return [];
    if (method === "getblockhash")
      return params[0] === 0
        ? NETWORKS.regtest.genesisHash
        : params[0] === 1
          ? blockHash(99)
          : blockHash(200);
    if (method === "getblockcount") return 200;
    checked = true;
    throw new Error("Do not query detached outputs");
  };
  const result = await checkSnapshot(rpc, "regtest", snapshot);
  assert.equal(result.coins[0]!.state, "reorged");
  assert.equal(checked, false);
});
test("HTTP boundary denies foreign Origin, generic RPC and broadcast by default", async () => {
  const rpc: NodeRpc = async () => {
    throw new Error("RPC must not be reached");
  };
  const server = createBridge(config, rpc);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  assert(addr && typeof addr === "object");
  const url = `http://127.0.0.1:${addr.port}`;
  config.origin = url;
  try {
    const foreign = await fetch(url + "/api/check", {
      method: "POST",
      headers: {
        origin: "https://evil.example",
        "content-type": "application/json",
        "x-pearl-companion": "1",
        host: "127.0.0.1:5173",
      },
      body: "{}",
    });
    assert.equal(foreign.status, 403);
    const headers = {
      origin: config.origin,
      "content-type": "application/json",
      "x-pearl-companion": "1",
      host: "127.0.0.1:5173",
    };
    assert.equal(
      (await fetch(url + "/api/rpc", { method: "POST", headers, body: "{}" }))
        .status,
      404,
    );
    const denied = await fetch(url + "/api/broadcast", {
      method: "POST",
      headers,
      body: "{}",
    });
    assert.equal(denied.status, 400);
    assert.match(await denied.text(), /disabled/);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve())),
    );
  }
});
