import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest, type OutgoingHttpHeaders } from "node:http";
import { mkdtemp, mkdir, writeFile, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { createWalletServer, WALLET_CSP } from "../src/web-server.js";

const origin = "https://wallet.example.com";
const js = "/assets/index-Abcd1234.js";
const css = "/assets/index-Efgh5678.css";
const html = `<!doctype html><link rel="stylesheet" href="${css}"><script type="module" src="${js}"></script>`;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "pearl-web-server-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "assets"));
  await writeFile(join(directory, "index.html"), html);
  await writeFile(join(directory, js), "export const publicBuild = true;\n");
  await writeFile(join(directory, css), "body{color:#fff}\n");
  await writeFile(
    join(directory, "assets", "index-Abcd1234.js.map"),
    "private-source-map",
  );
  await writeFile(
    join(directory, "assets", "source.ts"),
    "private-server-source",
  );
  await writeFile(
    join(directory, "example-watch.json"),
    "public-fixture-not-a-wallet-route",
  );
  return directory;
}
type Result = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
};
async function start(t: TestContext, fetcher?: typeof fetch) {
  const directory = await fixture(t);
  const server = await createWalletServer({
    origin,
    distDirectory: directory,
    ...(fetcher ? { fetcher } : {}),
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const port = address.port;
  function request(
    path = "/",
    method = "GET",
    headers: OutgoingHttpHeaders = {},
    body?: string,
  ): Promise<Result> {
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path,
          method,
          headers: Object.fromEntries(
            Object.entries({
              host: "wallet.example.com",
              "x-forwarded-proto": "https",
              ...headers,
            }).filter(([, value]) => value !== undefined),
          ),
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          response.on("error", reject);
          response.on("end", () =>
            resolve({
              status: response.statusCode!,
              headers: response.headers,
              body: Buffer.concat(chunks).toString("utf8"),
            }),
          );
        },
      );
      req.on("error", reject);
      req.end(body);
    });
  }
  const post = (
    value: unknown,
    headers: OutgoingHttpHeaders = {},
    path = "/api/indexer/read",
  ) => {
    const body = JSON.stringify(value);
    return request(
      path,
      "POST",
      {
        origin,
        "x-pearl-companion": "1",
        "content-type": "application/json",
        "content-length": Buffer.byteLength(body),
        "sec-fetch-site": "same-origin",
        ...headers,
      },
      body,
    );
  };
  return { request, post, directory, server, port };
}

test("production requires an exact HTTPS origin and a complete compiled build", async (t) => {
  const directory = await fixture(t);
  for (const bad of [
    "",
    "http://wallet.example.com",
    "http://127.0.0.1:5173",
    `${origin}/`,
    `${origin}/path`,
    `${origin}?x=1`,
    `${origin}#x`,
    "https://u:p@wallet.example.com",
    "https://WALLET.example.com",
  ]) {
    await assert.rejects(
      createWalletServer({ origin: bad, distDirectory: directory }),
    );
  }
  const server = await createWalletServer({
    origin: `${origin}:8443`,
    distDirectory: directory,
  });
  assert.equal(server.listening, false);
  await writeFile(
    join(directory, "index.html"),
    '<script type="module" src="/src/main.ts"></script>',
  );
  await assert.rejects(
    createWalletServer({ origin, distDirectory: directory }),
    /Build first/,
  );
});

test("production HTTP serves external scripts/styles with real CSP and cache/security headers", async (t) => {
  const { request, server } = await start(t);
  for (const path of ["/", "/index.html", js, css]) {
    const result = await request(path);
    assert.equal(result.status, 200);
    assert.equal(result.headers["content-security-policy"], WALLET_CSP);
    assert.equal(result.headers["x-frame-options"], "DENY");
    assert.equal(result.headers["x-content-type-options"], "nosniff");
    assert.equal(result.headers["referrer-policy"], "no-referrer");
    assert.equal(result.headers["cross-origin-opener-policy"], "same-origin");
    assert.equal(result.headers["cross-origin-resource-policy"], "same-origin");
    assert.match(String(result.headers["permissions-policy"]), /hid=\(self\)/);
    assert.equal(
      result.headers["strict-transport-security"],
      "max-age=31536000",
    );
    assert.equal(result.headers["set-cookie"], undefined);
    assert.equal(result.headers["access-control-allow-origin"], undefined);
    assert.equal(result.headers["report-to"], undefined);
    assert.equal(result.headers["reporting-endpoints"], undefined);
    assert.equal(result.headers["server"], undefined);
    assert.equal(
      result.headers["cache-control"],
      path.startsWith("/assets/")
        ? "public, max-age=31536000, immutable"
        : "no-store",
    );
    const head = await request(path, "HEAD");
    assert.equal(head.status, 200);
    assert.equal(head.body, "");
    assert.equal(
      head.headers["content-length"],
      result.headers["content-length"],
    );
  }
  assert.match(WALLET_CSP, /connect-src 'self'(?:;|$)/);
  assert.doesNotMatch(WALLET_CSP, /unsafe-|https:|wss?:|blob:|report-/);
  assert.equal(server.headersTimeout, 5_000);
  assert.equal(server.requestTimeout, 10_000);
  assert.equal(server.timeout, 30_000);
  assert.equal(server.maxConnections, 128);
  assert.equal(server.maxHeadersCount, 32);
});

