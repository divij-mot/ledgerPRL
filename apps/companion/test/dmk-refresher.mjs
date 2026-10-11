// Real installed DeviceSession, intent queue, pinger/refresher and transport
// connection state machine. Endpoint native policy is a model, not a device.
import fs from "node:fs";
import { createPsbtEndpoint, P } from "./psbt-endpoint.mjs";
import { LedgerBitcoinPrlClient } from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url))),
  require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const dmk = require("@ledgerhq/device-management-kit"),
  { Right } = require("purify-ts");
const { DeviceSession } = require(
  path.join(
    root,
    "node_modules/@ledgerhq/device-management-kit/lib/cjs/src/internal/device-session/model/DeviceSession.js",
  ),
);
const sdk = await import(
  pathToFileURL(path.join(root, "packages/sdk/src/index.ts"))
);
const f = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = sdk.accountFromJson(f.publicAccount),
  bundle = sdk.bundleFromJson(f.bundle);
// These two immutable capture records describe ONE native Nano S Plus simnet
// ELF run under Speculos, not the five modeled device IDs exercised below.
// Their historical testedSnapshot paths are provenance, never runtime inputs.
const idle = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/dmk-idle-info.json", import.meta.url),
    "utf8",
  ),
);
const receiving = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/dmk-receiving-info.json", import.meta.url),
    "utf8",
  ),
);
for (const capture of [idle, receiving]) {
  assert.equal(capture.firmware.model, "nanosp");
  assert.equal(
    capture.firmware.sha256,
    "016a24fb3dce05d48a08118575802a44d561c29781572fbeab9d037bda77a661",
  );
  assert.equal(capture.firmware.speculos, "0.27.1");
  assert.equal(
    capture.firmware.publicTestSeed,
    "000102030405060708090a0b0c0d0e0f",
  );
  assert.equal(capture.firmware.injector, null);
}
const appInfo = new dmk.GetAppAndVersionCommand();
assert.equal(sdk.hex(appInfo.getApdu().getRawApdu()), idle.command);
const idleBytes = sdk.fromHex(idle.response);
const parsedInfo = appInfo.parseResponse(
  new dmk.ApduResponse({
    data: idleBytes.slice(0, -2),
    statusCode: idleBytes.slice(-2),
  }),
);
assert(dmk.isSuccessCommandResult(parsedInfo));
assert.deepEqual(parsedInfo.data, {
  name: "Pearl Sim Dev",
  version: "0.1.0",
  flags: Uint8Array.of(0),
});
console.log(
  "PASS historical PRL1 native capture: installed DMK parser accepts the recorded Nano S Plus idle app-info response",
);
assert.equal(receiving.intruder, idle.command);
assert.equal(receiving.begin.slice(0, 10), "e010000022");
assert.equal(sdk.fromHex(receiving.begin).length, 39);
assert.deepEqual(receiving.responses, ["9000", "6986"]);
assert.equal(receiving.nativeExit, 1);
assert.equal(receiving.processExit, 1);
assert(
  !dmk.isSuccessCommandResult(
    appInfo.parseResponse(
      new dmk.ApduResponse({
        data: new Uint8Array(),
        statusCode: sdk.fromHex(receiving.responses[1]),
      }),
    ),
  ),
);
console.log(
  "PASS historical PRL1 native capture: recorded Nano S Plus BEGIN then B0 ping faults and exits; no firmware is rerun by this host test",
);

