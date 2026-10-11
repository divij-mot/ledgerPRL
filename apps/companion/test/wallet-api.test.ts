import { test } from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import type { NetworkName } from "@pearl-ledger/sdk";
import {
  createWalletConnector,
  connectWalletLedger,
} from "../src/wallet-api.js";

const APDU = Uint8Array.of(0xe1, 0, 0, 1, 0);
const CONTINUATION = Uint8Array.of(0xf8, 1, 0, 1, 0);
const RESPONSE = Buffer.from([0x51, 0xe0, 0x00]);
const METHODS = ["device.transport", "device.exchange", "device.close"];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function fixture() {
  const events: string[] = [];
  const raw = {
    exchange: async (apdu: Buffer): Promise<Uint8Array> => {
      assert(Buffer.isBuffer(apdu));
      events.push(`exchange:${apdu.toString("hex")}`);
      return RESPONSE;
    },
    close: async () => {
      events.push("close");
    },
  };
  const connection = {
    capabilities: async () => METHODS,
    open: async (_appName: string) => {
      events.push("open");
      return raw;
    },
    disconnect: () => {
      events.push("disconnect");
    },
  };
  const connectRaw = createWalletConnector(() => connection, {
    open: 15,
    close: 15,
    exchange: 15,
  });
  const connect = (network: NetworkName = "mainnet") =>
    connectRaw(undefined, "bitcoin-prl", network);
  return { events, raw, connection, connect };
}

for (const phase of ["capabilities", "open", "exchange"] as const)
  test(`${phase}: native tagged failures are bounded messages, cleaned up once without retry`, async () => {
    const cases: [unknown, string][] = [
      [
        { _tag: "DeviceDisconnectedWhileSendingError" },
        "Ledger disconnected. Reopen Pearl and reconnect.",
      ],
      [
        { _tag: "DeviceDisconnectedBeforeSendingApdu" },
        "Ledger disconnected. Reopen Pearl and reconnect.",
      ],
      [
        { name: "DisconnectedDeviceDuringOperation" },
        "Ledger disconnected. Reopen Pearl and reconnect.",
      ],
      [
        { name: "DisconnectedDevice" },
        "Ledger disconnected. Reopen Pearl and reconnect.",
      ],
      [
        { _tag: "SendApduTimeoutError" },
        "Ledger response timed out. Reopen Pearl and reconnect.",
      ],
      [
        { name: "SendCommandTimeoutError" },
        "Ledger response timed out. Reopen Pearl and reconnect.",
      ],
      [
        { _tag: "ActionRefusedError" },
        "Request declined on your Ledger. Reopen Pearl and reconnect.",
      ],
      [
        { name: "UserRefusedOnDevice" },
        "Request declined on your Ledger. Reopen Pearl and reconnect.",
      ],
      [
        { _tag: "UnknownNativeFailure" },
        "Ledger connection failed. Reopen Pearl and reconnect.",
      ],
      [
        { name: "TransportStatusError", statusCode: 0x6985 },
        "Ledger connection failed. Reopen Pearl and reconnect.",
      ],
      [
        "untrusted-native-payload",
        "Ledger connection failed. Reopen Pearl and reconnect.",
      ],
      [null, "Ledger connection failed. Reopen Pearl and reconnect."],
    ];
    for (const [value, expected] of cases) {
      const error =
        value && typeof value === "object"
          ? {
              ...value,
              message: "untrusted-native-payload",
              data: { apdu: "untrusted-native-payload" },
            }
          : value;
      const f = fixture();
      let calls = 0;
      const fail = async (): Promise<never> => {
        calls++;
        throw error;
      };
      if (phase === "capabilities") f.connection.capabilities = fail;
      else if (phase === "open") f.connection.open = fail;
      else f.raw.exchange = fail;
      const operation =
        phase === "exchange" ? (await f.connect()).exchange(APDU) : f.connect();
      await assert.rejects(operation, (caught: unknown) => {
        assert(caught instanceof Error);
        assert.equal(caught.message, expected);
        assert.equal(caught.cause, undefined);
        assert(!String(caught).includes("untrusted-native-payload"));
        return true;
      });
      assert.equal(calls, 1);
      assert.deepEqual(
        f.events,
        phase === "exchange" ? ["open", "close", "disconnect"] : ["disconnect"],
      );
    }
  });