test("HTTP cannot serve traversal, source, maps, fixtures, directories, arbitrary SPA paths or URL parameters", async (t) => {
  const { request } = await start(t);
  const denied = [
    "/src/main.ts",
    "/src/web-server.ts",
    "/.env",
    "/.git/config",
    "/package.json",
    "/assets/",
    "/assets/source.ts",
    "/assets/index-Abcd1234.js.map",
    "/example-watch.json",
    "/wallet",
    "/api/check",
    "/api/reconcile",
    "/api/broadcast",
    "/api/light/discover",
    "/api/indexer/read?path=/api/v2/",
    "/index.html?account=xpub",
    `${js}?version=1`,
    "/../index.html",
    "/assets/../../index.html",
    "/assets/%2e%2e/index.html",
    "/assets%2findex-Abcd1234.js",
    "/%2e%2e/.env",
    "/%252e%252e/.env",
    "/%00",
    "/assets\\..\\index.html",
    "//index.html",
    "https://wallet.example.com/",
    "/" + "a".repeat(513),
  ];
  for (const path of denied) {
    const result = await request(path);
    assert.equal(result.status, 404, path);
    assert.equal(result.headers["cache-control"], "no-store");
    assert.doesNotMatch(
      result.body,
      /private-source-map|private-server-source|public-fixture|publicBuild|xpub/,
    );
  }
});

test("production never follows build asset symlinks or serves files added after startup", async (t) => {
  const { directory, request } = await start(t);
  await writeFile(join(directory, "assets", "late-Abcd1234.js"), "late-secret");
  assert.equal((await request("/assets/late-Abcd1234.js")).status, 404);
  const target = join(directory, "server-secret.txt");
  await writeFile(target, "do-not-serve");
  await symlink(target, join(directory, "assets", "secret-Abcd1234.js"));
  await assert.rejects(
    createWalletServer({ origin, distDirectory: directory }),
    /invalid or oversized asset/,
  );
});

test("HTTP rejects forged/missing Host, non-HTTPS proxy and foreign Origin without CORS", async (t) => {
  const { request } = await start(t);
  for (const headers of [
    { host: "evil.example", "x-forwarded-host": "wallet.example.com" },
    { host: "wallet.example.com:443" },
    { host: "WALLET.example.com" },
    { host: undefined },
    { "x-forwarded-proto": "http" },
    { "x-forwarded-proto": "https,http" },
    { "x-forwarded-proto": undefined },
  ])
    assert.equal((await request("/", "GET", headers)).status, 421);
  for (const value of [
    "https://evil.example",
    "null",
    "https://wallet.example.com.evil.example",
    `${origin}/`,
  ]) {
    const response = await request("/", "GET", { origin: value });
    assert.equal(response.status, 403);
    assert.equal(response.headers["access-control-allow-origin"], undefined);
  }
  assert.equal((await request("/", "GET", { origin })).status, 200);
});

test("HTTP exposes no uploads, form submission, OPTIONS, PUT, DELETE, or private-node API", async (t) => {
  let calls = 0;
  const fetcher: typeof fetch = async () => {
    calls++;
    return new Response("{}");
  };
  const { request, post } = await start(t, fetcher);
  for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS", "TRACE"]) {
    assert.equal((await request("/", method)).status, 405, method);
  }
  for (const method of ["GET", "HEAD", "PUT", "DELETE", "OPTIONS"]) {
    assert.equal(
      (await request("/api/indexer/read", method)).status,
      405,
      method,
    );
  }
  for (const path of [
    "/api/check",
    "/api/reconcile",
    "/api/broadcast",
    "/api/light/discover",
    "/upload",
  ]) {
    assert.equal(
      (await post({ password: "synthetic-secret" }, {}, path)).status,
      405,
      path,
    );
  }
  assert.equal(
    (await request("/", "GET", { "content-length": "1" }, "x")).status,
    400,
  );
  assert.equal(calls, 0);
});

