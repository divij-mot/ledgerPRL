/** Bounded varied-session stability using emulated device UI and public keys only. */
import assert from "node:assert/strict";
import { readFile, writeFile, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  accountFromJson,
  accountToJson,
  bundleToJson,
  deriveAddress,
  LedgerPearlClient,
  SpeculosTransport,
  encodeBundle,
  command,
  concat,
  u16,
  sha256,
  hex,
  verifySignature,
  type SigningBundle,
  type ApduTransport,
} from "../../../packages/sdk/src/index.ts";
import {
  Emulator,
  pause,
  type Model,
  type ScreenEvent,
} from "./speculos-driver.ts";

const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL || "nanox") as Model;
assert(["nanosp", "nanox", "stax", "flex", "apex_p"].includes(model));
const instrumented = process.env.PEARL_INSTRUMENTED === "1";
const count = Number(
  process.env.PEARL_STABILITY_SESSIONS || (instrumented ? 20 : 100),
);
assert(
  Number.isInteger(count) && count > 0 && count <= (instrumented ? 20 : 100),
);
const output = process.env.PEARL_EVIDENCE || "";
assert(
  output,
  "Set PEARL_EVIDENCE to a fresh directory on a sufficiently large filesystem",
);
assert(
  !resolve(output).startsWith("/tmp/"),
  "Use shared/workspace storage, not bulk /tmp artifacts",
);
const target = model === "nanosp" ? "nanosplus" : model;
const elf = join(
  root,
  instrumented
    ? `apps/ledger/target/memory-measurement/pearl-${target}-simnet-INSTRUMENTED.elf`
    : `apps/ledger/target/artifacts/pearl-${target}-simnet.elf`,
);
const hashFile = async (path: string) =>
  createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const sourceFiles = {
  harness: import.meta.filename,
  driver: join(import.meta.dirname, "speculos-driver.ts"),
  fixture: join(root, "fixtures/protocol-v1.json"),
  dependencyLock: join(root, "package-lock.json"),
};
const sourceSha256 = Object.fromEntries(
  await Promise.all(
    Object.entries(sourceFiles).map(async ([name, path]) => [
      name,
      await hashFile(path),
    ]),
  ),
);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = accountFromJson({
  ...fixture.publicAccount,
  network: "simnet",
});
const kinds = [
  "sign",
  "address",
  "abort-upload",
  "reject-review",
  "invalid-ownership-or-point",
  "partial-signature-abort",
  "invalid-upload",
  "export",
  "sign",
  "max16",
] as const;
const now = () => performance.now();
async function jsonFile(path: string, value: unknown) {
  await writeFile(path + ".new", JSON.stringify(value, null, 2) + "\n");
  await rename(path + ".new", path);
}
class StabilityEmulator extends Emulator {
  round = 0;
  captures = 0;
  override async capture(label: string, events: ScreenEvent[]) {
    const text = events.map((e) => e.text).join(" | ");
    this.screens.push({ label, text, events });
    if (this.screens.length > 64) this.screens.shift();
    // Only first/last periodic maximum-input confirmation/amount samples.
    if (
      (this.round === 9 || this.round === count - 1) &&
      (text.includes("Sign Pearl transfer") || text.includes("Amount")) &&
      this.captures < 8
    ) {
      const png = await fetch(this.url + "/screenshot");
      assert(png.ok);
      await writeFile(
        join(this.output, `sample-${this.round}-${++this.captures}.png`),
        Buffer.from(await png.arrayBuffer()),
      );
    }
  }
  async reject(operation: () => Promise<Uint8Array>, label: string) {
    let done = false,
      seenReview = false,
      rejected = false,
      prior = "";
    const pending = operation().finally(() => {
      done = true;
    });
    pending.catch(() => {});
    for (let i = 0; i < 250 && !done; i++) {
      await pause(180);
      if (done) break;
      const events = await this.events(),
        text = events.map((e) => e.text).join(" | ");
      if (text !== prior) {
        await this.capture(label, events);
        prior = text;
      }
      if (
        text.includes("app is ready") ||
        text.includes("This app enables signing")
      )
        continue;
      seenReview ||=
        text.includes("Review Pearl transfer") ||
        text.includes("From account") ||
        text.includes("Recipient");
      if (this.model === "nanosp" || this.model === "nanox") {
        if (events.some((e) => e.text.startsWith("Reject"))) {
          rejected = true;
          await this.button("both");
        } else await this.next();
      } else {
        const choice =
          events.find((e) => /Yes, reject/i.test(e.text)) ||
          events.find((e) => e.text === "Reject");
        if (choice) {
          rejected = true;
          await this.touch(choice);
        } else await this.next();
      }
    }
    assert(
      done && seenReview && rejected,
      "Expected actual visible emulated review and rejection",
    );
    return pending;
  }
}
const emulator = new StabilityEmulator(
  model,
  elf,
  output,
  Number(process.env.SPECULOS_API_PORT || 5401),
  256 * 1024,
);
const tailApdus: { request: string; response: string; ms: number }[] = [];
let apduCount = 0;
const underlying = new SpeculosTransport(emulator.url);
const transport: ApduTransport = {
  async exchange(apdu, signal) {
    const started = now();
    const response = await underlying.exchange(apdu, signal);
    tailApdus.push({
      request: hex(apdu),
      response: hex(response),
      ms: now() - started,
    });
    if (tailApdus.length > 32) tailApdus.shift();
    apduCount++;
    return response;
  },
};
const client = new LedgerPearlClient(transport, "simnet");
const records: Record<string, unknown>[] = [];
const resources: Record<string, unknown>[] = [];
let currentBundle: SigningBundle | undefined;
let failure: unknown;
const startedAt = new Date().toISOString();
const started = now();
const checkedSignatures: { complete: number; partial: number } = {
  complete: 0,
  partial: 0,
};
function build(round: number, n: number, forceChange = false): SigningBundle {
  const inputs = Array.from({ length: n }, (_, i) => {
    const branch = ((round + i) & 1) as 0 | 1,
      index = (round * 19 + i * 7) % 50_000;
    return {
      txid: hex(
        sha256(new TextEncoder().encode(`Pearl-stability-v1:${round}:${i}`)),
      ),
      vout: i,
      amount:
        round % 11 === 0
          ? 9_007_199_254_740_993n
          : 1_000_000n + BigInt(round * 101 + i),
      scriptPubKey: deriveAddress(account, branch, index).scriptPubKey,
      sequence: 0xffff_ffff,
      branch,
      index,
    };
  });
  const total = inputs.reduce((a, i) => a + i.amount, 0n);
  const fee =
    round % 17 === 0
      ? (total + 9n) / 10n + 1n
      : round % 3 === 0
        ? 0n
        : round % 3 === 1
          ? 1n
          : 10_000n;
  const change = forceChange || round % 3 !== 0;
  const send = change ? ((total - fee) * 3n) / 5n : total - fee;
  const outputs: SigningBundle["outputs"] = [
    {
      amount: send,
      scriptPubKey: deriveAddress(account, 0, 40_000 + round).scriptPubKey,
      role: "recipient",
      branch: 0,
      index: 0,
    },
  ];
  if (change)
    outputs.push({
      amount: total - fee - send,
      scriptPubKey: deriveAddress(account, 1, 30_000 + round).scriptPubKey,
      role: "change",
      branch: 1,
      index: 30_000 + round,
    });
  if (change && round % 2 === 0) outputs.reverse();
  return {
    network: "simnet",
    account: 0,
    version: 1,
    lockTime: 0,
    inputs,
    outputs,
  };
}
async function expect(apdu: Uint8Array, sw = "9000", empty = false) {
  const response = await transport.exchange(apdu);
  assert.equal(hex(response.subarray(-2)), sw);
  if (empty || sw !== "9000")
    assert.equal(response.length, 2, "Status-only failure/ack required");
  return response.subarray(0, -2);
}
async function upload(bytes: Uint8Array, digest = sha256(bytes)) {
  await expect(command(0x10, concat(u16(bytes.length), digest)), "9000", true);
  for (let offset = 0; offset < bytes.length; offset += 253)
    await expect(
      command(0x11, concat(u16(offset), bytes.slice(offset, offset + 253))),
      "9000",
      true,
    );
}
async function unavailable() {
  await expect(command(0x13, Uint8Array.of(0)), "6986");
  await expect(command(0x12), "6986");
}
async function memory(initialize = false) {
  const bytes = await expect(
    Buffer.from(initialize ? "b057000100" : "b057010100", "hex"),
  );
  assert.equal(bytes.length, 16);
  return {
    ...Object.fromEntries(
      ["stackHighWater", "heapPeak", "heapCurrent", "heapCapacity"].map(
        (name, i) => [name, Buffer.from(bytes).readUInt32BE(i * 4)],
      ),
    ),
  };
}
async function rss() {
  const pids = new Set<number>();
  async function visit(pid: number) {
    if (pids.has(pid)) return;
    pids.add(pid);
    try {
      const children = await readFile(
        `/proc/${pid}/task/${pid}/children`,
        "utf8",
      );
      for (const child of children.trim().split(/\s+/).filter(Boolean))
        await visit(Number(child));
    } catch {}
  }
  await visit(emulator.child!.pid!);
  let kib = 0;
  for (const pid of pids)
    try {
      const text = await readFile(`/proc/${pid}/status`, "utf8");
      kib += Number(text.match(/^VmRSS:\s+(\d+)/m)?.[1] || 0);
    } catch {}
  return {
    emulatorProcessRssKiB: kib,
    hostHarnessHeapBytes: process.memoryUsage().heapUsed,
  };
}
async function checkpoint(completed: number) {
  const sample: Record<string, unknown> = {
    completed,
    ...(await rss()),
    ...(instrumented ? await memory() : {}),
  };
  resources.push(sample);
  if (instrumented && completed > 0) {
    // Once the ordinary home UI is initialized, every completed flow must
    // return to the same live allocation baseline. Peaks are cumulative.
    assert.equal(
      sample.heapCurrent,
      resources[0]!.heapCurrent,
      "Instrumented idle app heap drift after completed session",
    );
    assert(Number(sample.heapPeak) <= Number(sample.heapCapacity));
  }
  await jsonFile(join(output, "progress.json"), {
    status: "running",
    completed,
    total: count,
    last: records.at(-1),
    resources: sample,
  });
}
try {
  await emulator.start();
  if (instrumented) await memory(true);
  else await expect(Buffer.from("b057010100", "hex"), "6d00");
  await checkpoint(0);
  for (let round = 0; round < count; round++) {
    emulator.round = round;
    const kind = kinds[round % kinds.length]!;
    const n =
      kind === "max16"
        ? 16
        : kind === "partial-signature-abort"
          ? 2
          : [1, 2, 3, 5][(round + Math.floor(round / 10)) % 4]!;
    currentBundle = build(round, n, kind === "invalid-ownership-or-point");
    const bytes = encodeBundle(currentBundle),
      before = now(),
      priorTiming = emulator.approvalTimings.length;
    let verified = 0;
    if (kind === "sign" || kind === "max16") {
      const signed = await emulator.approve(
        () => client.signBundle(currentBundle!, account),
        "Sign Pearl transfer",
        `${round}-${kind}`,
      );
      assert.equal(signed.signatures.length, n);
      verified = n;
      checkedSignatures.complete += n;
      await unavailable();
    } else if (kind === "address") {
      const branch = (round % 2) as 0 | 1,
        index = round * 37;
      assert.equal(
        await emulator.approve(
          () => client.verifyAddress(account, branch, index),
          "Confirm",
          `${round}-address`,
        ),
        deriveAddress(account, branch, index).address,
      );
    } else if (kind === "export") {
      const result = await emulator.approve(
        () => client.exportAccount(0),
        "Approve export",
        `${round}-export`,
      );
      assert.deepEqual(accountToJson(result), accountToJson(account));
    } else if (kind === "abort-upload") {
      await expect(
        command(0x10, concat(u16(bytes.length), sha256(bytes))),
        "9000",
        true,
      );
      const partial =
        ((round / 10) | 0) % 2 === 0
          ? Math.min(53, bytes.length)
          : bytes.length;
      for (let offset = 0; offset < partial; offset += 253)
        await expect(
          command(
            0x11,
            concat(
              u16(offset),
              bytes.slice(offset, Math.min(offset + 253, partial)),
            ),
          ),
          "9000",
          true,
        );
      await expect(command(0x14), "9000", true);
      await unavailable();
    } else if (kind === "reject-review") {
      await upload(bytes);
      const response = await emulator.reject(
        () => transport.exchange(command(0x12)),
        `${round}-reject`,
      );
      assert.equal(hex(response), "6985");
      await unavailable();
    } else if (kind === "invalid-ownership-or-point") {
      const malformed = Uint8Array.from(bytes),
        cycle = ((round / 10) | 0) % 3;
      if (cycle === 0) {
        const recipient = currentBundle.outputs.findIndex(
          (o) => o.role === "recipient",
        );
        malformed.fill(
          0,
          19 + 87 * n + 48 * recipient + 10,
          19 + 87 * n + 48 * recipient + 42,
        );
      } else if (cycle === 1)
        malformed.set(deriveAddress(account, 0, 49_999).scriptPubKey, 19 + 44);
      else {
        const change = currentBundle.outputs.findIndex(
          (o) => o.role === "change",
        );
        assert(change >= 0);
        malformed.set(
          deriveAddress(account, 0, 49_998).scriptPubKey,
          19 + 87 * n + 48 * change + 8,
        );
      }
      await upload(malformed);
      await expect(command(0x12), "6a80");
      await unavailable();
    } else if (kind === "partial-signature-abort") {
      await upload(bytes);
      const review = await emulator.approve(
        () => expect(command(0x12)),
        "Sign Pearl transfer",
        `${round}-partial-signature`,
      );
      assert.equal(review.length, 33);
      assert.equal(review[0], n);
      assert.equal(hex(review.subarray(1)), hex(sha256(bytes)));
      const signature = await expect(command(0x13, Uint8Array.of(0)));
      assert(verifySignature(currentBundle, 0, signature));
      verified = 1;
      checkedSignatures.partial++;
      await expect(command(0x14), "9000", true);
      await expect(command(0x13, Uint8Array.of(1)), "6986");
      await unavailable();
    } else if (kind === "invalid-upload") {
      if (((round / 10) | 0) % 2 === 0) {
        await expect(
          command(0x10, concat(u16(bytes.length), sha256(bytes))),
          "9000",
          true,
        );
        await expect(command(0x11, concat(u16(1), bytes.slice(0, 20))), "6a80");
      } else {
        const hash = sha256(bytes);
        hash[0] = hash[0]! ^ 1;
        await upload(bytes, hash);
        await expect(command(0x12), "6a80");
      }
      await unavailable();
    }
    // This succeeds only after the native session has returned to idle.
    await expect(command(0));
    assert.equal(
      emulator.child!.exitCode,
      null,
      "Unexpected native process termination",
    );
    const record = {
      round: round + 1,
      kind,
      status: "passed",
      inputs: n,
      bundleSha256: hex(sha256(bytes)),
      verifiedSignatures: verified,
      wallMs: now() - before,
      approvalTimings: emulator.approvalTimings.slice(priorTiming),
    };
    records.push(record);
    // Official Speculos DELETE /events clears historical OCR observations,
    // not current screen content or app state. Bound this known observer cache
    // so its intentional growth is not mistaken for a native allocator leak.
    const cleared = await fetch(emulator.url + "/events", { method: "DELETE" });
    assert(cleared.ok, "Failed to bound Speculos observation history");
    console.log(
      `PASS ${model} ${instrumented ? "instrumented" : "release"} ${round + 1}/${count} ${kind} ${Math.round(record.wallMs)}ms`,
    );
    if ((round + 1) % 10 === 0 || round + 1 === count)
      await checkpoint(round + 1);
  }
} catch (error) {
  failure = error;
  console.error("FAIL", model, records.length + 1, String(error));
  if (currentBundle)
    await jsonFile(
      join(output, "failure-bundle.json"),
      bundleToJson(currentBundle),
    );
  try {
    const screenshot = await fetch(emulator.url + "/screenshot");
    if (screenshot.ok)
      await writeFile(
        join(output, "failure.png"),
        Buffer.from(await screenshot.arrayBuffer()),
      );
  } catch {}
} finally {
  await emulator.stop();
  const timings = records
    .flatMap((r) =>
      (r.approvalTimings as { gestureToResultMs: number }[]).map(
        (t) => t.gestureToResultMs,
      ),
    )
    .sort((a, b) => a - b);
  const groupLatency = Object.fromEntries(
    kinds
      .filter((x, i, a) => a.indexOf(x) === i)
      .map((kind) => {
        const values = records
          .filter((r) => r.kind === kind)
          .map((r) => Number(r.wallMs))
          .sort((a, b) => a - b);
        return [
          kind,
          {
            count: values.length,
            minMs: values[0],
            medianMs: values[Math.floor(values.length / 2)],
            p95Ms:
              values[
                Math.min(values.length - 1, Math.floor(values.length * 0.95))
              ],
            maxMs: values.at(-1),
          },
        ];
      }),
  );
  const sourceSha256After = Object.fromEntries(
    await Promise.all(
      Object.entries(sourceFiles).map(async ([name, path]) => [
        name,
        await hashFile(path),
      ]),
    ),
  );
  if (
    Object.entries(sourceSha256).some(
      ([key, value]) => value !== sourceSha256After[key],
    )
  )
    failure ||= new Error(
      "Harness, driver, fixture, or lock changed while testing",
    );
  const summary = {
    status: failure ? "failed" : "passed",
    model,
    buildKind: instrumented
      ? "instrumented-resource-replay"
      : "release-stability",
    firmware: emulator.provenance,
    publicTestSeed: "000102030405060708090a0b0c0d0e0f",
    fixtureDescription: fixture.description,
    generator: "Pearl-stability-v1 deterministic round/index derivation",
    requestedSessions: count,
    completedSessions: records.length,
    startedAt,
    finishedAt: new Date().toISOString(),
    wallMs: now() - started,
    apduCount,
    checkedSignatures,
    sessionKinds: Object.fromEntries(
      kinds.map((k) => [k, records.filter((r) => r.kind === k).length]),
    ),
    groupLatency,
    approvalGestureToVerifiedResultMs: {
      count: timings.length,
      min: timings[0],
      median: timings[Math.floor(timings.length / 2)],
      p95: timings[
        Math.min(timings.length - 1, Math.floor(timings.length * 0.95))
      ],
      max: timings.at(-1),
    },
    drift: {
      emulatorRssWarmBaselineCompletedSessions: resources[1]?.completed,
      emulatorRssWarmBaselineKiB: resources[1]?.emulatorProcessRssKiB,
      emulatorRssFinalKiB: resources.at(-1)?.emulatorProcessRssKiB,
      emulatorRssWarmToFinalDeltaKiB:
        resources.length > 1
          ? Number(resources.at(-1)!.emulatorProcessRssKiB) -
            Number(resources[1]!.emulatorProcessRssKiB)
          : null,
      ...(instrumented
        ? {
            appHeapInitialBytes: resources[0]?.heapCurrent,
            appHeapFinalBytes: resources.at(-1)?.heapCurrent,
            appHeapIdleDeltaBytes:
              Number(resources.at(-1)?.heapCurrent) -
              Number(resources[0]?.heapCurrent),
            appHeapPeakBytes: resources.at(-1)?.heapPeak,
            appHeapCapacityBytes: resources.at(-1)?.heapCapacity,
            appStackHighWaterBytes: resources.at(-1)?.stackHighWater,
          }
        : {}),
    },
    resources,
    records,
    failure: failure ? String(failure) : null,
    scope:
      "Emulated device UI only; synthetic public-test outpoints; no broadcasts, physical hardware, external transactions or hardware performance claims",
    resourceScope: instrumented
      ? "SDK app-stack/allocator measurements from separately instrumented ELF; not OS/syscall memory"
      : "Emulator process RSS and host harness heap only; not native app allocation measurements",
    observerMaintenance:
      "Bounded 256 KiB Speculos log tail and 64 UI observations; official DELETE /events clears historical OCR observations after each idle session without changing current screen or firmware state",
    sourceSha256,
    sourceUnchanged: Object.entries(sourceSha256).every(
      ([key, value]) => value === sourceSha256After[key],
    ),
  };
  await jsonFile(join(output, "summary.json"), summary);
  await jsonFile(join(output, "last-apdus.json"), tailApdus);
}
if (failure) throw failure;
