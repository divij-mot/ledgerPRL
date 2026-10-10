import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createServer, request as httpRequest } from "node:http";
import { readFileSync } from "node:fs";
import { NETWORKS } from "@pearl-ledger/sdk";
import { createHostedIndexer, hostedOrigin } from "../src/hosted-indexer.js";

const origin = "https://pearl-wallet.example.com";
const read = { network: "mainnet", consent: true, path: "/api/v2/" };
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
) as { rawTx: string; txid: string };

async function invoke({
  bytes = Buffer.from(JSON.stringify(read)),
  mutate = (_request: IncomingMessage) => {},
  fetcher = (async () => new Response('{"ok":true}')) as typeof fetch,
  url = "/api/indexer/read",
} = {}) {
  const headers: Record<string, string> = {
    host: new URL(origin).host,
    origin,
    "x-forwarded-proto": "https",
    "content-type": "application/json",
    "content-length": String(bytes.length),
    "x-pearl-companion": "1",
    "sec-fetch-site": "same-origin",
  };
  const request = Object.assign(new PassThrough(), {
    method: "POST",
    url,
    headers,
    rawHeaders: Object.entries(headers).flat(),
  }) as unknown as IncomingMessage;
  let status = 0,
    body = "";
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    setHeader() {},
    writeHead(value: number) {
      status = value;
    },
    end(value: string) {
      body = value;
      this.writableEnded = true;
    },
  }) as unknown as ServerResponse;
  mutate(request);
  const pending = createHostedIndexer(origin, fetcher)(request, response);
  (request as unknown as PassThrough).end(bytes);
  await pending;
  return { status, body: JSON.parse(body) as Record<string, unknown> };
}

test("hosted origins are explicit for production and deployment-bound for preview", () => {
  assert.equal(
    hostedOrigin({ PEARL_WEB_ORIGIN: origin, VERCEL_ENV: "production" }),
    origin,
  );
  assert.equal(
    hostedOrigin({
      VERCEL_ENV: "preview",
      VERCEL_URL: "pearl-abc-team.vercel.app",
    }),
    "https://pearl-abc-team.vercel.app",
  );
  for (const env of [
    {},
    { VERCEL_ENV: "production", VERCEL_URL: "pearl.vercel.app" },
    { VERCEL_ENV: "preview", VERCEL_URL: "attacker.example" },
    { VERCEL_ENV: "preview", VERCEL_URL: "good.vercel.app/anything" },
    ...[
      "http://127.0.0.1:5188",
      `${origin}/`,
      `${origin}/path`,
      `${origin}?q=1`,
      "https://user:pass@wallet.example",
      "https://127.0.0.1",
      "https://wallet.localhost",
      "https://wallet.example:8443",
    ].map((value) => ({ PEARL_WEB_ORIGIN: value })),
  ])
    assert.throws(() => hostedOrigin(env));
});

test("raw adapter passes a bounded allowed read once with no storage or response cache", async () => {
  let calls = 0;
  const result = await invoke({
    fetcher: async (input, init) => {
      calls++;
      assert.equal(input, "https://blockbook.pearlresearch.ai/api/v2/");
      assert.equal(init?.redirect, "error");
      return new Response('{"ok":true}');
    },
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { ok: true });
  assert.equal(calls, 1);
});

test("hosted boundary rejects malformed frames, helpers and cross-origin requests before fetching", async () => {
  const invalid: Array<(request: IncomingMessage) => void> = [
    (r) => {
      r.method = "GET";
    },
    (r) => {
      r.url += "?path=elsewhere";
    },
    (r) => {
      r.url = "/api/local/status";
    },
    (r) => {
      r.headers.origin = "https://attacker.example";
    },
    (r) => {
      r.headers.host = "attacker.example";
      r.headers["x-forwarded-host"] = new URL(origin).host;
    },
    (r) => {
      r.headers["x-forwarded-proto"] = "http";
    },
    (r) => {
      r.headers["sec-fetch-site"] = "cross-site";
    },
    (r) => {
      r.rawHeaders.push("Origin", origin);
    },
    (r) => {
      r.rawHeaders.push("Content-Length", r.headers["content-length"]!);
    },
    (r) => {
      delete r.headers["content-length"];
    },
    (r) => {
      r.headers["content-length"] = "131073";
    },
    (r) => {
      r.headers["content-length"] = "2";
    },
    (r) => {
      r.headers["content-length"] = "999";
    },
    (r) => {
      r.headers["transfer-encoding"] = "chunked";
    },
    (r) => {
      r.headers["content-type"] = "text/plain";
    },
    (r) => {
      r.headers["content-encoding"] = "gzip";
    },
    (r) => {
      r.headers.expect = "100-continue";
    },
    (r) => {
      Object.defineProperty(r, "body", {
        get() {
          throw new Error("must not access helper");
        },
      });
    },
  ];
  for (const mutate of invalid) {
    let calls = 0;
    const result = await invoke({
      mutate,
      fetcher: async () => {
        calls++;
        throw new Error("forbidden fetch");
      },
    });
    assert(result.status >= 400);
    assert.equal(calls, 0);
  }
  const invalidUTF8 = await invoke({
    bytes: Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]),
  });
  assert.equal(invalidUTF8.status, 400);
});

