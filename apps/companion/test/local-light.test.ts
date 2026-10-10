/** Real loopback HTTP/body parsing; native process is mocked. No chain, hardware or real funds. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import {
  createServer,
  request as httpRequest,
  type OutgoingHttpHeaders,
} from "node:http";
import { connect } from "node:net";
import { readFileSync } from "node:fs";
import {
  accountFromJson,
  accountToJson,
  bundleFromJson,
  encodeBundle,
  hex,
  NETWORKS,
  type AccountPublicKey,
} from "@pearl-ledger/sdk";
import { accountId } from "@pearl-ledger/wallet";
import { publicAccount } from "../../../packages/wallet/test/fixtures.js";
import { localLightMiddleware } from "../src/local-light.js";
import {
  LIGHT_SOURCE_COMMIT,
  LocalLightRequestError,
  type LightMethod,
  type LightRuntimeStatus,
} from "../src/light-runtime.js";

const vector = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = accountFromJson({
  ...vector.publicAccount,
  network: "mainnet",
});
const foreign = { ...publicAccount, network: "mainnet" as const };
const owner = accountId(account);
const bundle = {
  ...bundleFromJson(vector.bundle),
  network: "mainnet" as const,
};
const payment = {
  bundleHex: hex(encodeBundle(bundle)),
  rawTx: vector.rawTx as string,
  expectedTxid: vector.txid as string,
};
const startBody = { account: accountToJson(account), minimumIndex: [-1, -1] };
function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => (resolve = yes));
  return { promise, resolve };
}
async function waitFor(check: () => boolean) {
  for (let i = 0; i < 200 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert(check(), "Expected local HTTP operation did not reach its boundary");
}
type Result = {
  status: number;
  body: any;
  headers: Record<string, string | string[] | undefined>;
};
async function fixture(t: TestContext) {
  let state: LightRuntimeStatus["state"] = "stopped",
    bound = account;
  const events: string[] = [],
    calls: { method: LightMethod; params: unknown }[] = [];
  let factories = 0;
  const identity = () => ({
    schema: 1,
    sourceCommit: LIGHT_SOURCE_COMMIT,
    watchOnly: true,
    network: "mainnet",
    account: 0,
    publicAccount: accountToJson(bound),
    genesisHash: NETWORKS.mainnet.genesisHash,
    ready: false,
    synced: false,
  });
  const controls = {
    stop: async () => {},
    start: async () => {},
    request: async (
      _method: LightMethod,
      _params: unknown,
      _signal?: AbortSignal,
    ): Promise<unknown> => identity(),
  };
  const native = {
    status: (): LightRuntimeStatus => ({
      state,
      network: "mainnet",
      account: 0,
      registeredThrough: [19, 19],
      error: null,
    }),
    async start(value: AccountPublicKey, minimum: [number, number]) {
      events.push("start:begin");
      state = "starting";
      await controls.start();
      bound = value;
      state = "running";
      events.push("start:end");
      assert(minimum.length === 2);
      return native.status();
    },
    async stop() {
      events.push("stop:begin");
      await controls.stop();
      state = "stopped";
      events.push("stop:end");
    },
    async request(method: LightMethod, params: unknown, signal?: AbortSignal) {
      events.push(`request:${method}`);
      calls.push({ method, params });
      return controls.request(method, params, signal);
    },
  };
  let middleware!: ReturnType<typeof localLightMiddleware>;
  const server = createServer((request, response) => {
    void middleware(request, response, () => {
      response.writeHead(404);
      response.end();
    });
  });
  server.requestTimeout = 3_000;
  server.headersTimeout = 3_000;
  t.after(async () => {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert(address && typeof address !== "string");
  const port = address.port,
    origin = `http://127.0.0.1:${port}`;
  middleware = localLightMiddleware(origin, async () => {
    factories++;
    return native;
  });
  function post(
    value: unknown,
    action = "start",
    headers: OutgoingHttpHeaders = {},
    method = "POST",
    signal?: AbortSignal,
  ): Promise<Result> {
    const body = typeof value === "string" ? value : JSON.stringify(value);
    return new Promise((resolve, reject) => {
      const req = httpRequest(
        {
          hostname: "127.0.0.1",
          port,
          path: `/api/local/${action}`,
          method,
          ...(signal ? { signal } : {}),
          headers: {
            host: `127.0.0.1:${port}`,
            origin,
            "x-pearl-companion": "1",
            "content-type": "application/json",
            "content-length": Buffer.byteLength(body),
            "sec-fetch-site": "same-origin",
            ...headers,
          },
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (bytes) => chunks.push(Buffer.from(bytes)));
          response.on("error", reject);
          response.on("end", () => {
            const text = Buffer.concat(chunks).toString();
            resolve({
              status: response.statusCode!,
              body: text ? JSON.parse(text) : null,
              headers: response.headers,
            });
          });
        },
      );
      req.setTimeout(2500, () => req.destroy(new Error("HTTP test timed out")));
      req.on("error", reject);
      req.end(body);
    });
  }
  function raw(
    lines: string[],
    body = "{}",
    action = "start",
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      let reply = "";
      const socket = connect(port, "127.0.0.1", () =>
        socket.end(
          `POST /api/local/${action} HTTP/1.1\r\n${lines.join("\r\n")}\r\nConnection: close\r\n\r\n${body}`,
        ),
      );
      socket.setTimeout(2500, () =>
        socket.destroy(new Error("Raw HTTP test timed out")),
      );
      socket.on("data", (bytes) => (reply += bytes.toString()));
      socket.on("error", reject);
      socket.on("end", () => resolve(reply));
    });
  }
  const headers = () => [
    `Host: 127.0.0.1:${port}`,
    `Origin: ${origin}`,
    "X-Pearl-Companion: 1",
    "Content-Type: application/json",
    "Content-Length: 2",
  ];
  return {
    post,
    raw,
    headers,
    native,
    controls,
    events,
    calls,
    identity,
    origin,
    port,
    get factories() {
      return factories;
    },
    set state(value: LightRuntimeStatus["state"]) {
      state = value;
    },
  };
}

test("local middleware accepts only an exact numeric loopback origin", () => {
  for (const origin of [
    "https://127.0.0.1:5188",
    "http://localhost:5188",
    "http://[::1]:5188",
    "http://wallet.example",
    "http://127.0.0.1:5188/",
    "http://user:pass@127.0.0.1:5188",
    "http://127.0.0.1:5188?x=1",
  ])
    assert.throws(() =>
      localLightMiddleware(origin, async () => {
        throw new Error("Unexpected runtime");
      }),
    );
});

test("close after an unsuccessful initialization is idempotent without loading a native profile", async (t) => {
  const f = await fixture(t);
  const result = await f.post({ owner }, "close");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { closed: true });
  assert.equal(f.factories, 0);
  assert.equal((await f.post({ owner: "invalid" }, "close")).status, 400);
});

test("real HTTP rejects wrong Origin/Host, cross-site and missing trust headers before touching runtime", async (t) => {
  const f = await fixture(t);
  for (const headers of [
    { origin: "http://attacker.invalid" },
    { origin: "null" },
    { host: "localhost:5188" },
    { "x-pearl-companion": "0" },
    { "content-type": "text/plain" },
    { "sec-fetch-site": "cross-site" },
  ])
    assert.equal((await f.post(startBody, "start", headers)).status, 403);
  assert.equal((await f.post(startBody, "start", {}, "GET")).status, 403);
  const omitted = f.headers().filter((line) => !line.startsWith("Origin:"));
  assert.match(await f.raw(omitted), /^HTTP\/1\.1 403 /);
  assert.equal(f.factories, 0);
  assert.equal(f.calls.length, 0);
});

test("raw duplicate Host, Origin, custom header, Content-Type and Content-Length fail closed", async (t) => {
  const f = await fixture(t);
  for (let index = 0; index < 5; index++) {
    const headers = f.headers();
    headers.push(headers[index]!);
    const reply = await f.raw(headers);
    assert.match(reply, index === 4 ? /^HTTP\/1\.1 400 / : /^HTTP\/1\.1 403 /);
  }
  assert.equal(f.factories, 0);
});

test("HTTP framing requires Content-Length, rejects transfer encoding and bounds bytes to 32 KiB", async (t) => {
  const f = await fixture(t);
  assert.match(
    await f.raw(
      f.headers().filter((line) => !line.startsWith("Content-Length:")),
    ),
    /^HTTP\/1\.1 403 /,
  );
  assert.match(
    await f.raw(
      [
        ...f.headers().filter((line) => !line.startsWith("Content-Length:")),
        "Transfer-Encoding: chunked",
      ],
      "2\r\n{}\r\n0\r\n\r\n",
    ),
    /^HTTP\/1\.1 403 /,
  );
  assert.match(
    await f.raw([...f.headers(), "Transfer-Encoding: chunked"]),
    /^HTTP\/1\.1 400 /,
  );
  for (const size of ["1", "32769", "9999999999999999999999"])
    assert.match(
      await f.raw(
        f
          .headers()
          .map((line) =>
            line.startsWith("Content-Length:")
              ? `Content-Length: ${size}`
              : line,
          ),
        size === "1" ? "x" : "",
      ),
      /^HTTP\/1\.1 (?:400|413) /,
    );
  assert.equal(f.factories, 0);
  const json = JSON.stringify(startBody),
    exact = json + " ".repeat(32768 - Buffer.byteLength(json));
  assert.equal((await f.post(exact)).status, 200);
  assert.equal((await f.post(exact + " ")).status, 413);
  assert.equal(f.events.filter((x) => x === "start:begin").length, 1);
});

test("only exact local routes and method-shaped fields are accepted; no URLs, paths or runtime config", async (t) => {
  const f = await fixture(t);
  for (const action of [
    "stop",
    "rpc",
    "walletpassphrase",
    "../status",
    "status?x=1",
    "status/",
    "%73tatus",
  ])
    assert.equal((await f.post({}, action)).status, 404);
  assert.equal(f.factories, 0);
  for (const extra of [
    { dataDir: "/existing/wallet" },
    { executable: "/bin/sh" },
    { rpcUrl: "http://attacker.invalid" },
    { method: "sendmany" },
  ])
    assert.equal((await f.post({ ...startBody, ...extra })).status, 400);
  for (const minimumIndex of [[-2, 0], [980, 0], [0.5, 0], [0], [0, 0, 0]])
    assert.equal((await f.post({ ...startBody, minimumIndex })).status, 400);
  assert.equal(f.events.length, 0);
  assert.equal((await f.post(startBody)).status, 200);
  for (const action of [
    "status",
    "snapshot",
    "register",
    "blockHash",
    "broadcast",
  ])
    assert.equal(
      (
        await f.post(
          { owner, executable: "/bin/sh", url: "https://attacker.invalid" },
          action,
        )
      ).status,
      400,
    );
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["status"],
  );
});

test("account binding prevents another public account or network from using an active profile", async (t) => {
  const f = await fixture(t);
  assert.equal(
    (
      await f.post({
        ...startBody,
        account: { ...startBody.account, network: "testnet2" },
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await f.post({
        ...startBody,
        account: { ...startBody.account, account: 1 },
      })
    ).status,
    400,
  );
  assert.equal((await f.post(startBody)).status, 200);
  assert.equal(
    (await f.post({ account: accountToJson(foreign), minimumIndex: [-1, -1] }))
      .status,
    400,
  );
  for (const action of [
    "status",
    "snapshot",
    "register",
    "blockHash",
    "broadcast",
  ])
    assert.equal(
      (await f.post({ owner: accountId(foreign) }, action)).status,
      400,
    );
  assert.equal(f.events.filter((x) => x === "start:begin").length, 1);
  assert.deepEqual(
    f.calls.map((c) => c.method),
    ["status"],
  );
});

test("start after failure awaits only the owned runtime stop before start and status", async (t) => {
  const f = await fixture(t),
    stopped = gate(),
    started = gate();
  f.state = "failed";
  f.controls.stop = () => stopped.promise;
  f.controls.start = () => started.promise;
  const response = f.post(startBody);
  await waitFor(() => f.events.includes("stop:begin"));
  assert.deepEqual(f.events, ["stop:begin"]);
  assert.equal((await f.post(startBody)).status, 409);
  stopped.resolve();
  await waitFor(() => f.events.includes("start:begin"));
  assert.deepEqual(f.events, ["stop:begin", "stop:end", "start:begin"]);
  started.resolve();
  assert.equal((await response).status, 200);
  assert.deepEqual(f.events, [
    "stop:begin",
    "stop:end",
    "start:begin",
    "start:end",
    "request:status",
  ]);
});

test("native register restartRequired awaits stop and fresh start before returning new status", async (t) => {
  const f = await fixture(t);
  await f.post(startBody);
  f.events.length = 0;
  const stopped = gate(),
    started = gate();
  f.controls.request = async (method) =>
    method === "register"
      ? { ...f.identity(), restartRequired: true }
      : f.identity();
  f.controls.stop = () => stopped.promise;
  f.controls.start = () => started.promise;
  const response = f.post({ owner, minimumIndex: [39, 39] }, "register");
  await waitFor(() => f.events.includes("stop:begin"));
  assert.deepEqual(f.events, ["request:register", "stop:begin"]);
  assert.equal((await f.post({ owner }, "snapshot")).status, 409);
  stopped.resolve();
  await waitFor(() => f.events.includes("start:begin"));
  assert(!f.events.includes("request:status"));
  started.resolve();
  assert.equal((await response).status, 200);
  assert.deepEqual(f.events, [
    "request:register",
    "stop:begin",
    "stop:end",
    "start:begin",
    "start:end",
    "request:status",
  ]);
  assert.deepEqual(f.calls.find((c) => c.method === "register")?.params, {
    minimumIndex: [39, 39],
  });
});

test("register without expansion does not restart; failed stop cannot launch a new child", async (t) => {
  const f = await fixture(t);
  await f.post(startBody);
  f.events.length = 0;
  f.controls.request = async () => ({
    ...f.identity(),
    restartRequired: false,
  });
  assert.equal(
    (await f.post({ owner, minimumIndex: [-1, -1] }, "register")).status,
    200,
  );
  assert.deepEqual(f.events, ["request:register"]);
  f.controls.request = async () => ({ ...f.identity(), restartRequired: true });
  f.controls.stop = async () => {
    throw new Error("Owned process has not exited");
  };
  f.events.length = 0;
  assert.equal(
    (await f.post({ owner, minimumIndex: [39, 39] }, "register")).status,
    400,
  );
  assert.deepEqual(f.events, ["request:register", "stop:begin"]);
});

test("invalid, changed, wrong-network and foreign-account signed payments never reach native broadcast", async (t) => {
  const f = await fixture(t);
  await f.post(startBody);
  const changed = structuredClone(bundle);
  changed.outputs[0]!.amount -= 1n;
  const invalid = [
    { ...payment, expectedTxid: "00".repeat(32) },
    {
      ...payment,
      rawTx:
        payment.rawTx.slice(0, -1) + (payment.rawTx.endsWith("0") ? "1" : "0"),
    },
    { ...payment, bundleHex: hex(encodeBundle(changed)) },
    { ...payment, bundleHex: vector.bundleHex },
    { ...payment, rawTx: "00".repeat(10001) },
    { ...payment, extra: true },
  ];
  for (const candidate of invalid)
    assert.equal(
      (await f.post({ owner, payment: candidate }, "broadcast")).status,
      400,
    );
  assert.equal(f.calls.filter((c) => c.method === "broadcast").length, 0);
  const other = await fixture(t);
  await other.post({ account: accountToJson(foreign), minimumIndex: [-1, -1] });
  assert.equal(
    (await other.post({ owner: accountId(foreign), payment }, "broadcast"))
      .status,
    400,
  );
  assert.equal(other.calls.filter((c) => c.method === "broadcast").length, 0);
});

test("valid public-vector signed bytes pass exact binding once and ambiguous native broadcast is not retried", async (t) => {
  const f = await fixture(t);
  await f.post(startBody);
  f.controls.request = async (method, params) => {
    assert.equal(method, "broadcast");
    assert.deepEqual(params, {
      rawTransaction: payment.rawTx,
      expectedTxid: payment.expectedTxid,
    });
    return { txid: payment.expectedTxid };
  };
  const result = await f.post({ owner, payment }, "broadcast");
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { txid: payment.expectedTxid });
  assert.equal(result.headers["cache-control"], "no-store");
  assert.equal(result.headers["x-content-type-options"], "nosniff");
  assert.equal(result.headers["access-control-allow-origin"], undefined);
  f.controls.request = async () => {
    throw new LocalLightRequestError("BROADCAST_UNKNOWN");
  };
  assert.match(
    String((await f.post({ owner, payment }, "broadcast")).body.error),
    /outcome is unknown/,
  );
  assert.equal(
    f.calls.filter((c) => c.method === "broadcast").length,
    2,
    "One request per explicit HTTP call; no hidden retry",
  );
});

test("disconnect during a partial body releases serialization without invoking the runtime", async (t) => {
  const f = await fixture(t),
    body = JSON.stringify(startBody);
  const socket = connect(f.port, "127.0.0.1");
  t.after(() => socket.destroy());
  socket.on("error", () => {});
  await new Promise<void>((resolve) => socket.once("connect", resolve));
  const lines = f
    .headers()
    .map((line) =>
      line.startsWith("Content-Length:")
        ? `Content-Length: ${Buffer.byteLength(body)}`
        : line,
    );
  socket.write(
    `POST /api/local/start HTTP/1.1\r\n${lines.join("\r\n")}\r\n\r\n${body.slice(0, 10)}`,
  );
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal((await f.post(startBody)).status, 409);
  assert.equal(f.factories, 0);
  socket.destroy();
  let response: Result | undefined;
  for (let attempt = 0; attempt < 50; attempt++) {
    response = await f.post(startBody);
    if (response.status !== 409) break;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  assert.equal(response?.status, 200);
  assert.equal(f.events.filter((event) => event === "start:begin").length, 1);
});

test("disconnected register request never starts a replacement process after old stop completes", async (t) => {
  const f = await fixture(t);
  await f.post(startBody);
  f.events.length = 0;
  const stopped = gate(),
    controller = new AbortController();
  f.controls.request = async () => ({ ...f.identity(), restartRequired: true });
  f.controls.stop = () => stopped.promise;
  const response = f.post(
    { owner, minimumIndex: [39, 39] },
    "register",
    {},
    "POST",
    controller.signal,
  );
  await waitFor(() => f.events.includes("stop:begin"));
  controller.abort();
  await assert.rejects(response, /abort/i);
  // Let the server observe response.close before releasing its asynchronous stop.
  await new Promise((resolve) => setTimeout(resolve, 10));
  stopped.resolve();
  await waitFor(() => f.events.includes("stop:end"));
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(f.events, ["request:register", "stop:begin", "stop:end"]);
});

test("explicit close requires the bound owner, awaits stop, then clears binding for a different account", async (t) => {
  const f = await fixture(t);
  await f.post(startBody);
  f.events.length = 0;
  assert.equal(
    (await f.post({ owner: accountId(foreign) }, "close")).status,
    400,
  );
  assert.equal(
    (await f.post({ owner, dataDir: "/another/wallet" }, "close")).status,
    400,
  );
  assert.deepEqual(f.events, []);
  const stopped = gate();
  f.controls.stop = () => stopped.promise;
  const closing = f.post({ owner }, "close");
  await waitFor(() => f.events.includes("stop:begin"));
  assert.deepEqual(f.events, ["stop:begin"]);
  assert.equal((await f.post({ owner }, "status")).status, 409);
  stopped.resolve();
  const closed = await closing;
  assert.equal(closed.status, 200);
  assert.deepEqual(closed.body, { closed: true });
  assert.equal((await f.post({ owner }, "status")).status, 400);
  assert.equal(
    (await f.post({ account: accountToJson(foreign), minimumIndex: [-1, -1] }))
      .status,
    200,
  );
  assert.equal(
    (await f.post({ owner: accountId(foreign) }, "status")).status,
    200,
  );
});
