import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

test("Live App route fails in ordinary browsers without falling back to WebHID", async () => {
  // Bundle the actual router and Wallet API; replace WebHID with a tripwire.
  const result = await build({
    stdin: {
      contents:
        'export { connectLedger, configureDevice } from "./device.js"; export { connectWalletLedger } from "./wallet-api.js";',
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
    plugins: [
      {
        name: "forbid-webhid",
        setup(b) {
          b.onResolve({ filter: /^\.\/ledger\.js$/ }, () => ({
            path: "ledger",
            namespace: "no-webhid",
          }));
          b.onLoad({ filter: /.*/, namespace: "no-webhid" }, () => ({
            contents:
              'export async function connectLedger(){throw Error("Unexpected WebHID fallback")}',
          }));
        },
      },
    ],
  });
  const module = {
    exports: {} as {
      configureDevice(
        host: "web" | "wallet",
        connector: (...args: any[]) => Promise<any>,
      ): void;
      connectWalletLedger: (...args: any[]) => Promise<any>;
      connectLedger(
        onDisconnect: undefined,
        protocol: "bitcoin-prl",
        network: "mainnet",
      ): Promise<unknown>;
    },
  };
  new Function("require", "module", "exports", result.outputFiles[0]!.text)(
    createRequire(import.meta.url),
    module,
    module.exports,
  );
  const { connectLedger, configureDevice, connectWalletLedger } =
    module.exports;
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const originalNavigator = Object.getOwnPropertyDescriptor(
    globalThis,
    "navigator",
  );
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location: { pathname: "/live.html" }, isSecureContext: true },
  });
  let hidAccess = 0;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: new Proxy(
      {},
      {
        has() {
          hidAccess++;
          throw new Error("Unexpected WebHID fallback");
        },
      },
    ),
  });
  try {
    await assert.rejects(
      connectLedger(undefined, "bitcoin-prl", "mainnet"),
      /does not match/,
    );
    configureDevice("wallet", connectWalletLedger);
    assert.throws(
      () => configureDevice("web", async () => ({})),
      /already configured/,
    );
    await assert.rejects(
      connectLedger(undefined, "bitcoin-prl", "mainnet"),
      /inside Ledger Wallet/,
    );
    await assert.rejects(
      connectLedger(undefined, "bitcoin-prl", "mainnet"),
      /inside Ledger Wallet/,
    );
    assert.equal(hidAccess, 0);
  } finally {
    for (const [name, descriptor] of [
      ["window", originalWindow],
      ["navigator", originalNavigator],
    ] as const) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});

test("configured WebHID connector starts within the calling gesture and rejects a changed route", async () => {
  const { configureDevice, connectLedger } = await import("../src/device.js");
  const original = Object.getOwnPropertyDescriptor(globalThis, "window");
  const location = { pathname: "/" };
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { location },
  });
  let called = false;
  const transport = {
    exchange: async () => new Uint8Array(),
    close: async () => {},
  };
  try {
    configureDevice("web", (onDisconnect, protocol, network) => {
      called = true;
      assert.equal(onDisconnect, undefined);
      assert.equal(protocol, "bitcoin-prl");
      assert.equal(network, "mainnet");
      return Promise.resolve(transport);
    });
    const pending = connectLedger(undefined, "bitcoin-prl", "mainnet");
    assert.equal(called, true);
    assert.equal(await pending, transport);
    called = false;
    location.pathname = "/live.html";
    await assert.rejects(
      connectLedger(undefined, "bitcoin-prl", "mainnet"),
      /does not match/,
    );
    assert.equal(called, false);
  } finally {
    if (original) Object.defineProperty(globalThis, "window", original);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