test("existing Error identity/status and unsafe tag accessors are not rewritten or inspected", async () => {
  for (const phase of ["capabilities", "open", "exchange"] as const) {
    const error = Object.assign(new Error("existing validation diagnostic"), {
      status: 0x6985,
    });
    const f = fixture();
    const fail = async (): Promise<never> => {
      throw error;
    };
    if (phase === "capabilities") f.connection.capabilities = fail;
    else if (phase === "open") f.connection.open = fail;
    else f.raw.exchange = fail;
    await assert.rejects(
      phase === "exchange" ? (await f.connect()).exchange(APDU) : f.connect(),
      (e) => e === error,
    );
    assert.equal(error.status, 0x6985);
  }
  const error = Object.defineProperty({}, "_tag", {
    get() {
      throw Error("Accessor must not run");
    },
  });
  const f = fixture();
  f.connection.open = async () => {
    throw error;
  };
  await assert.rejects(f.connect(), {
    message: "Ledger connection failed. Reopen Pearl and reconnect.",
  });
});

test("native failure at final ACK cannot replace complete verified signed bytes", async () => {
  const { LedgerBitcoinPrlClient } = await import(
    "@pearl-ledger/bitcoin-prl-adapter"
  );
  const sdk = await import("@pearl-ledger/sdk");
  const { createPsbtEndpoint, publicFixture } = await import(
    new URL("./psbt-endpoint.mjs", import.meta.url).href
  );
  const endpoint = createPsbtEndpoint({
    onStage(stage: string) {
      if (stage === "ack")
        throw {
          _tag: "DeviceDisconnectedWhileSendingError",
          data: "untrusted-native-payload",
        };
    },
  });
  const f = fixture();
  f.raw.exchange = (apdu) => endpoint.transport.exchange(apdu);
  const transport = await f.connect("regtest");
  let saved: string | undefined;
  const result = await new LedgerBitcoinPrlClient(
    transport,
    "regtest",
  ).signBundle(
    sdk.bundleFromJson(publicFixture.bundle),
    sdk.accountFromJson(publicFixture.publicAccount),
    {
      onVerifiedSigned(signed) {
        saved = signed.rawTx;
      },
    },
  );
  assert.equal(saved, publicFixture.rawTx);
  assert.equal(result.rawTx, saved);
  assert.equal(result.completionWarning, "device-acknowledgement-unconfirmed");
  assert.equal(endpoint.acknowledgements(), 1);
  assert.deepEqual(f.events, ["open", "close", "disconnect"]);
  await assert.rejects(transport.exchange(CONTINUATION), /closed/);
});

test("Wallet API preserves raw continuation/rejection statuses and uses Buffer exchange", async () => {
  const f = fixture();
  const transport = await f.connect();
  assert.deepEqual(await transport.exchange(APDU), Uint8Array.from(RESPONSE));
  f.raw.exchange = async () => Buffer.from([0x69, 0x85]);
  assert.deepEqual(
    await transport.exchange(CONTINUATION),
    Uint8Array.of(0x69, 0x85),
  );
  await transport.close();
  assert.deepEqual(f.events.slice(-2), ["close", "disconnect"]);
});

test("unsupported commands and pre-abort send no APDU and end the session", async () => {
  for (const preAbort of [false, true]) {
    const f = fixture();
    const transport = await f.connect();
    const signal = AbortSignal.abort();
    await assert.rejects(
      transport.exchange(
        preAbort ? APDU : Uint8Array.of(0xe0, 0, 0, 1, 0),
        preAbort ? signal : undefined,
      ),
    );
    assert.deepEqual(f.events, ["open", "close", "disconnect"]);
    await assert.rejects(transport.exchange(APDU), /closed/);
  }
});