const built = await build({
  entryPoints: [path.join(root, "apps/companion/src/ledger.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: [
    "@ledgerhq/device-management-kit",
    "@ledgerhq/device-transport-kit-web-hid",
    "rxjs",
  ],
  logLevel: "silent",
});
let connectFacade, fixtureHidTransport;
// Only the WebHID boundary is synthetic. Invoke the production connector's
// public state-machine factory so identity and close ownership are exercised;
// the DeviceSession, intent queue and connection state machine remain real.
const testWebHid = {
  WebHidTransport: class {
    constructor(_models, _logger, _sender, _receiver, createConnection) {
      this.createConnection = createConnection;
      fixtureHidTransport = this;
    }
    destroy() {
      this.connection?.closeConnection();
    }
  },
};
const testDmk = {
  ...dmk,
  DeviceManagementKitBuilder: class {
    addTransport(factory) {
      factory({});
      return this;
    }
    build() {
      return connectFacade;
    }
  },
};
const mod = { exports: {} };
new Function("require", "module", "exports", built.outputFiles[0].text)(
  (name) =>
    name === "@ledgerhq/device-management-kit"
      ? testDmk
      : name === "@ledgerhq/device-transport-kit-web-hid"
        ? testWebHid
        : require(name),
  mod,
  mod.exports,
);
const { connectLedger } = mod.exports;
globalThis.window = { isSecureContext: true };
Object.defineProperty(globalThis, "navigator", {
  value: { hid: new EventTarget() },
  configurable: true,
});
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const logger = new Proxy({}, { get: () => () => {} });
async function scenario(
  model,
  disabled,
  { slowReview = false, gapInstruction = P.SIGN_PSBT } = {},
) {
  const sent = [];
  let nativeState = "idle",
    faulted = false;
  // A deliberately strict interrupted-session MODEL tests DMK serialization.
  // The old PRL1 native capture above does not prove this PSBT model behavior.
  const psbt = createPsbtEndpoint({
    onStage: async (stage) => {
      if (stage === "review") {
        nativeState = "review";
        if (slowReview) await pause(2200);
        nativeState = "interrupted";
      }
      if (stage === "signature") nativeState = "signatures";
      if (stage === "ack") nativeState = "idle";
    },
  });
  let rawCloses = 0;
  const hidDevice = {
    productId: 0x4000,
    async open() {},
    async close() {
      rawCloses++;
    },
  };
  const endpoint = {
    async sendApdu(apdu) {
      const cla = apdu[0],
        ins = apdu[1],
        data = apdu.slice(5);
      sent.push({ cla, ins, state: nativeState, time: Date.now() });
      if (faulted)
        throw Error("Modeled native session exited after strict fault");
      if (cla === 0xb0) {
        if (nativeState !== "idle") {
          faulted = true;
          return Right({
            data: new Uint8Array(),
            statusCode: Uint8Array.of(0x69, 0x86),
          });
        }
        return Right({
          data: Uint8Array.from([
            1,
            5,
            ...Buffer.from("Pearl"),
            5,
            ...Buffer.from("0.1.0"),
          ]),
          statusCode: Uint8Array.of(0x90, 0),
        });
      }
      const response = await psbt.transport.exchange(apdu);
      return Right({
        data: response.slice(0, -2),
        statusCode: response.slice(-2),
      });
    },
    async setupConnection() {
      await hidDevice.open();
    },
    closeConnection() {},
    getDependencies() {
      return { device: hidDevice };
    },
    setDependencies() {},
  };
  let connection;
  const connected = {
    id: "public-refresher-fixture",
    deviceModel: { id: model },
    sendApdu: (...args) => connection.sendApdu(...args),
  };
  let session;
  const facade = {
    startDiscovering() {
      return require("rxjs").of({ id: "public-refresher-fixture" });
    },
    async stopDiscovering() {},
    async connect(options) {
      connection = fixtureHidTransport.createConnection({
        deviceId: "public-refresher-fixture",
        deviceApduSender: endpoint,
        timeoutDuration: 5000,
        tryToReconnect() {},
        onTerminated() {},
      });
      fixtureHidTransport.connection = connection;
      await endpoint.setupConnection();
      assert.equal(
        options.sessionRefresherOptions.isRefresherDisabled,
        true,
        "production connector must explicitly disable refresher",
      );
      session = new DeviceSession(
        { connectedDevice: connected, id: "public-refresher-fixture" },
        () => logger,
        {},
        {},
        {
          ...options.sessionRefresherOptions,
          isRefresherDisabled: disabled,
          pollingInterval: 1000,
        },
      );
      await session.initialiseSession();
      return "public-refresher-fixture";
    },
    async sendCommand({ command, abortTimeout }) {
      const result = await session.sendCommand(command, abortTimeout);
      if (command.getApdu().getRawApdu()[1] === gapInstruction)
        await pause(1250);
      return result;
    },
    async disconnect() {
      session.close();
      connection.closeConnection();
    },
    close() {
      session.close();
      connection.closeConnection();
    },
  };
  connectFacade = facade;
  const transport = await connectLedger(undefined, "bitcoin-prl");
  await pause(30);
  const initial = sent.map((x) => [x.cla, x.ins]);
  assert.deepEqual(
    initial,
    [[0xb0, 1]],
    "initial app-info ping occurs exactly once before any Pearl command",
  );
  const client = new LedgerBitcoinPrlClient(transport, "regtest", {
    timeoutMs: 7000,
  });
  try {
    if (disabled) {
      const signed = await client.signBundle(bundle, account);
      assert.equal(signed.rawTx, f.rawTx);
      await pause(1150);
      assert.equal(sent.filter((x) => x.cla === 0xb0).length, 1);
      assert.equal(faulted, false);
      console.log(
        "PASS disabled",
        model,
        "one initial B0 only; full independently verified signed fixture across timer gaps",
      );
    } else {
      await assert.rejects(client.signBundle(bundle, account));
      assert(faulted);
      const polls = sent.filter((x) => x.cla === 0xb0);
      assert(polls.length > 1);
      assert(polls.some((x) => x.state !== "idle"));
      console.log(
        "CONTROL enabled",
        model,
        "periodic B0 entered signing state",
        polls.map((x) => x.state),
      );
    }
  } finally {
    await client.close().catch(() => {});
    session.close();
    connection.closeConnection();
    assert.equal(rawCloses, 1, "all cleanup paths share one physical close");
  }
  return sent;
}
for (const model of [
  dmk.DeviceModelId.NANO_SP,
  dmk.DeviceModelId.NANO_X,
  dmk.DeviceModelId.STAX,
  dmk.DeviceModelId.FLEX,
  dmk.DeviceModelId.APEX,
])
  await scenario(model, true);
await scenario(dmk.DeviceModelId.NANO_SP, false);
const reviewed = await scenario(dmk.DeviceModelId.NANO_SP, false, {
  slowReview: true,
  gapInstruction: P.SIGN_PSBT,
});
assert(
  !reviewed.some(
    (x) =>
      x.cla === 0xb0 &&
      x.state === "review" &&
      x.time > reviewed.find((x) => x.ins === P.SIGN_PSBT).time,
  ),
  "busy SIGN_PSBT suppresses polls until the interrupted response returns",
);
console.log(
  "PASS queue boundary: polling is blocked during a command, not across the whole multi-command signing flow",
);
