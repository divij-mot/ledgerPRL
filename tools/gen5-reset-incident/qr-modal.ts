/** Offline incident investigation. Hash-pinned baseline or candidate ELF; public fixture only. */
import assert from "node:assert/strict";
import net from "node:net";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  Emulator,
  pause,
} from "../../apps/ledger-bitcoin-prl/prl-tests/emulator.ts";
import { LedgerBitcoinPrlClient } from "../../packages/bitcoin-prl-adapter/src/index.ts";
const elf = process.env.PEARL_APP_ELF ?? "/firmware/app.elf",
  output = process.env.PEARL_EVIDENCE ?? "/out",
  expected = process.env.PEARL_EXPECTED_SHA256;
assert(
  expected && /^[a-f0-9]{64}$/.test(expected),
  "Bind the exact tested image hash",
);
const expectPowerExit = process.env.PEARL_EXPECT_POWER_EXIT === "1";
assert.equal(
  createHash("sha256")
    .update(await readFile(elf))
    .digest("hex"),
  expected,
);
class Wire {
  s = net.createConnection(5122, "127.0.0.1");
  b = Buffer.alloc(0);
  replies: Buffer[] = [];
  q: {
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  constructor(readonly timeoutMs = 30000) {
    this.s.on("data", (x) => {
      this.b = Buffer.concat([this.b, x]);
      while (this.b.length >= 4) {
        const n = this.b.readUInt32BE() + 2;
        assert(n <= 4096);
        if (this.b.length < n + 4) break;
        const b = Buffer.from(this.b.subarray(4, n + 4));
        this.b = this.b.subarray(n + 4);
        this.replies.push(b);
        const q = this.q.shift();
        if (q) {
          clearTimeout(q.timer);
          q.resolve(b);
        }
      }
    });
    this.s.on("error", (e) => this.fail(e));
    this.s.on("close", () => this.fail(Error("Virtual host TCP closed")));
  }
  fail(e: Error) {
    for (const q of this.q.splice(0)) {
      clearTimeout(q.timer);
      q.reject(e);
    }
  }
  async ready() {
    if (this.s.connecting)
      await new Promise<void>((r, j) => {
        this.s.once("connect", r);
        this.s.once("error", j);
      });
  }
  send(b: Uint8Array) {
    const h = Buffer.alloc(4);
    h.writeUInt32BE(b.length);
    this.s.write(Buffer.concat([h, b]));
  }
  exchange(b: Uint8Array) {
    assert(
      !(b[0] === 0xe1 && b[1] === 4),
      "Signing forbidden in incident harness",
    );
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(
        () => this.fail(Error("Bounded host APDU timeout")),
        this.timeoutMs,
      );
      this.q.push({ resolve, reject, timer });
      this.send(b);
    });
  }
  stop() {
    this.s.destroy();
    this.fail(Error("Virtual host TCP closed"));
  }
}
async function until(fn: () => Promise<boolean>, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await pause(100);
  }
  throw Error("Bounded condition timeout");
}
await mkdir(output, { recursive: true });
const results: any[] = [];
const cases = process.env.PEARL_QR_CASES?.split(",") ?? [
  "qr-close",
  "host-timeout",
  "tcp-close",
  "synthetic-power-tag",
  "qr-review-expiry",
  "qr-close-near-expiry",
  "host-timeout-near-expiry",
  "fresh-emulator-after-expiry",
];
for (const mode of cases) {
  assert(
    [
      "qr-close",
      "host-timeout",
      "tcp-close",
      "synthetic-power-tag",
      "qr-review-expiry",
      "qr-close-near-expiry",
      "host-timeout-near-expiry",
      "fresh-emulator-after-expiry",
    ].includes(mode),
  );
  const e = new Emulator("apex_p", elf, `${output}/${mode}`, 5121, 65536);
  let w: Wire | undefined;
  const item: any = {
    mode,
    status: "running",
    elfSha256: expected,
    signing: false,
    broadcast: false,
    physicalDevice: false,
    freshEmulatorInstance: true,
  };
  results.push(item);
  const expiryCase = [
    "qr-review-expiry",
    "qr-close-near-expiry",
    "host-timeout-near-expiry",
  ].includes(mode);
  const watchdog = setTimeout(
    () => e.child?.kill("SIGTERM"),
    expiryCase ? 180000 : 90000,
  );
  try {
    await e.start();
    w = new Wire(expiryCase ? 160000 : 30000);
    await w.ready();
    const client = new LedgerBitcoinPrlClient(w as any, "mainnet");
    const account = await e.approve(
      () => client.exportAccount(0),
      "Approve public key",
      "fixture-account",
    );
    let settled = false;
    let outcome = "pending";
    const request = client
      .verifyAddress(account, 0, 0)
      .then(
        () => {
          outcome = "approved";
        },
        () => {
          outcome = "rejected-or-transport-error";
        },
      )
      .finally(() => {
        settled = true;
      });
    await until(async () =>
      (await e.events()).some((x) => x.text.includes("Verify Pearl")),
    );
    await e.next();
    await until(async () =>
      (await e.events()).some((x) => x.text === "Show as QR"),
    );
    let events = await e.events();
    await e.capture("before-qr", events);
    assert(!settled);
    const image = async () => {
      const response = await fetch(e.url + "/screenshot", {
        signal: AbortSignal.timeout(3000),
      });
      assert(response.ok);
      return Buffer.from(await response.arrayBuffer());
    };
    const beforeQr = await image();
    assert(!events.some((x) => x.text === "Close"));
    const qr = events.find((x) => x.text === "Show as QR")!;
    await e.touch(qr);
    await until(async () => (await e.events()).some((x) => x.text === "Close"));
    events = await e.events();
    await e.capture("qr-open", events);
    assert(!settled);
    const replyCheckpoint = w.replies.length;
    item.qrText = events.map((x) => x.text);
    item.qrOpen = true;
    const openQr = await image();
    assert(!beforeQr.equals(openQr), "Opening QR did not change pixels");
    const closeQr = async () => {
      assert(e.child?.exitCode === null);
      events = await e.events();
      await e.capture("before-close", events);
      const close = events.find((x) => x.text === "Close");
      assert(close, "QR Close control missing");
      await e.touch(close);
      await until(async () => {
        const ev = await e.events();
        return (
          ev.some((x) => x.text === "Show as QR") &&
          !ev.some((x) => x.text === "Close")
        );
      });
      events = await e.events();
      await e.capture("after-qr-close", events);
      const closedQr = await image();
      assert(!openQr.equals(closedQr), "Close did not change QR pixels");
      assert(
        beforeQr.equals(closedQr),
        "Close did not restore the original address screen",
      );
      item.qrCloseResponsive = true;
      item.originalPixelsRestored = true;
    };
    if (mode === "synthetic-power-tag") {
      item.syntheticInjectionHex = "524157211b";
      item.retailPayloadKnown = false;
      w.send(Buffer.from(item.syntheticInjectionHex, "hex"));
    }
    if (expiryCase || (mode === "synthetic-power-tag" && expectPowerExit)) {
      const started = Date.now();
      if (
        mode === "qr-close-near-expiry" ||
        mode === "host-timeout-near-expiry"
      ) {
        await pause(105000);
        assert(
          !settled && e.child?.exitCode === null,
          "Review ended before near-deadline action",
        );
        if (mode === "qr-close-near-expiry") {
          await closeQr();
          assert(!settled, "Close approved the address");
          item.closeAtMs = Date.now() - started;
        } else {
          w.fail(Error("Synthetic host-only timeout near review deadline"));
          await until(async () => settled);
          item.hostTimeoutAtMs = Date.now() - started;
          await e.capture("host-timeout-near-expiry", await e.events());
        }
      }
      await until(
        async () => e.child?.exitCode !== null,
        expiryCase ? (mode === "qr-review-expiry" ? 150000 : 45000) : 5000,
      );
      item.observedWaitMs = Date.now() - started;
      if (expiryCase)
        assert(
          item.observedWaitMs >= 100000,
          "Review exited before expected deadline interval",
        );
      if (item.closeAtMs !== undefined)
        assert(
          item.observedWaitMs - item.closeAtMs < 45000,
          "Closing QR reset or delayed review expiry",
        );
      item.emulatorExitCode = e.child?.exitCode;
      item.emulatorSignal = e.child?.signalCode;
      await e.stop();
      const log = await readFile(`${output}/${mode}/speculos.log`, "utf8");
      assert(
        log.includes("exit called"),
        "Exit did not have expected SDK/app exit log",
      );
      assert(!log.includes("Traceback"), "Emulator Python failure");
      item.sdkExitLogObserved = true;
      item.approvalObserved = outcome === "approved";
      assert(!item.approvalObserved);
    } else {
      if (mode === "tcp-close") {
        w.stop();
        await until(async () => settled);
      }
      if (mode === "host-timeout") {
        setTimeout(() => w!.fail(Error("Synthetic host-only timeout")), 1000);
        await until(async () => settled);
      }
      await pause(500);
      await closeQr();
      if (mode !== "host-timeout" && mode !== "tcp-close")
        assert(!settled, "QR Close must not approve address");
      const cancel = events.find((x) => x.text === "Cancel");
      assert(cancel);
      await e.touch(cancel);
      await until(async () => {
        const ev = await e.events();
        return (
          ev
            .map((x) => x.text)
            .join(" ")
            .replace(/\s+/g, " ")
            .includes("Address verification cancelled") ||
          ["Pearl", "Send and receive Pearl.", "Quit app"].every((t) =>
            ev.some((x) => x.text === t),
          )
        );
      });
      events = await e.events();
      await e.capture("after-cancel", events);
      if (mode !== "host-timeout" && mode !== "tcp-close") {
        await until(async () => settled);
        assert.equal(outcome, "rejected-or-transport-error");
        assert.equal(
          w.replies.at(-1)?.toString("hex"),
          "6985",
          "Baseline must return an exact device denial",
        );
        item.deviceDenialStatus = "6985";
      }
      assert.notEqual(outcome, "approved");
      item.afterCancelText = events.map((x) => x.text);
      item.explicitCancelledScreen = events
        .map((x) => x.text)
        .join(" ")
        .replace(/\s+/g, " ")
        .includes("Address verification cancelled");
      item.explicitHomeScreen = [
        "Pearl",
        "Send and receive Pearl.",
        "Quit app",
      ].every((t) => events.some((x) => x.text === t));
      assert(item.explicitCancelledScreen || item.explicitHomeScreen);
      item.operationOutcome = outcome;
    }
    if (mode !== "tcp-close") {
      if (item.sdkExitLogObserved)
        await until(async () => w!.s.destroyed, 2000);
      else {
        await until(async () => w!.replies.length > replyCheckpoint);
        assert.equal(
          w.replies.at(-1)?.toString("hex"),
          "6985",
          "Cancel must return device denial even after host waiter fails",
        );
        item.deviceDenialStatus = "6985";
      }
    }
    item.postQrResponses = w.replies.slice(replyCheckpoint).map((b) => ({
      status: b.subarray(-2).toString("hex"),
      length: b.length,
    }));
    assert(
      item.postQrResponses.every(
        (r: { status: string }) => r.status !== "9000",
      ),
      "Successful response received after QR opened without approval",
    );
    item.responseObservation =
      mode === "tcp-close"
        ? "Ends when host TCP socket closes; later device replies unobservable"
        : "Connected until explicit device denial or device process exit";
    item.status = "observed";
  } catch (error) {
    item.status = "failed";
    item.error = error instanceof Error ? error.message : String(error);
    try {
      await e.capture("first-failure", await e.events());
    } catch {}
    throw error;
  } finally {
    clearTimeout(watchdog);
    w?.stop();
    await e.stop();
    if (e.child && e.child.exitCode === null && e.child.signalCode === null) {
      await Promise.race([
        new Promise<void>((r) => e.child!.once("exit", () => r())),
        pause(2000),
      ]);
      if (e.child.exitCode === null && e.child.signalCode === null) {
        e.child.kill("SIGKILL");
        await Promise.race([
          new Promise<void>((r) => e.child!.once("exit", () => r())),
          pause(1000),
        ]);
      }
    }
    assert(
      !e.child || e.child.exitCode !== null || e.child.signalCode !== null,
      "Owned emulator did not terminate",
    );
    await writeFile(
      `${output}/results.json`,
      JSON.stringify(
        {
          scope:
            "Offline emulator only; not BLE, retail power-button, protection-mode or reset equivalence",
          results,
        },
        null,
        2,
      ),
    );
  }
}