test("concurrent exchange/open cannot reach the shared host transport", async () => {
  const f = fixture();
  const response = deferred<Uint8Array>();
  f.raw.exchange = () => response.promise;
  const transport = await f.connect();
  const first = transport.exchange(APDU);
  await assert.rejects(transport.exchange(APDU), /busy/);
  await assert.rejects(f.connect(), /already/);
  response.resolve(RESPONSE);
  assert.deepEqual(await first, Uint8Array.from(RESPONSE));
  await transport.close();
});

test("valid final response wins synchronous abort while subsequent ACK is prohibited", async () => {
  const f = fixture();
  const controller = new AbortController();
  f.raw.exchange = () => {
    controller.abort();
    return Promise.resolve(RESPONSE);
  };
  const transport = await f.connect();
  assert.deepEqual(
    await transport.exchange(APDU, controller.signal),
    Uint8Array.from(RESPONSE),
  );
  await assert.rejects(transport.exchange(CONTINUATION), /closed/);
  await transport.close();
  assert.deepEqual(f.events, ["open", "close", "disconnect"]);
});

test("abort winning exchange forbids late signature delivery or continuation", async () => {
  const f = fixture();
  const controller = new AbortController();
  const response = deferred<Uint8Array>();
  f.raw.exchange = () => response.promise;
  const transport = await f.connect();
  const result = transport.exchange(APDU, controller.signal);
  controller.abort();
  response.resolve(RESPONSE);
  await assert.rejects(result, /cancelled/);
  await assert.rejects(transport.exchange(CONTINUATION), /closed/);
});

test("capability failure closes listeners without opening hardware", async () => {
  const f = fixture();
  f.connection.capabilities = async () => ["device.transport"];
  await assert.rejects(f.connect(), /does not support/);
  assert.deepEqual(f.events, ["disconnect"]);
  f.connection.capabilities = async () => METHODS;
  await (await f.connect()).close();
});

test("malformed response closes transport", async () => {
  const f = fixture();
  f.raw.exchange = async () => Buffer.from([0x90]);
  const transport = await f.connect();
  await assert.rejects(transport.exchange(APDU), /Malformed/);
  assert.deepEqual(f.events, ["open", "close", "disconnect"]);
});

test("close waits for hardware acknowledgement before permitting reconnect", async () => {
  const f = fixture();
  const closed = deferred<void>();
  f.raw.close = () => {
    f.events.push("close");
    return closed.promise;
  };
  const transport = await f.connect();
  const closing = transport.close();
  assert.equal(transport.close(), closing);
  await assert.rejects(f.connect(), /already/);
  assert(!f.events.includes("disconnect"));
  closed.resolve();
  await closing;
  await (await f.connect()).close();
});

test("unresolved close is bounded and permanently requires reopening even after late cleanup", async () => {
  const f = fixture();
  const closed = deferred<void>();
  f.raw.close = () => closed.promise;
  const transport = await f.connect();
  await transport.close();
  await assert.rejects(f.connect(), /Close and reopen/);
  closed.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert(f.events.includes("disconnect"));
  await assert.rejects(f.connect(), /Close and reopen/);
});

test("late device open is closed before listener removal and cannot race a new open", async () => {
  const f = fixture();
  const opened = deferred<typeof f.raw>();
  f.connection.open = () => {
    f.events.push("open");
    return opened.promise;
  };
  const result = f.connect();
  await new Promise((resolve) => setTimeout(resolve, 20));
  await assert.rejects(f.connect(), /already/);
  opened.resolve(f.raw);
  await assert.rejects(result, /connection timed out/);
  assert.deepEqual(f.events, ["open", "close", "disconnect"]);
});

