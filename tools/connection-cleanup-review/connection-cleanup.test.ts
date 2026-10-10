import test from "node:test";
import assert from "node:assert/strict";
import {
  deferred,
  flush,
  mountMain,
  setup,
  until,
  type Fault,
} from "./harness.ts";

test("real installed stack: chooser rejection closes DMK and destroys HID listeners", async () => {
  const h = setup({
    chooser: async () => {
      throw new DOMException("User cancelled device chooser", "NotFoundError");
    },
  });
  await assert.rejects(
    h.ledger.connectLedger(),
    (error: any) => error._tag === "NoAccessibleDeviceError",
  );
  assert.equal(h.hid.requests, 1);
  assert.equal(h.state.connects, 0);
  assert.equal(h.state.closes, 1);
  assert.equal(h.state.destroys, 1);
  h.assertClean();
});
test("real installed stack: empty chooser selection rejects and cleans resources", async () => {
  const h = setup({ chooser: async () => [] });
  await assert.rejects(
    h.ledger.connectLedger(),
    (error: any) => error._tag === "NoAccessibleDeviceError",
  );
  assert.equal(h.state.connects, 0);
  h.assertClean();
});
test("real installed stack: vanished device between choice and connection rejects cleanly", async () => {
  const h = setup({ devices: async () => [] });
  await assert.rejects(
    h.ledger.connectLedger(),
    (error: any) => error._tag === "UnknownDeviceError",
  );
  assert.equal(h.state.connects, 1);
  assert.equal(h.device.opens, 0);
  h.assertClean();
});
test("real installed stack: HID open rejection removes global discovery listeners and sessions", async () => {
  const h = setup({
    open: async () => {
      throw new DOMException("Synthetic device unavailable", "NetworkError");
    },
  });
  await assert.rejects(
    h.ledger.connectLedger(),
    (error: any) => error._tag === "ConnectionOpeningError",
  );
  assert.equal(h.device.opens, 1);
  assert.equal(h.state.closes, 1);
  assert.equal(h.state.destroys, 1);
  h.assertClean();
  // Library behavior characterization, not a pass for complete listener removal:
  // setupConnection assigns the report callback before awaiting device.open().
  assert.equal(typeof h.device.oninputreport, "function");
});
for (const fault of [
  "start-sync",
  "start-error",
  "start-empty",
  "stop-sync",
  "stop-reject",
  "connect-sync",
  "connect-reject",
  "connect-after-session",
] satisfies Fault[]) {
  test(`injected defensive branch: ${fault} leaves no session or global HID listeners`, async () => {
    const h = setup({ fault });
    await assert.rejects(h.ledger.connectLedger(), (error: any) =>
      fault === "start-empty"
        ? error.name === "EmptyError"
        : error.message === `Injected ${fault}`,
    );
    await flush();
    assert.equal(h.state.factories.length, 1);
    assert.equal(h.state.starts, 1);
    assert.equal(h.state.stops, fault.startsWith("start-") ? 0 : 1);
    assert.equal(h.state.connects, fault.startsWith("connect-") ? 1 : 0);
    assert.equal(h.state.closes, 1);
    assert.equal(h.state.destroys, 1);
    h.assertClean();
  });
}
test("real installed stack: successful connection and idempotent close release sessions/listeners", async () => {
  const h = setup();
  const transport = await h.ledger.connectLedger(undefined, "bitcoin-prl");
  assert.equal(h.state.dmks[0]!.listConnectedDevices().length, 1);
  assert.equal(h.device.opened, true);
  assert.deepEqual(h.listeners(), { connect: 1, disconnect: 2 });
  assert.deepEqual(h.state.sessionOptions, [{ isRefresherDisabled: true }]);
  assert.equal(
    h.device.reports.length,
    1,
    "Only installed DMK public ping occurs",
  );
  await transport.close();
  await transport.close();
  h.assertClean();
  assert.equal(h.state.destroys, 1);
  await assert.rejects(
    transport.exchange(Uint8Array.of(0xe1, 6, 0, 1, 0)),
    /closed/,
  );
});
test("cleanup throwing after actual cleanup still rejects and runs both owners' teardown", async () => {
  const h = setup({
    chooser: async () => [],
    closeThrows: true,
    destroyThrows: true,
  });
  await assert.rejects(h.ledger.connectLedger(), /Injected destroy failure/);
  assert.equal(h.state.closes, 1);
  assert.equal(h.state.destroys, 1);
  h.assertClean();
});
test("30 repeated alternating chooser failures and successes do not accumulate global listeners or sessions", async () => {
  const h = setup();
  for (let i = 0; i < 30; i++) {
    h.options.chooser = async () => (i % 2 === 0 ? [] : [h.device]);
    if (i % 2 === 0) await assert.rejects(h.ledger.connectLedger());
    else {
      const transport = await h.ledger.connectLedger();
      await transport.close();
    }
    h.assertClean();
  }
  assert.equal(h.state.dmks.length, 30);
  assert.equal(h.state.destroys, 30);
});
for (const action of ["cancel", "unload"] as const) {
  for (const phase of ["chooser", "stop", "open"] as const) {
    test(`actual main.ts ${action} during ${phase}: late completion closes session before application APDU`, async () => {
      const gate = deferred<void>();
      const h = setup();
      if (phase === "chooser")
        h.options.chooser = async () => {
          await gate.promise;
          return [h.device];
        };
      if (phase === "stop") h.options.stopGate = gate.promise;
      if (phase === "open") h.options.open = () => gate.promise;
      const app = mountMain(h);
      const pending = app.main.auditConnect();
      await until(() =>
        phase === "chooser"
          ? h.hid.requests === 1
          : phase === "stop"
            ? h.state.stops === 1
            : h.device.opens === 1,
      );
      app[action]();
      assert.equal(app.main.auditState().aborted, true);
      assert.equal(
        app.main.auditState().busy,
        true,
        "Cancellation is deferred while initial connection is pending",
      );
      // Rapid reconnect is blocked by the actual main busy guard.
      await app.main.auditConnect();
      assert.equal(h.hid.requests, 1);
      gate.resolve();
      await pending;
      assert.equal(app.main.auditState().busy, false);
      assert.equal(app.main.auditState().client, null);
      assert.equal(app.main.auditState().transport, null);
      assert.equal(app.main.auditState().account, null);
      assert(
        h.device.reports.length <= 1,
        "No Pearl application command after cancellation",
      );
      h.assertClean();
    });
  }
}

