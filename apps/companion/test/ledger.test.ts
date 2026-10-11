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
const { DmkPearlTransport, PearlCommand } = module.exports;
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
  events.dispatchEvent(new Event("disconnect"));
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
  events.dispatchEvent(new Event("disconnect"));
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
  events.dispatchEvent(new Event("disconnect"));
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
      events.dispatchEvent(new Event("disconnect"));
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