test("unresolved open or exchange cannot be reused after bounded timeout", async () => {
  for (const operation of ["open", "exchange"] as const) {
    const f = fixture();
    if (operation === "open") f.connection.open = () => new Promise(() => {});
    else f.raw.exchange = () => new Promise(() => {});
    if (operation === "open") await assert.rejects(f.connect(), /timed out/);
    else await assert.rejects((await f.connect()).exchange(APDU), /timed out/);
    await assert.rejects(f.connect(), /Close and reopen/);
  }
});

test("native connector refuses ordinary browser without falling back to WebHID", async () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {},
  });
  try {
    await assert.rejects(
      connectWalletLedger(undefined, "bitcoin-prl", "mainnet"),
      /inside Ledger Wallet/,
    );
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});

for (const mode of ["desktop", "ios", "android"] as const)
  test(`official client ${mode} native bridge preserves raw replies and rejects web peers`, async () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "window");
    const methods: string[] = [];
    const largeResponse = "a5".repeat(256) + "9000";
    let exchanges = 0;
    const host = Object.assign(new EventTarget(), {
      document: new EventTarget(),
    });
    const bridge = {
      postMessage(message: string) {
        const request = JSON.parse(message) as {
          id: string;
          method: string;
          params: { apduHex?: string; appName?: string };
        };
        methods.push(request.method);
        if (request.method === "device.transport")
          assert.deepEqual(request.params, { appName: "Pearl" });
        if (request.method === "device.exchange") {
          exchanges++;
          assert.equal(
            request.params.apduHex,
            exchanges === 1 ? "e100000100" : "f801000100",
          );
        }
        const result =
          request.method === "wallet.capabilities"
            ? { methodIds: METHODS }
            : request.method === "device.exchange"
              ? { responseHex: exchanges === 1 ? "51e000" : largeResponse }
              : { transportId: "1" };
        queueMicrotask(() => {
          const target = mode === "android" ? host.document : host;
          const forged = JSON.stringify({
            id: request.id,
            jsonrpc: "2.0",
            result: { methodIds: [], responseHex: "dead9000" },
          });
          target.dispatchEvent(
            new MessageEvent("message", {
              origin: "https://attacker.invalid",
              data: forged,
            }),
          );
          if (mode !== "desktop") {
            const peer = new MessageEvent("message", { data: forged });
            Object.defineProperty(peer, "source", { value: {} });
            target.dispatchEvent(peer);
          }
          // RN WebView 13.16.0 iOS postMessage injects exactly data-only
          // window MessageEvent: source=null and origin="" by default.
          // Android uses the SDK's document listener for the same payload.
          const reply = new MessageEvent("message", {
            ...(mode === "desktop" ? { origin: "null" } : {}),
            data: JSON.stringify({ id: request.id, jsonrpc: "2.0", result }),
          });
          if (mode !== "desktop") {
            assert.equal(reply.source, null);
            assert.equal(reply.origin, "");
          }
          target.dispatchEvent(reply);
        });
      },
    };
    Object.assign(
      host,
      mode === "desktop"
        ? { ElectronWebview: bridge }
        : { ReactNativeWebView: bridge },
    );
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: host,
    });
    try {
      const transport = await connectWalletLedger(
        undefined,
        "bitcoin-prl",
        "mainnet",
      );
      assert.deepEqual(
        await transport.exchange(APDU),
        Uint8Array.from(RESPONSE),
      );
      assert.deepEqual(
        await transport.exchange(CONTINUATION),
        Uint8Array.from(Buffer.from(largeResponse, "hex")),
      );
      await transport.close();
      assert.deepEqual(methods, [
        "wallet.capabilities",
        "device.transport",
        "device.exchange",
        "device.exchange",
        "device.close",
      ]);
      // A settled close allows a fresh session through the same native bridge.
      await (
        await connectWalletLedger(undefined, "bitcoin-prl", "mainnet")
      ).close();
      assert.deepEqual(methods.slice(-3), [
        "wallet.capabilities",
        "device.transport",
        "device.close",
      ]);
    } finally {
      if (original) Object.defineProperty(globalThis, "window", original);
      else Reflect.deleteProperty(globalThis, "window");
    }
  });

