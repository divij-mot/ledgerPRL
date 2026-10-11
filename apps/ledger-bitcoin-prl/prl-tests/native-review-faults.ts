/** Real API27 firmware review-session fault tests, public vector-one seed only. */
import assert from "node:assert/strict";
import net from "node:net";
import { readFile, writeFile, mkdtemp, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { Emulator, pause, type Model } from "./emulator.ts";
import {
  accountToJson,
  bundleFromJson,
  deriveAddress,
  NETWORKS,
  type NetworkName,
  type SpeculosTransport,
} from "../../../packages/sdk/src/index.ts";
import {
  buildPrlPsbt,
  LedgerBitcoinPrlClient,
} from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import { apdu, response, publicAccount, rawSign } from "./raw-protocol.ts";
const root = resolve(import.meta.dirname, "../../..");
const network = (process.env.SPECULOS_NETWORK ?? "regtest") as NetworkName;
assert(Object.hasOwn(NETWORKS, network), "Unsupported test network");
const model = (process.env.SPECULOS_MODEL ?? "nanosp") as Model;
const target = model === "nanosp" ? "nanos2" : model;
const elf =
  process.env.PEARL_APP_ELF ??
  join(
    root,
    `apps/ledger-bitcoin-prl/build-artifacts/${target}-${network}/app.elf`,
  );
const output =
  process.env.PEARL_EVIDENCE ??
  (await mkdtemp("/workspace/shared/prl-bitcoin-review-faults-"));
const port = Number(process.env.SPECULOS_API_PORT ?? 5161);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
class Wire {
  socket: net.Socket;
  buffer = Buffer.alloc(0);
  responses: Buffer[] = [];
  pending: {
    resolve: (b: Buffer) => void;
    reject: (e: Error) => void;
    timer: NodeJS.Timeout;
  }[] = [];
  constructor(port: number) {
    this.socket = net.createConnection(port, "127.0.0.1");
    this.socket.on("data", (chunk) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      while (this.buffer.length >= 4) {
        const n = this.buffer.readUInt32BE() + 2;
        assert(n <= 4096);
        if (this.buffer.length < n + 4) break;
        const b = Buffer.from(this.buffer.subarray(4, 4 + n));
        this.buffer = this.buffer.subarray(4 + n);
        this.responses.push(b);
        const p = this.pending.shift();
        if (p) {
          clearTimeout(p.timer);
          p.resolve(b);
        }
      }
    });
    const close = (e: Error) => {
      for (const p of this.pending.splice(0)) {
        clearTimeout(p.timer);
        p.reject(e);
      }
    };
    this.socket.on("error", close);
    this.socket.on("close", () => close(new Error("Device transport closed")));
  }
  async ready() {
    if (this.socket.connecting)
      await new Promise<void>((r, j) => {
        this.socket.once("connect", r);
        this.socket.once("error", j);
      });
  }
  send(b: Uint8Array) {
    const h = Buffer.alloc(4);
    h.writeUInt32BE(b.length);
    this.socket.write(Buffer.concat([h, b]));
  }
  exchange(b: Uint8Array) {
    return new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("APDU timeout")), 20000);
      this.pending.push({ resolve, reject, timer });
      this.send(b);
    });
  }
  stop() {
    this.socket.destroy();
  }
  get transport() {
    return this as unknown as SpeculosTransport;
  }
}
let identity: Awaited<ReturnType<typeof publicAccount>> | undefined;
const results: {
  name: string;
  status: string;
  firmware?: unknown;
  detail?: string;
}[] = [];
async function test(name: string, fn: (e: Emulator, w: Wire) => Promise<void>) {
  if (
    process.env.PRL_FAULT_CASE &&
    !process.env.PRL_FAULT_CASE.split(",").includes(name)
  )
    return;
  const e = new Emulator(model, elf, join(output, name), port, 1_000_000);
  let w: Wire | undefined;
  const record = {
    name,
    status: "running",
    firmware: undefined as unknown,
    detail: undefined as string | undefined,
  };
  results.push(record);
  try {
    await e.start();
    record.firmware = e.provenance;
    w = new Wire(port + 1);
    await w.ready();
    if (!identity)
      identity = await publicAccount(w.transport, network, (op) =>
        e.approve(op, "Approve public key", "account"),
      );
    await fn(e, w);
    record.status = "passed";
    console.log("PASS", model, name);
  } catch (err) {
    record.status = "failed";
    record.detail = String(err);
    throw err;
  } finally {
    w?.stop();
    await e.stop();
    await mkdir(output, { recursive: true });
    await writeFile(
      join(output, "result.json"),
      JSON.stringify(
        {
          network,
          actualTickerPayloadKnown: false,
          actualStatusPayloadKnown: false,
          results,
        },
        null,
        2,
      ),
    );
    await pause(200);
  }
}
function paymentPsbt() {
  const bundle = bundleFromJson({ ...fixture.bundle, network });
  if (network === "mainnet") {
    for (const input of bundle.inputs)
      input.scriptPubKey = deriveAddress(
        identity!.account,
        input.branch,
        input.index,
      ).scriptPubKey;
    for (const output of bundle.outputs)
      if (output.role === "change")
        output.scriptPubKey = deriveAddress(
          identity!.account,
          1,
          output.index,
        ).scriptPubKey;
  }
  return buildPrlPsbt(bundle, identity!.account);
}
async function reachFinal(e: Emulator, w: Wire) {
  const psbt = paymentPsbt();
  const pending = rawSign(w.transport, psbt, identity!.policy);
  pending.catch(() => {});
  for (let i = 0; i < 150; i++) {
    await pause(130);
    const events = await e.events();
    if (
      events.some((x) =>
        x.text.replace(/\s+/g, " ").startsWith("Sign transaction"),
      )
    ) {
      await e.capture("final-before-fault", events);
      return pendingWrapper(pending);
    }
    const warning = events.find((x) => x.text === "Review anyway");
    if (warning) {
      if (model === "nanosp" || model === "nanox") await e.button("both");
      else await e.touch(warning);
    } else if (!events.some((x) => x.text.includes("app is ready")))
      await e.next();
  }
  throw new Error("Final native approval screen not reached");
}
// An object avoids async Promise assimilation while the review remains pending.
function pendingWrapper(pending: ReturnType<typeof rawSign>) {
  return { pending };
}
async function stopped(e: Emulator, w: Wire, start: number) {
  for (let i = 0; i < 100 && e.child!.exitCode === null; i++) await pause(30);
  assert.notEqual(
    e.child!.exitCode,
    null,
    "Fault did not terminate native review",
  );
  assert(
    w.responses
      .slice(start)
      .every(
        (b) =>
          response(b).status !== 0x9000 &&
          !(response(b).status === 0xe000 && b[0] === 0x10),
      ),
    "Success or signature escaped after fault",
  );
  // Persist bounded logs before checking: stop() writes retained output.
  await e.stop();
  const log = await readFile(join(e.output, "speculos.log"), "utf8");
  assert(
    log.includes("exit called"),
    "Firmware did not execute explicit fail-closed exit",
  );
  assert(
    !log.includes("Traceback"),
    "Emulator failure is not native rejection evidence",
  );
}
// Replay captured ticker/STATUS framing through the actual SDK/NBGL review loop.
// Neither physical payload was recorded: all test payloads are synthetic.
for (const [name, bytes, accepted] of [
  ["account-empty-ticker", "524157210e", true],
  ["account-four-byte-ticker-zero", "524157210e00000000", true],
  ["account-four-byte-ticker-high", "524157210effffffff", true],
  ["account-four-byte-ticker-mixed", "524157210e01020304", true],
  ["account-one-byte-ticker", "524157210e00", true],
  ["account-four-byte-display", "524157210d00000000", true],
  ["account-four-byte-status", "524157211500000000", true],
  ["account-ten-byte-status-zero", "5241572115" + "00".repeat(10), true],
  ["account-ten-byte-status-high", "5241572115" + "ff".repeat(10), true],
  ["account-ten-byte-status-mixed", "524157211500010203040506070809", true],
  ["account-button-suffix", "524157210500ff", true],
  ["account-finger-suffix", "524157210c0200000000000000", true],
  ["account-empty-button", "5241572105", false],
  ["account-short-finger", "524157210c02000000", false],
  ["account-unknown-event", "52415721ff", false],
  ["account-malformed-apdu", "e1040001", false],
  ["account-nested-capabilities", "e106000100", false],
] as const) {
  await test(name, async (e, w) => {
    await e.json("/ticker/", { action: "pause" });
    const client = new LedgerBitcoinPrlClient(w.transport, network, {
      timeoutMs: 20000,
    });
    let done = false;
    const pending = client.exportAccount(0).finally(() => {
      done = true;
    });
    pending.catch(() => {});
    let reviewing = false;
    for (let i = 0; i < 60; i++) {
      await pause(80);
      assert.equal(e.child!.exitCode, null, "Exited before injected event");
      const events = await e.events();
      if (events.some((x) => /public\s*key/i.test(x.text))) {
        await e.capture("account-before-event", events);
        reviewing = true;
        break;
      }
    }
    assert(reviewing && !done, "Pending account review not reached");
    const start = w.responses.length;
    w.send(Buffer.from(bytes, "hex"));
    if (!accepted) {
      await stopped(e, w, start);
      await assert.rejects(pending);
      return;
    }
    await pause(500);
    assert.equal(
      e.child!.exitCode,
      null,
      "Valid SDK UX event terminated review",
    );
    assert.equal(
      done,
      false,
      "SDK UX event completed account export without approval",
    );
    assert.equal(
      w.responses.length,
      start,
      "SDK UX event released an APDU response",
    );
    await e.capture("account-after-event", await e.events());
    await e.json("/ticker/", { action: "resume" });
    const account = await e.approve(
      () => pending,
      "Approve public key",
      "account-after-ux-event",
    );
    assert.deepEqual(accountToJson(account), accountToJson(identity!.account));
  });
}
for (const [name, bytes] of [
  ["nested-capabilities-apdu", apdu(6)],
  ["nested-sign-apdu", apdu(4)],
  ["bolos-version-apdu", Buffer.from("b001000000", "hex")],
  ["malformed-apdu", Buffer.from("e1040001", "hex")],
  ["empty-button-event", Buffer.from("5241572105", "hex")],
  ["invalid-button-mask", Buffer.from("524157210501", "hex")],
  ["short-finger-event", Buffer.from("524157210c010000", "hex")],
  ["invalid-finger-kind", Buffer.from("524157210c0300000000", "hex")],
  ["empty-itc-event", Buffer.from("524157211a", "hex")],
  ["unexpected-pairing-itc", Buffer.from("524157211a22", "hex")],
] as const) {
  await test(name, async (e, w) => {
    const { pending } = await reachFinal(e, w);
    const start = w.responses.length;
    w.send(bytes);
    await stopped(e, w, start);
    await assert.rejects(pending);
  });
}
await test("real-review-timeout", async (e, w) => {
  const { pending } = await reachFinal(e, w);
  const start = w.responses.length;
  await e.json("/ticker/", { action: "pause" });
  let steps = 0;
  for (; steps < 1201 && e.child!.exitCode === null; steps++) {
    try {
      await e.json("/ticker/", { action: "single-step" });
    } catch {
      break;
    }
  }
  assert(steps > 900, "Timeout occurred too early for a 1200-tick review");
  await stopped(e, w, start);
  await assert.rejects(pending);
});
await test("absolute-command-deadline", async (e, w) => {
  await e.json("/ticker/", { action: "pause" });
  const start = w.responses.length;
  let ticks = 0,
    commands = 0;
  const psbt = paymentPsbt();
  const pending = rawSign(w.transport, psbt, identity!.policy, {
    respond: async (_req, standard) => {
      ++commands;
      assert(commands <= 76, "Whole-command budget reset by a continuation");
      // Every reply beats the existing 50-tick per-interruption deadline, but the
      // immutable 3000-tick whole-command budget must still end this conversation.
      for (let i = 0; i < 40; i++) {
        await e.json("/ticker/", { action: "single-step" });
        ++ticks;
      }
      return standard();
    },
  });
  await assert.rejects(pending);
  assert(ticks >= 2960 && commands >= 74, "Wrong timeout boundary");
  await stopped(e, w, start);
});
await test("deny-and-restart-cleanly", async (e, w) => {
  const { pending } = await reachFinal(e, w);
  if (model === "nanosp" || model === "nanox") {
    await e.next();
    await pause(150);
    const events = await e.events();
    assert(
      events.some((x) => x.text === "Reject transaction"),
      "Expected rejection screen",
    );
    await e.capture("deny", events);
    await e.button("both");
  } else {
    const reject = (await e.events()).find((x) => x.text === "Reject");
    assert(reject);
    await e.touch(reject);
    await pause(150);
    const events = await e.events();
    await e.capture("deny", events);
    const yes = events.find((x) => x.text === "Yes, reject");
    assert(yes);
    await e.touch(yes);
  }
  const denied = await pending;
  assert.equal(denied.status, 0x6985);
  assert.equal(denied.yields.length, 0);
  assert.equal(response(await w.exchange(apdu(6))).status, 0x9000);
  const psbt = paymentPsbt();
  const signed = await e.approve(
    () => rawSign(w.transport, psbt, identity!.policy),
    "Sign transaction",
    "fresh-review",
  );
  assert.equal(signed.status, 0x9000);
  assert.equal(signed.yields.length, 2);
});
console.log(
  `PASS ${model}: ${results.length} native review lifecycle cases; ${output}`,
);
