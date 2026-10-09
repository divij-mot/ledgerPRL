/**
 * Exercises actual companion middleware over loopback HTTP with isolated public fixtures.
 * No browser, uploads, hardware, credentials, funds, or production network access.
 * Only the explicit 85s/295s operation timers are accelerated to 500 ms, and the
 * original global timers/fetch are restored in finally blocks. Native HTTP
 * server timers remain untouched. Success and next-request controls are included.
 */
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { lightMiddleware } from "../src/blockbook.js";
import { createBridge } from "../src/bridge.js";
import {
  snapshotFixture,
  publicAccount,
  blockHash,
} from "../../../packages/wallet/test/fixtures.js";
import { NETWORKS, accountToJson } from "@pearl-ledger/sdk";
async function bodyCleanup() {
  const origin = "http://127.0.0.1:5173";
  const originalTimer = globalThis.setTimeout,
    originalFetch = globalThis.fetch;
  globalThis.setTimeout = (fn, delay, ...args) =>
    originalTimer(fn, delay === 85e3 || delay === 295e3 ? 500 : delay, ...args);
  globalThis.fetch = async (url) => {
    const p = new URL(String(url)).pathname;
    assert(
      String(url).startsWith("https://blockbook.testnet.pearlresearch.ai/"),
    );
    if (p === "/api/v2/")
      return new Response(
        JSON.stringify({
          blockbook: {
            decimals: 8,
            inSync: true,
            initialSync: false,
            inSyncMempool: true,
            bestHeight: 200,
          },
          backend: {
            chain: "testnet2",
            blocks: 200,
            bestBlockHash: blockHash(200),
          },
        }),
      );
    assert(p.startsWith("/api/v2/block-index/"));
    return new Response(
      JSON.stringify({
        blockHash: p.endsWith("/0")
          ? NETWORKS.testnet2.genesisHash
          : blockHash(200),
      }),
    );
  };
  const middleware = lightMiddleware(origin);
  const light = createServer((req, res) => {
    void middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  const node = createBridge(
    {
      rpcUrl: "http://127.0.0.1:8334",
      rpcUser: "fixture",
      rpcPassword: "unused",
      network: "regtest",
      origin,
      port: 8787,
      allowBroadcast: false,
    },
    async (method, params) => {
      switch (method) {
        case "getblockchaininfo":
          return { chain: "regtest" };
        case "getblockcount":
          return 200;
        case "getblockhash":
          return params[0] === 0
            ? NETWORKS.regtest.genesisHash
            : blockHash(Number(params[0]));
        default:
          throw Error("Unsupported fixture RPC");
      }
    },
  );
  const headers = {
    Host: "127.0.0.1:5173",
    Origin: origin,
    "Content-Type": "application/json",
    "X-Pearl-Companion": "1",
  };
  const results = [];
  try {
    for (const [name, server, path, body] of [
      ["node", node, "/api/reconcile", { payments: [], checkpoints: [] }],
      [
        "light",
        light,
        "/api/light/check",
        {
          network: "testnet2",
          consent: true,
          snapshot: snapshotFixture([], 200, "testnet2"),
        },
      ],
    ]) {
      let send = function (text) {
        return new Promise((resolve) => {
          const q2 = request(
            { hostname: "127.0.0.1", port, path, method: "POST", headers },
            (r) => {
              let body2 = "";
              r.on("data", (x) => (body2 += x));
              r.on("end", () => resolve({ status: r.statusCode, body: body2 }));
            },
          );
          q2.on("error", (e) => resolve({ error: e.code }));
          q2.end(text);
        });
      };
      await new Promise((r) => server.listen(0, "127.0.0.1", r));
      const port = server.address().port;
      let q;
      const stalled = new Promise((resolve) => {
        q = request(
          { hostname: "127.0.0.1", port, path, method: "POST", headers },
          (r) => {
            r.resume();
            r.on("end", () => resolve({ status: r.statusCode }));
          },
        );
        q.on("error", (e) => resolve({ error: e.code }));
        q.write("{");
      });
      await new Promise((r) => originalTimer(r, 20));
      const busy = await send("{}");
      assert.equal(busy.status, 409);
      const terminal = await stalled;
      assert.equal(terminal.error, "ECONNRESET");
      const success = await send(JSON.stringify(body));
      assert.equal(success.status, 200, JSON.stringify(success));
      const malformed = await send("{");
      assert.equal(malformed.status, 400);
      const afterError = await send(JSON.stringify(body));
      assert.equal(afterError.status, 200);
      results.push({
        route: name,
        busyBeforeTimeout: busy.status,
        stalledBody: terminal,
        successAfterTimeout: success.status,
        malformed: malformed.status,
        successAfterError: afterError.status,
      });
    }
  } finally {
    globalThis.setTimeout = originalTimer;
    globalThis.fetch = originalFetch;
    for (const s of [node, light]) s.closeAllConnections();
    await Promise.all(
      [node, light].map((s) => new Promise((r) => s.close(() => r()))),
    );
  }
  for (const result of results)
    console.log(
      "PASS: " +
        result.route +
        " stalled body is destroyed, lock released, malformed JSON recovers, and normal response survives disposal",
    );
}
async function siblingCleanup() {
  const origin = "http://127.0.0.1:5173";
  let addressCalls = 0;
  const outstanding = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const path = new URL(String(url)).pathname;
    assert(
      String(url).startsWith("https://blockbook.testnet.pearlresearch.ai/"),
      "External access prohibited by fixture",
    );
    if (path === "/api/v2/")
      return new Response(
        JSON.stringify({
          blockbook: {
            decimals: 8,
            inSync: true,
            initialSync: false,
            inSyncMempool: true,
            bestHeight: 200,
          },
          backend: {
            chain: "testnet2",
            blocks: 200,
            bestBlockHash: blockHash(200),
          },
        }),
      );
    if (path.startsWith("/api/v2/block-index/"))
      return new Response(
        JSON.stringify({
          blockHash: path.endsWith("/0")
            ? NETWORKS.testnet2.genesisHash
            : blockHash(200),
        }),
      );
    assert(path.startsWith("/api/v2/address/"));
    addressCalls++;
    if (addressCalls % 5 === 1) return new Response("{}", { status: 503 });
    return new Promise((resolve, reject) => {
      const signal = init.signal;
      outstanding.push({ signal, resolve, url: String(url) });
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      });
    });
  };
  const middleware = lightMiddleware(origin);
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  async function discover() {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/light/discover",
          method: "POST",
          headers: {
            Host: "127.0.0.1:5173",
            Origin: origin,
            "Content-Type": "application/json",
            "X-Pearl-Companion": "1",
          },
        },
        (res) => {
          let body = "";
          res.on("data", (x) => (body += x));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on("error", reject);
      req.end(
        JSON.stringify({
          network: "testnet2",
          consent: true,
          account: accountToJson({ ...publicAccount, network: "testnet2" }),
          minimumIndex: [-1, -1],
        }),
      );
    });
  }
  const results = {};
  try {
    results.first = await discover();
    results.afterFirst = {
      totalAddressCalls: addressCalls,
      stillLive: outstanding.filter((x) => !x.signal.aborted).length,
    };
    assert.equal(results.first.status, 400);
    assert.equal(results.afterFirst.stillLive, 0);
    results.second = await discover();
    results.afterSecond = {
      totalAddressCalls: addressCalls,
      stillLive: outstanding.filter((x) => !x.signal.aborted).length,
    };
    assert.equal(results.second.status, 400);
    assert.equal(results.afterSecond.stillLive, 0);
  } finally {
    for (const o of outstanding) o.resolve(new Response("{}", { status: 503 }));
    globalThis.fetch = oldFetch;
    await new Promise((r) => server.close(() => r()));
  }
  console.log(
    "PASS: failed discovery aborts all siblings before admitting a retry",
  );
}
async function successfulDiscovery() {
  const origin = "http://127.0.0.1:5173";
  let addressCalls = 0;
  const outstanding = [];
  const allSignals = [];
  const oldFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const parsedUrl = new URL(String(url));
    const path = parsedUrl.pathname;
    allSignals.push(init.signal);
    assert(
      String(url).startsWith("https://blockbook.testnet.pearlresearch.ai/"),
      "External access prohibited by fixture",
    );
    if (path === "/api/v2/")
      return new Response(
        JSON.stringify({
          blockbook: {
            decimals: 8,
            inSync: true,
            initialSync: false,
            inSyncMempool: true,
            bestHeight: 200,
          },
          backend: {
            chain: "testnet2",
            blocks: 200,
            bestBlockHash: blockHash(200),
          },
        }),
      );
    if (path.startsWith("/api/v2/block-index/"))
      return new Response(
        JSON.stringify({
          blockHash: path.endsWith("/0")
            ? NETWORKS.testnet2.genesisHash
            : blockHash(200),
        }),
      );
    assert(path.startsWith("/api/v2/address/"));
    addressCalls++;
    return new Response(
      JSON.stringify({
        address: decodeURIComponent(path.split("/").at(-1)),
        txs: 0,
        unconfirmedTxs: 0,
        totalPages: 0,
        page: 1,
        itemsOnPage: 1e3,
        txids: [],
      }),
    );
  };
  const middleware = lightMiddleware(origin);
  const server = createServer((req, res) => {
    void middleware(req, res, () => {
      res.writeHead(404);
      res.end();
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  async function discover() {
    return new Promise((resolve, reject) => {
      const req = request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/api/light/discover",
          method: "POST",
          headers: {
            Host: "127.0.0.1:5173",
            Origin: origin,
            "Content-Type": "application/json",
            "X-Pearl-Companion": "1",
          },
        },
        (res) => {
          let body = "";
          res.on("data", (x) => (body += x));
          res.on("end", () => resolve({ status: res.statusCode, body }));
        },
      );
      req.on("error", reject);
      req.end(
        JSON.stringify({
          network: "testnet2",
          consent: true,
          account: accountToJson({ ...publicAccount, network: "testnet2" }),
          minimumIndex: [-1, -1],
        }),
      );
    });
  }
  const results = {};
  try {
    results.first = await discover();
    assert.equal(results.first.status, 200);
    results.afterFirst = {
      totalAddressCalls: addressCalls,
      stillLive: allSignals.filter((x) => !x.aborted).length,
    };
    assert.equal(results.afterFirst.stillLive, 0);
    assert.equal(JSON.parse(results.first.body).complete, true);
    results.second = await discover();
    assert.equal(results.second.status, 200);
    results.afterSecond = {
      totalAddressCalls: addressCalls,
      stillLive: allSignals.filter((x) => !x.aborted).length,
    };
    assert.equal(results.afterSecond.stillLive, 0);
  } finally {
    for (const o of outstanding) o.resolve(new Response("{}", { status: 503 }));
    globalThis.fetch = oldFetch;
    await new Promise((r) => server.close(() => r()));
  }
  console.log(
    "PASS: successful discovery remains complete and releases its operation scope before retry",
  );
}
await bodyCleanup();
await siblingCleanup();
await successfulDiscovery();