test("only explicit same-origin consented fixed-indexer JSON reaches the backend; credentials never forwarded", async (t) => {
  const calls: { url: string; options?: RequestInit | undefined }[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response('{"blockbook":{"coin":"Pearl"}}', {
      headers: { "content-type": "application/json" },
    });
  };
  const { post } = await start(t, fetcher);
  const body = { network: "mainnet", consent: true, path: "/api/v2/" };
  const good = await post(body, {
    cookie: "irrelevant=synthetic",
    authorization: "Bearer synthetic",
  });
  assert.equal(good.status, 200);
  assert.equal(good.headers["cache-control"], "no-store");
  assert.equal(good.headers["content-security-policy"], WALLET_CSP);
  assert.deepEqual(JSON.parse(good.body), { blockbook: { coin: "Pearl" } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://blockbook.pearlresearch.ai/api/v2/");
  assert.equal(calls[0]!.options?.redirect, "error");
  assert.deepEqual(calls[0]!.options?.headers, { accept: "application/json" });
  assert.equal(calls[0]!.options?.body, undefined);
  for (const invalid of [
    { ...body, consent: false },
    { ...body, network: "regtest" },
    { ...body, path: "https://127.0.0.1:8334/" },
    { ...body, path: "/api/v2/sendtx/aa" },
    { ...body, password: "synthetic-secret" },
    { ...body, account: { chainCode: "synthetic" } },
    { ...body, url: "https://evil.example/" },
  ]) {
    const response = await post(invalid);
    assert.equal(response.status, 400);
    assert.doesNotMatch(response.body, /synthetic|127\.0\.0\.1|evil/);
  }
  for (const headers of [
    { origin: undefined },
    { "x-pearl-companion": undefined },
    { "sec-fetch-site": "cross-site" },
  ]) {
    assert.equal((await post(body, headers)).status, 403);
  }
  assert.equal(
    calls.length,
    1,
    "rejected requests must not contact an upstream",
  );
});

test("API refuses streaming/oversized/compressed/form/Expect request bodies before any upstream call", async (t) => {
  let calls = 0;
  const { post, request } = await start(t, async () => {
    calls++;
    return new Response("{}");
  });
  const body = { network: "mainnet", consent: true, path: "/api/v2/" };
  assert.equal(
    (await post({ ...body, extra: "x".repeat(128 * 1024) })).status,
    413,
  );
  assert.equal(
    (await post(body, { "content-type": "multipart/form-data" })).status,
    415,
  );
  assert.equal((await post(body, { "content-encoding": "gzip" })).status, 415);
  assert.equal((await post(body, { expect: "100-continue" })).status, 417);
  assert.equal(
    (
      await request(
        "/api/indexer/read",
        "POST",
        {
          origin,
          "x-pearl-companion": "1",
          "content-type": "application/json",
          "transfer-encoding": "chunked",
        },
        JSON.stringify(body),
      )
    ).status,
    411,
  );
  assert.equal(
    (
      await post(
        {
          network: "mainnet",
          consent: true,
          rawTx: "00",
          expectedTxid: "0".repeat(64),
        },
        {},
        "/api/indexer/broadcast",
      )
    ).status,
    400,
  );
  assert.equal(calls, 0);
});

test("raw HTTP duplicate Host and Origin headers are rejected rather than normalized into trust", async (t) => {
  const { port } = await start(t);
  async function raw(extra: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const socket = connect(port, "127.0.0.1", () =>
        socket.write(
          `GET / HTTP/1.1\r\nHost: wallet.example.com\r\nX-Forwarded-Proto: https\r\n${extra}Connection: close\r\n\r\n`,
        ),
      );
      let response = "";
      socket.setTimeout(2000, () =>
        socket.destroy(new Error("test request timed out")),
      );
      socket.on("data", (chunk) => {
        response += chunk.toString();
      });
      socket.on("error", reject);
      socket.on("end", () => resolve(response));
    });
  }
  assert.match(await raw("Host: wallet.example.com\r\n"), /^HTTP\/1\.1 421 /);
  assert.match(
    await raw(`Origin: ${origin}\r\nOrigin: ${origin}\r\n`),
    /^HTTP\/1\.1 421 /,
  );
  assert.match(await raw("X-Forwarded-Proto: https\r\n"), /^HTTP\/1\.1 421 /);
});