test("real installed stack: denied getDevices produces no usable connection and no listener accumulation", async () => {
  const h = setup({
    devices: async () => {
      throw new DOMException("Synthetic enumeration denied", "SecurityError");
    },
  });
  await assert.rejects(
    h.ledger.connectLedger(),
    (error: any) => error._tag === "UnknownDeviceError",
  );
  assert.equal(h.device.opens, 0);
  h.assertClean();
});
test("real installed stack: unsupported model is rejected before HID open", async () => {
  const h = setup();
  h.device.productId = 0xffff;
  await assert.rejects(h.ledger.connectLedger());
  assert.equal(h.device.opens, 0);
  h.assertClean();
});
test("real installed stack: first discovery result closes observable and opens just one session", async () => {
  const h = setup();
  h.options.chooser = async () => [h.device, h.device];
  const transport = await h.ledger.connectLedger();
  assert.equal(h.state.connects, 1);
  assert.equal(h.state.subscriptions, 0);
  assert.equal(h.state.dmks[0]!.listConnectedDevices().length, 1);
  await transport.close();
  h.assertClean();
});
test("discovery timeout destroys listeners and rejects late chooser result without opening a session", async (t) => {
  const gate = deferred<void>();
  const h = setup();
  h.options.chooser = async () => {
    await gate.promise;
    return [h.device];
  };
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pending = assert.rejects(
    h.ledger.connectLedger(),
    (error: any) => error.name === "TimeoutError",
  );
  await until(() => h.hid.requests === 1);
  t.mock.timers.tick(60_000);
  await pending;
  h.assertClean();
  assert.equal(h.state.connects, 0);
  gate.resolve();
  await flush();
  assert.equal(h.state.connects, 0);
  assert.equal(h.device.opens, 0);
  h.assertClean();
});
test("late result from timed-out chooser cannot affect a fresh successful connection", async (t) => {
  const gate = deferred<void>();
  const h = setup();
  h.options.chooser = async () => {
    await gate.promise;
    return [h.device];
  };
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pending = assert.rejects(h.ledger.connectLedger());
  await until(() => h.hid.requests === 1);
  t.mock.timers.tick(60_000);
  await pending;
  h.assertClean();
  h.options.chooser = async () => [h.device];
  const fresh = await h.ledger.connectLedger();
  gate.resolve();
  await flush();
  assert.equal(h.state.connects, 1);
  assert.equal(h.state.dmks[0]!.listConnectedDevices().length, 0);
  assert.equal(h.state.dmks[1]!.listConnectedDevices().length, 1);
  assert.deepEqual(h.listeners(), { connect: 1, disconnect: 2 });
  await fresh.close();
  h.assertClean();
});
test("actual main.ts cancel during chooser timeout never opens session or sends any APDU", async (t) => {
  const gate = deferred<void>();
  const h = setup();
  h.options.chooser = async () => {
    await gate.promise;
    return [h.device];
  };
  const app = mountMain(h);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pending = app.main.auditConnect();
  await until(() => h.hid.requests === 1);
  app.cancel();
  t.mock.timers.tick(59_999);
  await flush();
  assert.equal(app.main.auditState().busy, true);
  assert.deepEqual(h.listeners(), { connect: 1, disconnect: 1 });
  t.mock.timers.tick(1);
  await pending;
  assert.equal(app.main.auditState().busy, false);
  h.assertClean();
  gate.resolve();
  await flush();
  assert.equal(h.device.reports.length, 0);
  assert.equal(h.state.connects, 0);
  h.assertClean();
});
for (const action of ["cancel", "unload"] as const) {
  test(`actual main.ts ${action} during installed DMK ping: timeout completion is safely discarded`, async (t) => {
    const h = setup({ ping: "pending" });
    const app = mountMain(h);
    t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
    const pending = app.main.auditConnect();
    await until(() => h.device.reports.length === 1);
    app[action]();
    assert.equal(app.main.auditState().busy, true);
    assert.equal(h.state.dmks[0]!.listConnectedDevices().length, 1);
    t.mock.timers.tick(801);
    await pending;
    assert.equal(app.main.auditState().client, null);
    assert.equal(app.main.auditState().transport, null);
    assert.equal(h.device.reports.length, 1);
    h.assertClean();
  });
}
test("supported DMK semantics: ping send failure is swallowed by DMK; connection still needs caller validation", async () => {
  const h = setup({ ping: "send-reject" });
  const transport = await h.ledger.connectLedger();
  assert.equal(h.state.dmks[0]!.listConnectedDevices().length, 1);
  await transport.close();
  h.assertClean();
});
test("real installed stack: physical disconnect after returned transport cannot resurrect via subsequent HID connect", async () => {
  let notifications = 0;
  const h = setup();
  const transport = await h.ledger.connectLedger(() => notifications++);
  const disconnect = new Event("disconnect");
  Object.assign(disconnect, { device: h.device });
  h.hid.dispatchEvent(disconnect);
  await flush();
  assert.equal(notifications, 1);
  h.assertClean();
  const connect = new Event("connect");
  Object.assign(connect, { device: h.device });
  h.hid.dispatchEvent(connect);
  await flush();
  await assert.rejects(
    transport.exchange(Uint8Array.of(0xe0, 0, 0, 0, 0)),
    /closed/,
  );
  assert.equal(h.device.opens, 1);
  h.assertClean();
});

