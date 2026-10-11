import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import type { DeviceManagementKit } from "@ledgerhq/device-management-kit";
// DMK 1.11.0's ESM export is not loadable by Node 24. Bundle the actual browser
// adapter for this Node-only test and load DMK's supported CJS export instead.
// Production keeps its ordinary Vite/DMK imports; no fake runtime is substituted.
const require = createRequire(import.meta.url);
const { CommandResultFactory } =
  require("@ledgerhq/device-management-kit") as typeof import("@ledgerhq/device-management-kit");
const bundled = await build({
  entryPoints: [fileURLToPath(new URL("../src/ledger.ts", import.meta.url))],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["@ledgerhq/device-management-kit", "rxjs"],
  logLevel: "silent",
});
const module = { exports: {} as typeof import("../src/ledger.js") };
new Function("require", "module", "exports", bundled.outputFiles[0]!.text)(
  require,
  module,
  module.exports,
);
const { DmkPearlTransport: ActualTransport, PearlCommand } = module.exports;
const selectedDevice = { productId: 0x8000 };
function disconnectEvent(device: object = selectedDevice) {
  return Object.assign(new Event("disconnect"), { device });
}
class DmkPearlTransport extends ActualTransport {
  constructor(...args: ConstructorParameters<typeof ActualTransport>) {
    args[6] ??= selectedDevice;
    super(...args);
  }
}
const apdu = Uint8Array.of(0xe0, 0, 0, 0, 0);
test("DMK adapter encodes an exact custom command and preserves status words", () => {
  const command = new PearlCommand(apdu);
  assert.deepEqual(command.getApdu().getRawApdu(), apdu);
  const response = command.parseResponse({
    data: Uint8Array.of(1, 2),
    statusCode: Uint8Array.of(0x69, 0x85),
  });
  assert("data" in response);
  assert.deepEqual(response.data, Uint8Array.of(1, 2, 0x69, 0x85));
  assert.throws(() => new PearlCommand(Uint8Array.of(0xe0, 0xff, 0, 0, 0)));
});
test("physical HID disconnect between commands latches session closed and cannot resume after reconnect", async () => {
  const events = new EventTarget();
  let sends = 0,
    disconnects = 0,
    closed = 0;
  const fake = {
    sendCommand: async () => {
      sends++;
      return CommandResultFactory({ data: Uint8Array.of(0x90, 0) });
    },
    disconnect: async () => {
      disconnects++;
    },
    close: () => {
      closed++;
    },
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(fake, "test", events);
  await transport.exchange(apdu);
  events.dispatchEvent(disconnectEvent());
  events.dispatchEvent(new Event("connect"));
  await assert.rejects(transport.exchange(apdu), /closed/);
  assert.equal(sends, 1);
  assert.equal(disconnects, 1);
  await transport.close();
});
test("physical disconnect rejects pending exchange rather than waiting for DMK reconnect grace", async () => {
  const events = new EventTarget();
  let sends = 0;
  const fake = {
    sendCommand: () => {
      sends++;
      return new Promise(() => {});
    },
    disconnect: async () => {},
    close: () => {},
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(fake, "test", events);
  const pending = transport.exchange(apdu);
  events.dispatchEvent(disconnectEvent());
  await assert.rejects(pending, /cancelled|disconnected/);
  events.dispatchEvent(new Event("connect"));
  await assert.rejects(transport.exchange(apdu), /closed/);
  assert.equal(sends, 1);
});

test("Bitcoin-based PRL DMK commands use a separate explicit allowlist", () => {
  for (const [cla, ins] of [
    [0xe1, 0],
    [0xe1, 3],
    [0xe1, 4],
    [0xe1, 5],
    [0xe1, 6],
    [0xf8, 1],
  ]) {
    const bytes = Uint8Array.of(cla!, ins!, 0, 1, 2, 0x12, 0x34);
    assert.deepEqual(
      new PearlCommand(bytes, "bitcoin-prl").getApdu().getRawApdu(),
      bytes,
    );
    assert.throws(() => new PearlCommand(bytes, "prl1"));
  }
  for (const bytes of [
    Uint8Array.of(0xe0, 0, 0, 0, 0), // Never silently downgrade to old PRL1.
    Uint8Array.of(0xe1, 2, 0, 1, 0), // Wallet registration disabled.
    Uint8Array.of(0xe1, 0x10, 0, 1, 0), // Message signing disabled.
    Uint8Array.of(0xe1, 4, 1, 1, 0),
    Uint8Array.of(0xe1, 4, 0, 0, 0),
    Uint8Array.of(0xf8, 0, 0, 1, 0),
    Uint8Array.of(0xe1, 4, 0, 1, 1),
  ])
    assert.throws(() => new PearlCommand(bytes, "bitcoin-prl"));
});

test("PSBT response winning a disconnect race remains available while transport stays terminal", async () => {
  const events = new EventTarget();
  let deliver!: (
    value: ReturnType<typeof CommandResultFactory<Uint8Array>>,
  ) => void;
  let sends = 0;
  const fake = {
    sendCommand: () => {
      sends++;
      return new Promise((resolve) => {
        deliver = resolve;
      });
    },
    disconnect: async () => {},
    close() {},
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(
    fake,
    "test",
    events,
    undefined,
    "bitcoin-prl",
  );
  const bytes = Uint8Array.of(0xe1, 4, 0, 1, 0);
  const pending = transport.exchange(bytes);
  const response = Uint8Array.of(0x10, 1, 2, 3, 0xe0, 0);
  deliver(CommandResultFactory({ data: response }));
  events.dispatchEvent(disconnectEvent());
  assert.deepEqual(await pending, response);
  await assert.rejects(transport.exchange(bytes), /closed/);
  assert.equal(sends, 1);
});

test("terminal close destroys owned HID factory listeners exactly once, even if DMK cleanup fails", async () => {
  let destroyed = 0;
  const fake = {
    disconnect: async () => {
      throw new Error("already disconnected");
    },
    close: () => {
      throw new Error("already closed");
    },
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(
    fake,
    "test",
    new EventTarget(),
    undefined,
    "bitcoin-prl",
    () => {
      destroyed++;
    },
  );
  await transport.close();
  await transport.close();
  assert.equal(destroyed, 1);
  await assert.rejects(
    transport.exchange(Uint8Array.of(0xe1, 6, 0, 1, 0)),
    /closed/,
  );
});

test("synchronous disconnect inside sendCommand cannot leave exchange pending", async () => {
  const events = new EventTarget();
  const fake = {
    sendCommand: () => {
      events.dispatchEvent(disconnectEvent());
      return new Promise(() => {});
    },
    disconnect: async () => {},
    close() {},
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(
    fake,
    "test",
    events,
    undefined,
    "bitcoin-prl",
  );
  await assert.rejects(
    transport.exchange(Uint8Array.of(0xe1, 6, 0, 1, 0)),
    /cancelled|disconnected/,
  );
});

test("all close callers wait for the same pending cleanup", async () => {
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  let disconnects = 0,
    finalCloses = 0,
    secondSettled = false;
  const fake = {
    disconnect: () => {
      disconnects++;
      return cleanup;
    },
    close: () => {
      finalCloses++;
    },
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(
    fake,
    "selected-ledger",
    new EventTarget(),
  );
  const first = transport.close();
  const second = transport.close().then(() => {
    secondSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(disconnects, 1);
    assert.equal(finalCloses, 0);
    assert.equal(
      secondSettled,
      false,
      "Second close returned before original cleanup completed",
    );
  } finally {
    release();
    await Promise.all([first, second]);
  }
  assert.equal(finalCloses, 1);
});

test("unrelated HID disconnect leaves the selected session active", async () => {
  const events = new EventTarget();
  const disconnectedSessions: string[] = [];
  let uiDisconnects = 0;
  const fake = {
    disconnect: async ({ sessionId }: { sessionId: string }) => {
      disconnectedSessions.push(sessionId);
    },
    close() {},
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(
    fake,
    "selected-ledger",
    events,
    () => {
      uiDisconnects++;
    },
  );
  const unrelated = new Event("disconnect");
  Object.defineProperty(unrelated, "device", {
    value: {
      vendorId: 0x1234,
      productId: 0x5678,
      productName: "Unrelated HID",
    },
  });
  events.dispatchEvent(unrelated);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disconnectedSessions, []);
  assert.equal(uiDisconnects, 0);
  events.dispatchEvent(disconnectEvent());
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(disconnectedSessions, ["selected-ledger"]);
  assert.equal(uiDisconnects, 1);
  await assert.rejects(transport.exchange(apdu), /closed/);
  await transport.close();
});

test("pinned WebHID sender close does not acknowledge completion of HIDDevice.close", async () => {
  const source = fileURLToPath(
    new URL(
      "../../../node_modules/@ledgerhq/device-transport-kit-web-hid/lib/esm/api/transport/WebHidApduSender.js",
      import.meta.url,
    ),
  );
  const output = await build({
    entryPoints: [source],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    external: ["@ledgerhq/device-management-kit"],
    logLevel: "silent",
  });
  const compiled = {
    exports: {} as {
      WebHidApduSender: new (...args: any[]) => { closeConnection(): unknown };
    },
  };
  new Function("require", "module", "exports", output.outputFiles[0]!.text)(
    require,
    compiled,
    compiled.exports,
  );
  let release!: () => void,
    rawClosed = false,
    calls = 0;
  const closing = new Promise<void>((resolve) => {
    release = resolve;
  }).then(() => {
    rawClosed = true;
  });
  const logger = { info() {}, error() {}, debug() {} };
  const sender = new compiled.exports.WebHidApduSender(
    {
      dependencies: {
        device: {
          close() {
            calls++;
            return closing;
          },
        },
      },
      apduSenderFactory: () => ({}),
      apduReceiverFactory: () => ({}),
    },
    () => logger,
  );
  try {
    assert.equal(sender.closeConnection(), undefined);
    await Promise.resolve();
    assert.equal(calls, 1);
    assert.equal(
      rawClosed,
      false,
      "Pinned implementation unexpectedly awaited physical close",
    );
  } finally {
    release();
    await closing;
  }
});

test("exchange abort waits for in-progress shared cleanup before rejecting", async () => {
  let release!: () => void;
  const cleanup = new Promise<void>((resolve) => {
    release = resolve;
  });
  let cleanupCalls = 0,
    settled = false;
  const fake = {
    sendCommand: () => new Promise(() => {}),
    disconnect: () => {
      cleanupCalls++;
      return cleanup;
    },
    close() {},
  } as unknown as DeviceManagementKit;
  const transport = new DmkPearlTransport(
    fake,
    "selected-ledger",
    new EventTarget(),
  );
  const controller = new AbortController();
  const pending = transport.exchange(apdu, controller.signal);
  const rejected = assert.rejects(pending, /cancelled/).then(() => {
    settled = true;
  });
  controller.abort();
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.equal(cleanupCalls, 1);
    assert.equal(
      settled,
      false,
      "exchange.catch returned before the abort-triggered cleanup finished",
    );
  } finally {
    release();
    await rejected;
  }
  assert.equal(cleanupCalls, 1);
});

function freshConnector(hooks?: {
  dmk?: (dmk: DeviceManagementKit) => void;
  transport?: (transport: unknown) => void;
}) {
  const isolated = { exports: {} as typeof import("../src/ledger.js") };
  new Function("require", "module", "exports", bundled.outputFiles[0]!.text)(
    (name: string) => {
      const original = require(name);
      if (name !== "@ledgerhq/device-management-kit" || !hooks) return original;
      const sdk = original as typeof import("@ledgerhq/device-management-kit");
      return {
        ...sdk,
        DeviceManagementKitBuilder: class extends sdk.DeviceManagementKitBuilder {
          override addTransport(
            factory: Parameters<
              InstanceType<
                typeof sdk.DeviceManagementKitBuilder
              >["addTransport"]
            >[0],
          ) {
            return super.addTransport((args) => {
              const transport = factory(args);
              hooks.transport?.(transport);
              return transport;
            });
          }
          override build() {
            const dmk = super.build();
            hooks.dmk?.(dmk);
            return dmk;
          }
        },
      };
    },
    isolated,
    isolated.exports,
  );
  return isolated.exports.connectLedger;
}
function deferred() {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<void>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function withHid(
  run: (
    hid: EventTarget & { chosen: object; picks: number },
    device: ReturnType<typeof mockHidDevice>,
  ) => Promise<void>,
) {
  const oldNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const device = mockHidDevice();
  const hid = Object.assign(new EventTarget(), {
    chosen: device as object,
    picks: 0,
    async getDevices() {
      return [this.chosen];
    },
    async requestDevice() {
      this.picks++;
      return [this.chosen];
    },
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { hid },
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { isSecureContext: true, navigator: { hid } },
  });
  try {
    await run(hid, device);
  } finally {
    if (oldNavigator)
      Object.defineProperty(globalThis, "navigator", oldNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
    if (oldWindow) Object.defineProperty(globalThis, "window", oldWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
}
function mockHidDevice() {
  return Object.assign(new EventTarget(), {
    vendorId: 0x2c97,
    productId: 0x4000,
    productName: "Public test Ledger",
    opened: false,
    opens: 0,
    closes: 0,
    closeGate: Promise.resolve(),
    openGate: Promise.resolve(),
    async open() {
      this.opens++;
      await this.openGate;
      this.opened = true;
    },
    async close() {
      this.closes++;
      await this.closeGate;
      this.opened = false;
    },
    async sendReport() {
      throw new Error("Unexpected APDU in lifecycle-only test");
    },
  });
}
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));

test("actual SDK connector preserves picker activation but waits for raw close before reopening the same handle", async () => {
  await withHid(async (hid, device) => {
    const connect = freshConnector();
    const first = await connect();
    assert.equal(device.opens, 1);
    const gate = deferred();
    device.closeGate = gate.promise;
    const closing = first.close();
    const next = connect();
    await turn();
    await turn();
    assert.equal(hid.picks, 2);
    assert.equal(
      device.opens,
      1,
      "New generation opened before raw close resolved",
    );
    assert.equal(device.closes, 1);
    gate.resolve();
    await closing;
    const second = await next;
    assert.equal(device.opens, 2);
    await first.close();
    assert.equal(device.closes, 1, "Old generation closed the new connection");
    await second.close();
    assert.equal(device.closes, 2, "New ownership generation must close again");
  });
});

test("actual SDK unrelated disconnect quarantines only that handle, not the selected Ledger", async () => {
  await withHid(async (hid, device) => {
    const connect = freshConnector();
    const first = await connect();
    const unrelated = mockHidDevice();
    hid.dispatchEvent(disconnectEvent(unrelated));
    await turn();
    assert.equal(
      unrelated.closes,
      1,
      "Pinned SDK bypass must remain represented",
    );
    assert.equal(device.closes, 0);
    await first.close();
    const second = await connect();
    assert.equal(device.opens, 2);
    await second.close();
    hid.chosen = unrelated;
    await assert.rejects(connect(), /cleanup|connection/i);
    assert.equal(unrelated.opens, 0, "Unknown-close handle reached raw open");
  });
});

test("actual SDK selected disconnect blocks same-handle reopen and does not auto-open on immediate connect event", async () => {
  await withHid(async (hid, device) => {
    const connect = freshConnector();
    let notices = 0;
    const first = await connect(() => notices++);
    const gate = deferred();
    device.closeGate = gate.promise;
    hid.dispatchEvent(disconnectEvent(device));
    hid.dispatchEvent(Object.assign(new Event("connect"), { device }));
    await turn();
    await turn();
    await assert.rejects(first.exchange(apdu), /closed/);
    await assert.rejects(connect(), /cleanup|connection/i);
    assert.equal(device.opens, 1);
    assert.equal(notices, 1);
    gate.resolve();
    await first.close();
    await turn();
    hid.dispatchEvent(Object.assign(new Event("connect"), { device }));
    await turn();
    await assert.rejects(connect(), /cleanup|connection/i);
    assert.equal(device.opens, 1, "Late close must not remove quarantine");
  });
});

test("actual SDK failed physical close stays quarantined", async () => {
  await withHid(async (_hid, device) => {
    const connect = freshConnector();
    const first = await connect();
    const gate = deferred();
    device.closeGate = gate.promise;
    const closed = first.close();
    gate.reject(new Error("Synthetic OS close failure"));
    await assert.rejects(closed, /Reload/);
    await assert.rejects(connect(), /Reload/);
    assert.equal(device.opens, 1);
  });
});

test("actual SDK close timeout blocks reopening even after the late close eventually resolves", async () => {
  await withHid(async (_hid, device) => {
    const connect = freshConnector();
    const first = await connect();
    const gate = deferred();
    device.closeGate = gate.promise;
    await assert.rejects(first.close(), /Reload/);
    gate.resolve();
    await turn();
    await assert.rejects(connect(), /Reload/);
    assert.equal(device.opens, 1);
    assert.equal(device.closes, 1);
  });
});

test("actual SDK disconnect during initial open cannot return a usable transport or reopen that handle", async () => {
  await withHid(async (hid, device) => {
    const connect = freshConnector();
    const opening = deferred();
    device.openGate = opening.promise;
    const pending = connect();
    await turn();
    await turn();
    assert.equal(device.opens, 1);
    hid.dispatchEvent(disconnectEvent(device));
    hid.dispatchEvent(Object.assign(new Event("connect"), { device }));
    opening.resolve();
    await assert.rejects(pending, /cleanup|connection/i);
    await assert.rejects(connect(), /cleanup|connection/i);
    assert.equal(device.opens, 1);
  });
});

test("actual SDK failed open waits for its owned cleanup before another attempt can open", async () => {
  await withHid(async (_hid, device) => {
    const connect = freshConnector();
    const opening = deferred();
    device.openGate = opening.promise;
    const closing = deferred();
    device.closeGate = closing.promise;
    const pending = connect();
    await turn();
    await turn();
    const rejected = assert.rejects(pending);
    opening.reject(new Error("Synthetic permission failure"));
    await turn();
    await turn();
    assert.equal(device.closes, 1);
    await assert.rejects(connect(), /in progress/);
    closing.resolve();
    await rejected;
    device.openGate = Promise.resolve();
    const next = await connect();
    assert.equal(device.opens, 2);
    await next.close();
  });
});

test("missing selected identity never treats an arbitrary HID event as the selected device", async () => {
  let disconnected = 0;
  const events = new EventTarget();
  const fake = {
    disconnect: async () => {
      disconnected++;
    },
    close() {},
  } as unknown as DeviceManagementKit;
  const transport = new ActualTransport(fake, "no-identity", events);
  events.dispatchEvent(disconnectEvent());
  await turn();
  assert.equal(disconnected, 0);
  await transport.close();
});

test("SDK destroy failure still awaits raw close and quarantines later connections", async () => {
  await withHid(async (_hid, device) => {
    const connect = freshConnector({
      transport(value) {
        const transport = value as { destroy(): void };
        const destroy = transport.destroy.bind(transport);
        transport.destroy = () => {
          destroy();
          throw new Error("Synthetic teardown failure");
        };
      },
    });
    const first = await connect();
    const gate = deferred();
    device.closeGate = gate.promise;
    let settled = false;
    const closing = assert.rejects(first.close(), /Reload/).then(() => {
      settled = true;
    });
    await turn();
    assert.equal(device.closes, 1);
    assert.equal(settled, false);
    gate.resolve();
    await closing;
    await assert.rejects(connect(), /Reload/);
    assert.equal(device.opens, 1);
  });
});

test("failed connect still awaits raw close when DMK close itself throws", async () => {
  await withHid(async (_hid, device) => {
    const connect = freshConnector({
      dmk(dmk) {
        const close = dmk.close.bind(dmk);
        dmk.close = () => {
          close();
          throw new Error("Synthetic DMK teardown failure");
        };
      },
    });
    const opening = deferred();
    device.openGate = opening.promise;
    const closing = deferred();
    device.closeGate = closing.promise;
    let settled = false;
    const pending = assert.rejects(connect(), /Reload/).then(() => {
      settled = true;
    });
    await turn();
    opening.reject(new Error("Synthetic failed open"));
    await turn();
    await turn();
    assert.equal(device.closes, 1);
    assert.equal(settled, false);
    closing.resolve();
    await pending;
    await assert.rejects(connect(), /Reload/);
    assert.equal(device.opens, 1);
  });
});