test("failed hardware close poisons reconnect, while a rejected open can be retried", async () => {
  const f = fixture();
  f.connection.open = async () => {
    throw new Error("user rejected device picker");
  };
  await assert.rejects(f.connect(), /user rejected/);
  f.connection.open = async () => f.raw;
  f.raw.close = async () => {
    throw new Error("hardware still busy");
  };
  await (await f.connect()).close();
  await assert.rejects(f.connect(), /Close and reopen/);
});

test("real PSBT client persists verified bytes through Wallet API before abort suppresses final ACK", async () => {
  const { LedgerBitcoinPrlClient } = await import(
    "@pearl-ledger/bitcoin-prl-adapter"
  );
  const sdk = await import("@pearl-ledger/sdk");
  // Existing endpoint validates the complete frozen Python-oracle APDU transcript.
  const { createPsbtEndpoint, publicFixture } = await import(
    new URL("./psbt-endpoint.mjs", import.meta.url).href
  );
  const endpoint = createPsbtEndpoint();
  const f = fixture();
  f.raw.exchange = (apdu) => endpoint.transport.exchange(apdu);
  f.raw.close = () => endpoint.transport.close();
  const transport = await f.connect();
  const client = new LedgerBitcoinPrlClient(transport, "regtest");
  const controller = new AbortController();
  let saved: string | undefined;
  const result = await client.signBundle(
    sdk.bundleFromJson(publicFixture.bundle),
    sdk.accountFromJson(publicFixture.publicAccount),
    {
      signal: controller.signal,
      onVerifiedSigned: async (signed) => {
        saved = signed.rawTx;
        assert.equal(endpoint.acknowledgements(), 0);
        controller.abort();
      },
    },
  );
  assert.equal(saved, publicFixture.rawTx);
  assert.equal(result.rawTx, saved);
  assert.equal(result.completionWarning, "device-acknowledgement-unconfirmed");
  assert.equal(endpoint.acknowledgements(), 0);
  await assert.rejects(transport.exchange(CONTINUATION), /closed/);
});

test("browser bundle initializes the official SDK without a preexisting Buffer global", async () => {
  const { build } = await import("esbuild");
  const { runInNewContext } = await import("node:vm");
  const { fileURLToPath } = await import("node:url");
  const bundled = await build({
    stdin: {
      contents:
        'import { connectWalletLedger } from "./wallet-api.js"; globalThis.connectWalletLedger = connectWalletLedger;',
      resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    logLevel: "silent",
  });
  const browser: Record<string, unknown> = {
    TextEncoder,
    TextDecoder,
    console,
  };
  runInNewContext(bundled.outputFiles[0]!.text, browser);
  assert.equal(typeof browser.Buffer, "function");
  assert.equal(typeof browser.connectWalletLedger, "function");
});

test("selected network requests its exact Pearl device app with no dashboard default", async () => {
  const expected: Record<NetworkName, string> = {
    mainnet: "Pearl",
    testnet: "Pearl T1",
    testnet2: "Pearl T2",
    regtest: "Pearl Reg",
    simnet: "Pearl Sim",
  };
  for (const network of Object.keys(expected) as NetworkName[]) {
    const f = fixture();
    f.connection.open = async (appName) => {
      assert.equal(appName, expected[network]);
      return f.raw;
    };
    await (await f.connect(network)).close();
  }
  const f = fixture();
  await assert.rejects(
    f.connect("bitcoin" as NetworkName),
    /supported Pearl network/,
  );
  assert.deepEqual(f.events, []);
});