test("pinned HID report-handler retention is one overwritten device property across failures and recovery", async () => {
  const h = setup({
    open: async () => {
      throw new DOMException("Synthetic open denied", "NetworkError");
    },
  });
  let previous = h.device.oninputreport;
  for (let i = 0; i < 20; i++) {
    await assert.rejects(h.ledger.connectLedger());
    assert.equal(typeof h.device.oninputreport, "function");
    assert.notEqual(h.device.oninputreport, previous);
    previous = h.device.oninputreport;
    h.assertClean();
  }
  h.options.open = async () => {};
  const recovered = await h.ledger.connectLedger();
  assert.notEqual(h.device.oninputreport, previous);
  assert.equal(h.device.reports.length, 1);
  await recovered.close();
  h.assertClean();
});
test("Cancel while HID open is unresolved sends no APDU and preserves intent until eventual rejection", async (t) => {
  const gate = deferred<void>();
  const h = setup({ open: () => gate.promise });
  const app = mountMain(h);
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const pending = app.main.auditConnect();
  await until(() => h.device.opens === 1);
  app.cancel();
  // Deliberately adversarial unresolved platform promise, not a claim that real
  // browser HID.open stays pending this long. There is no application-level bound.
  t.mock.timers.tick(120_000);
  await flush();
  assert.equal(app.main.auditState().busy, true);
  assert.equal(h.device.reports.length, 0);
  assert.equal(h.state.dmks[0]!.listConnectedDevices().length, 0);
  gate.reject(
    new DOMException("Synthetic eventual open failure", "NetworkError"),
  );
  await pending;
  assert.equal(app.main.auditState().busy, false);
  assert.equal(app.main.auditState().account, null);
  assert.equal(h.device.reports.length, 0);
  h.assertClean();
});
test("installed SDK reconnect retention expires without reviving returned terminal transport", async (t) => {
  const h = setup();
  t.mock.timers.enable({ apis: ["setTimeout", "setInterval"] });
  const transport = await h.ledger.connectLedger();
  const disconnect = new Event("disconnect");
  Object.assign(disconnect, { device: h.device });
  h.hid.dispatchEvent(disconnect);
  await flush();
  h.assertClean();
  const reports = h.device.reports.length;
  const connect = new Event("connect");
  Object.assign(connect, { device: h.device });
  h.hid.dispatchEvent(connect);
  t.mock.timers.tick(6_001);
  await flush();
  h.assertClean();
  assert.equal(h.device.reports.length, reports);
  assert.equal(h.device.opens, 1);
  await assert.rejects(
    transport.exchange(Uint8Array.of(0xe0, 0, 0, 0, 0)),
    /closed/,
  );
});
