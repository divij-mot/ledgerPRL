/** Independent host-boundary review. Loopback only; every upstream is injected. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, type ClientRequest } from "node:http";
import { connect } from "node:net";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createWalletServer } from "../../apps/companion/src/web-server.js";
import { BlockbookSource } from "../../apps/companion/src/blockbook-source.js";
import {
  concat,
  i32,
  u32,
  u64,
  hex,
  parseTransaction,
  NETWORKS,
  scriptToAddress,
} from "@pearl-ledger/sdk";

const origin = "https://wallet.example.com";
const host = "wallet.example.com";
const readBody = { network: "mainnet", consent: true, path: "/api/v2/" };
const testnetAddress = scriptToAddress(
  concat(Uint8Array.of(0x52, 0x20), new Uint8Array(32).fill(0x42)),
  "testnet2",
);
const tick = () => new Promise<void>((resolve) => setImmediate(resolve));
async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert(check(), "bounded test condition did not become true");
}
type Result = { status: number; body: string };
async function build(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "pearl-host-independent-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await writeFile(
    join(directory, "third-party-notices.txt"),
    "Public synthetic dependency notice.\n",
  );
  await writeFile(
    join(directory, "index.html"),
    '<link href="/assets/main-Abcd1234.css"><script src="/assets/main-Abcd1234.js"></script>',
  );
  await writeFile(
    join(directory, "assets/main-Abcd1234.js"),
    "export const testOnly = true;",
  );
  await writeFile(
    join(directory, "assets/main-Abcd1234.css"),
    "body{color:black}",
  );
  return directory;
}
async function start(t: TestContext, fetcher: typeof fetch) {
  const directory = await build(t);
  const server = await createWalletServer({
    origin,
    distDirectory: directory,
    fetcher,
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port;
  function post(value: unknown = readBody, route = "/api/indexer/read") {
    let client!: ClientRequest;
    const promise = new Promise<Result>((resolve, reject) => {
      const body = JSON.stringify(value);
      client = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: route,
          method: "POST",
          headers: {
            host,
            origin,
            "x-forwarded-proto": "https",
            "x-pearl-companion": "1",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "sec-fetch-site": "same-origin",
          },
        },
        (response) => {
          let body = "";
          response.on("data", (chunk) => {
            body += chunk.toString();
          });
          response.on("error", reject);
          response.on("end", () =>
            resolve({ status: response.statusCode!, body }),
          );
        },
      );
      client.on("error", reject);
      client.end(body);
    });
    return { client, promise };
  }
  async function raw(data: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () => socket.write(data));
      socket.setTimeout(1500, () =>
        socket.destroy(new Error("bounded raw probe timed out")),
      );
      let value = "";
      socket.on("data", (chunk) => {
        value += chunk.toString();
      });
      socket.on("error", reject);
      socket.on("end", () => resolve(value));
    });
  }
  return { post, raw, directory };
}
function rawPost(body: string, extra = "", length = Buffer.byteLength(body)) {
  return `POST /api/indexer/read HTTP/1.1\r\nHost: ${host}\r\nOrigin: ${origin}\r\nX-Forwarded-Proto: https\r\nX-Pearl-Companion: 1\r\nContent-Type: application/json\r\nContent-Length: ${length}\r\n${extra}Connection: close\r\n\r\n${body}`;
}
const neverFetch: typeof fetch = async () => {
  throw new Error("unexpected upstream call");
};

test("supported Node rejects late trust headers beyond its count and byte limits", async (t) => {
  const { raw } = await start(t, neverFetch);
  const padding = Array.from(
    { length: 32 },
    (_, i) => `X-Pad-${i}: a\r\n`,
  ).join("");
  for (const late of [
    `Origin: https://attacker.invalid\r\n`,
    `Host: attacker.invalid\r\n`,
  ])
    assert.match(
      await raw(
        `GET / HTTP/1.1\r\nHost: ${host}\r\nX-Forwarded-Proto: https\r\n${padding}${late}Connection: close\r\n\r\n`,
      ),
      /^HTTP\/1\.1 431 /,
    );
  assert.match(
    await raw(
      `GET / HTTP/1.1\r\nHost: ${host}\r\nX-Padding: ${"a".repeat(8192)}\r\n\r\n`,
    ),
    /^HTTP\/1\.1 431 /,
  );
});

test("ambiguous HTTP framing never reaches the injected upstream", async (t) => {
  let calls = 0;
  const { raw } = await start(t, async () => {
    calls++;
    return new Response("{}");
  });
  const body = JSON.stringify(readBody);
  for (const extra of [
    `Content-Length: ${body.length}\r\n`,
    "Transfer-Encoding: chunked\r\n",
  ])
    assert.match(await raw(rawPost(body, extra)), /^HTTP\/1\.1 400 /);
  assert.equal(calls, 0);
});

test("128 KiB is accepted exactly and oversized declared bodies reject without waiting", async (t) => {
  let calls = 0;
  const { raw } = await start(t, async () => {
    calls++;
    return new Response("{}");
  });
  const text = JSON.stringify(readBody);
  const exact = text + " ".repeat(128 * 1024 - text.length);
  assert.match(await raw(rawPost(exact)), /^HTTP\/1\.1 200 /);
  assert.match(await raw(rawPost("", "", 128 * 1024 + 1)), /^HTTP\/1\.1 413 /);
  assert.equal(calls, 1);
});

test("all read operations stay on one selected host and mutating/private paths fail before fetch", async (t) => {
  const seen: string[] = [];
  const { post } = await start(t, async (input, init) => {
    seen.push(String(input));
    assert.equal(init?.method, undefined);
    assert.equal(init?.redirect, "error");
    assert.deepEqual(init?.headers, { accept: "application/json" });
    return new Response("{}");
  });
  for (const path of [
    "/api/v2/",
    "/api/v2/block-index/0",
    `/api/v2/utxo/${testnetAddress}`,
    `/api/v2/tx/${"11".repeat(32)}`,
    `/api/v2/address/${testnetAddress}?details=txids&pageSize=1000&page=2`,
  ])
    assert.equal(
      (await post({ ...readBody, network: "testnet2", path }).promise).status,
      200,
    );
  assert(
    seen.every((url) =>
      url.startsWith("https://blockbook.testnet.pearlresearch.ai/api/v2/"),
    ),
  );
  for (const path of [
    "//attacker.invalid/",
    "https://attacker.invalid/api/v2/",
    "/api/v2/sendtx/00",
    "/api/v2/xpub/abcd",
    "/api/v2/utxo/a%2fb",
    "/api/v2/tx/" + "11".repeat(32) + "?x=1",
    "/api/v2/address/a?details=txids&pageSize=1000&page=1&x=1",
    "/api/v2/block-index/0/../sendtx/00",
    "/api/v2/address/a?details=txids&pageSize=1000&page=3",
    "/api/v2/\n",
    `/api/v2/tx/${"11".repeat(32)}\n`,
  ])
    assert.equal((await post({ ...readBody, path }).promise).status, 400, path);
  assert.equal(seen.length, 5);
});

test("read failures never reflect private input or upstream exception bodies and never retry", async (t) => {
  let calls = 0;
  const { post } = await start(t, async () => {
    calls++;
    throw Error("synthetic-private-upstream-error");
  });
  const response = await post().promise;
  assert.equal(response.status, 400);
  assert.doesNotMatch(response.body, /synthetic-private/);
  assert.equal(calls, 1);
  assert.equal(
    (await post({ ...readBody, account: "synthetic-private-account" }).promise)
      .status,
    400,
  );
  assert.equal(calls, 1);
});

test("upstream decoded byte limits cancel an oversized chunked response", async (t) => {
  let cancelled = false;
  const { post } = await start(
    t,
    async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new Uint8Array(4 * 1024 * 1024 + 1).fill(32));
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  );
  assert.equal((await post().promise).status, 400);
  assert(cancelled);
});

test("sixteen in-flight reads impose a real global cap and disconnect releases every slot", async (t) => {
  let calls = 0,
    cancelled = 0,
    immediate = false;
  const { post } = await start(t, async (_input, init) => {
    calls++;
    if (immediate) return new Response("{}");
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => {
          cancelled++;
          reject(init!.signal!.reason);
        },
        { once: true },
      );
    });
  });
  const pending = Array.from({ length: 16 }, () => {
    const result = post();
    void result.promise.catch(() => {});
    return result;
  });
  await until(() => calls === 16);
  assert.equal((await post().promise).status, 429);
  assert.equal(calls, 16);
  for (const { client } of pending) client.destroy();
  await Promise.allSettled(pending.map(({ promise }) => promise));
  await until(() => cancelled === 16);
  immediate = true;
  await tick();
  assert.equal((await post().promise).status, 200);
  assert.equal(calls, 17);
});

test("overall operation timeout aborts upstream and permits a subsequent fresh request", async (t) => {
  const original = globalThis.setTimeout;
  const shortened = ((
    fn: (...args: any[]) => void,
    ms?: number,
    ...args: any[]
  ) => original(fn, ms === 25_000 ? 80 : ms, ...args)) as typeof setTimeout;
  globalThis.setTimeout = shortened;
  t.after(() => {
    globalThis.setTimeout = original;
  });
  let aborted = false,
    immediate = false;
  const { post } = await start(t, async (_input, init) => {
    if (immediate) return new Response("{}");
    return new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener(
        "abort",
        () => {
          aborted = true;
          reject(init!.signal!.reason);
        },
        { once: true },
      );
    });
  });
  assert.equal((await post().promise).status, 400);
  assert(aborted);
  immediate = true;
  assert.equal((await post().promise).status, 200);
});

function wireTransaction(
  scriptSig: Uint8Array = new Uint8Array(),
  witnessBytes = 64,
) {
  const bytes = concat(
    i32(1),
    Uint8Array.of(0, 1, 1),
    new Uint8Array(32).fill(0x11),
    u32(0),
    Uint8Array.of(scriptSig.length),
    scriptSig,
    u32(0xffffffff),
    Uint8Array.of(1),
    u64(1n),
    Uint8Array.of(1, 0x51),
    Uint8Array.of(1, witnessBytes),
    new Uint8Array(witnessBytes).fill(0x42),
    u32(0),
  );
  const rawTx = hex(bytes);
  return {
    network: "mainnet",
    consent: true,
    rawTx,
    expectedTxid: parseTransaction(rawTx).txid,
  };
}
function chainReply(url: string, wrongGenesis = false) {
  if (url.endsWith("/api/v2/"))
    return {
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
    };
  if (url.endsWith("/block-index/0"))
    return {
      blockHash: wrongGenesis ? "33".repeat(32) : NETWORKS.mainnet.genesisHash,
    };
  assert(url.endsWith("/block-index/200"));
  return { blockHash: "22".repeat(32) };
}

test("broadcast shape/txid/extra-field rejection occurs before even a chain request", async (t) => {
  let calls = 0;
  const { post } = await start(t, async () => {
    calls++;
    throw Error("unexpected upstream");
  });
  const good = wireTransaction();
  for (const value of [
    { ...good, expectedTxid: "ff".repeat(32) },
    wireTransaction(new Uint8Array(), 63),
    { ...good, rawTx: good.rawTx + "00" },
    { ...good, bundleHex: "synthetic-private" },
    { ...good, network: "regtest" },
    { ...good, consent: false },
  ])
    assert.equal(
      (await post(value, "/api/indexer/broadcast").promise).status,
      400,
    );
  assert.equal(calls, 0);
});

test("broadcast verifies genesis before relaying and leaves upstream acceptance ambiguous on mismatch", async (t) => {
  const value = wireTransaction();
  let submissions = 0,
    wrongGenesis = true;
  const { post } = await start(t, async (input, init) => {
    const url = String(input);
    if (url.endsWith("/sendtx/")) {
      submissions++;
      assert.equal(url, "https://blockbook.pearlresearch.ai/api/v2/sendtx/");
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, value.rawTx);
      assert.equal(init?.redirect, "error");
      assert.deepEqual(init?.headers, { "content-type": "text/plain" });
      return new Response(
        JSON.stringify({
          result: "ff".repeat(32),
          detail: "synthetic-private-upstream",
        }),
      );
    }
    return new Response(JSON.stringify(chainReply(url, wrongGenesis)));
  });
  assert.equal(
    (await post(value, "/api/indexer/broadcast").promise).status,
    400,
  );
  assert.equal(submissions, 0);
  wrongGenesis = false;
  const response = await post(value, "/api/indexer/broadcast").promise;
  assert.equal(response.status, 400);
  assert.match(response.body, /could not be confirmed.*reservations/);
  assert.doesNotMatch(response.body, /synthetic-private/);
  assert.equal(submissions, 1, "an ambiguous broadcast must not be retried");
});

test("the relay rejects nonempty scriptSig before any upstream request", async (t) => {
  let calls = 0;
  const { post } = await start(t, async () => {
    calls++;
    return new Response("{}");
  });
  assert.equal(
    (
      await post(wireTransaction(Uint8Array.of(0x51)), "/api/indexer/broadcast")
        .promise
    ).status,
    400,
  );
  assert.equal(calls, 0);
});

test("characterization: the relay checks key-path structure, not cryptographic validity", async (t) => {
  // Synthetic and intentionally invalid on-chain. No real signed transaction or node is used.
  const value = wireTransaction();
  let submissions = 0;
  const { post } = await start(t, async (input, init) => {
    const url = String(input);
    if (url.endsWith("/sendtx/")) {
      submissions++;
      assert.equal(init?.body, value.rawTx);
      return new Response(JSON.stringify({ result: value.expectedTxid }));
    }
    return new Response(JSON.stringify(chainReply(url)));
  });
  const response = await post(value, "/api/indexer/broadcast").promise;
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body), { txid: value.expectedTxid });
  assert.equal(submissions, 1);
});

test("address tokens reject xpub-like, arbitrary, wrong-network and bad-checksum values before fetch", async () => {
  const urls: string[] = [];
  const source = new BlockbookSource("mainnet", async (input) => {
    urls.push(String(input));
    return new Response("{}");
  });
  for (const address of [
    "xpubSyntheticAlphanumericToken",
    "a",
    testnetAddress,
    testnetAddress.slice(0, -1) + "x",
  ])
    for (const path of [
      `/api/v2/utxo/${address}`,
      `/api/v2/address/${address}?details=txids&pageSize=1000&page=1`,
    ])
      await assert.rejects(source.get(path));
  assert.deepEqual(urls, []);
});

test("static snapshot rejects index and asset-directory symlinks", async (t) => {
  const first = await build(t),
    second = await build(t);
  await rm(join(first, "index.html"));
  await symlink(join(second, "index.html"), join(first, "index.html"));
  await assert.rejects(
    createWalletServer({ origin, distDirectory: first, fetcher: neverFetch }),
    /invalid or oversized asset/,
  );
  await rm(join(first, "index.html"));
  await writeFile(
    join(first, "index.html"),
    '<link href="/assets/main-Abcd1234.css"><script src="/assets/main-Abcd1234.js"></script>',
  );
  await rm(join(first, "assets"), { recursive: true });
  await symlink(join(second, "assets"), join(first, "assets"));
  await assert.rejects(
    createWalletServer({ origin, distDirectory: first, fetcher: neverFetch }),
    /real directory/,
  );
});