test("arbitrary URL and undisclosed address requests remain rejected by the shared proxy", async () => {
  for (const body of [
    { ...read, path: "https://attacker.example/" },
    { ...read, consent: false },
    { ...read, path: "/api/v2/utxo/xpubnotanaddress" },
    { ...read, account: { privateKey: "forbidden" } },
  ]) {
    let calls = 0;
    const result = await invoke({
      bytes: Buffer.from(JSON.stringify(body)),
      fetcher: async () => {
        calls++;
        throw new Error("must not fetch");
      },
    });
    assert.equal(result.status, 400);
    assert.equal(calls, 0);
  }
});

test("hosted signed relay checks chain identity and submits exact public fixture once", async () => {
  let submissions = 0,
    reads = 0;
  const result = await invoke({
    url: "/api/indexer/broadcast",
    bytes: Buffer.from(
      JSON.stringify({
        network: "mainnet",
        consent: true,
        rawTx: fixture.rawTx,
        expectedTxid: fixture.txid,
      }),
    ),
    fetcher: async (input, init) => {
      const url = String(input);
      if (url.endsWith("/sendtx/")) {
        assert.equal(reads, 3);
        submissions++;
        assert.equal(init?.body, fixture.rawTx);
        // Simulate an ambiguous network failure AFTER submission; never retry.
        throw new Error("private upstream detail must not leak");
      }
      reads++;
      if (url.endsWith("/api/v2/"))
        return Response.json({
          blockbook: {
            decimals: 8,
            inSync: true,
            initialSync: false,
            inSyncMempool: true,
            bestHeight: 200,
          },
          backend: {
            chain: "mainnet",
            blocks: 200,
            bestBlockHash: "22".repeat(32),
          },
        });
      return Response.json({
        blockHash: url.endsWith("/block-index/0")
          ? NETWORKS.mainnet.genesisHash
          : "22".repeat(32),
      });
    },
  });
  assert.equal(submissions, 1);
  assert.equal(result.status, 400);
  assert.match(String(result.body.error), /Keep the exact signed payment/);
  assert(!JSON.stringify(result.body).includes("private upstream"));
});

test("real Node HTTP stream remains compatible with the raw serverless adapter", async () => {
  let calls = 0;
  const handler = createHostedIndexer(origin, async () => {
    calls++;
    return Response.json({ ok: true });
  });
  const server = createServer((request, response) => {
    void handler(request, response);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    assert(address && typeof address !== "string");
    const payload = JSON.stringify(read);
    const status = await new Promise<number>((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port: address.port,
          path: "/api/indexer/read",
          method: "POST",
          headers: {
            host: new URL(origin).host,
            origin,
            "x-forwarded-proto": "https",
            "x-pearl-companion": "1",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          res.resume();
          res.once("end", () => resolve(res.statusCode!));
        },
      );
      req.once("error", reject);
      req.end(payload);
    });
    assert.equal(status, 200);
    assert.equal(calls, 1);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
