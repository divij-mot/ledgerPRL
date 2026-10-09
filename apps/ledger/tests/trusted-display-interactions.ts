/** Deterministic public-fixture test. Normal Speculos button/finger events only. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  Emulator,
  pause,
  type Model,
  type ScreenEvent,
} from "./speculos-driver.ts";
import {
  accountFromJson,
  bundleFromJson,
  SpeculosTransport,
  command,
  concat,
  u16,
  u32,
  sha256,
  encodeBundle,
  hex,
  verifySignature,
  type SigningBundle,
} from "../../../packages/sdk/src/index.ts";
const model = (process.env.SPECULOS_MODEL ||
  process.argv[2] ||
  "nanosp") as Model;
const target = model === "nanosp" ? "nanosplus" : model;
const repo = resolve(import.meta.dirname, "../../..");
const root = process.env.PEARL_DISPLAY_EVIDENCE;
assert(
  root,
  "Set PEARL_DISPLAY_EVIDENCE to a fresh evidence root on a sufficiently large filesystem",
);
const e = new Emulator(
  model,
  process.env.PEARL_APP_ELF ||
    join(repo, `apps/ledger/target/artifacts/pearl-${target}-simnet.elf`),
  `${root}/interactions-${model}-${process.env.REVIEW_RUN || "r1"}`,
  Number(process.env.SPECULOS_API_PORT) ||
    5181 + ["nanosp", "nanox", "stax", "flex", "apex_p"].indexOf(model) * 2,
);
const nano = model === "nanosp" || model === "nanox";
// Speculos queues API gestures. Wait beyond their declared duration so consecutive gestures do not overlap.
const originalTouch = e.touch.bind(e),
  originalNext = e.next.bind(e),
  originalButton = e.button.bind(e);
e.touch = async (event, delay = 0.15) => {
  const v = await originalTouch(event, delay);
  await pause(delay * 1000 + 350);
  return v;
};
e.next = async () => {
  const v = await originalNext();
  await pause(550);
  return v;
};
e.button = async (button, action = "press-and-release") => {
  const v = await originalButton(button, action);
  await pause(250);
  return v;
};
const f = JSON.parse(
  await readFile(join(repo, "fixtures/protocol-v1.json"), "utf8"),
);
const account = accountFromJson({ ...f.publicAccount, network: "simnet" });
const transport = new SpeculosTransport(e.url);
let label = "startup",
  prior = "";
const checks: any[] = [];
type Pending = {
  done: boolean;
  value?: Uint8Array;
  error?: unknown;
  promise: Promise<void>;
};
function pending(ins: number, data?: Uint8Array): Pending {
  const p = { done: false } as Pending;
  p.promise = transport
    .exchange(command(ins, data))
    .then(
      (v) => {
        p.value = v;
      },
      (err) => {
        p.error = err;
      },
    )
    .finally(() => {
      p.done = true;
    });
  return p;
}
async function observe() {
  const events = await e.events();
  const text = events.map((x) => x.text).join("|");
  if (text !== prior) {
    await e.capture(label, events);
    prior = text;
  }
  return events;
}
async function waitFor(p: Pending, predicate: (x: ScreenEvent[]) => boolean) {
  for (let i = 0; i < 100; i++) {
    await pause(100);
    if (p.done)
      throw Error(
        `Ended before expected screen: ${hex(p.value || new Uint8Array())}`,
      );
    const x = await observe();
    if (predicate(x)) return x;
  }
  throw Error("UI wait timeout");
}
async function navigate(
  p: Pending,
  predicate: (x: ScreenEvent[]) => boolean,
  allowWarning = false,
) {
  for (let i = 0; i < 100; i++) {
    await pause(100);
    assert(!p.done, "Review ended while navigating");
    const x = await observe();
    if (predicate(x)) return x;
    if (
      x.some(
        (v) =>
          v.text.includes("app is ready") ||
          v.text.includes("This app enables signing"),
      )
    )
      continue;
    const w = x.find((v) => v.text === "Review anyway");
    if (allowWarning && w) {
      if (nano) await e.button("both");
      else await e.touch(w);
    } else await e.next();
  }
  throw Error("Navigation timeout");
}
async function result(p: Pending, expected: string) {
  for (let i = 0; i < 60 && !p.done; i++) await pause(100);
  assert(p.done, "No APDU result");
  if (p.error) throw p.error;
  assert.equal(hex(p.value!), expected);
}
async function noSignature() {
  assert.equal(
    hex(await transport.exchange(command(0x13, Uint8Array.of(0)))),
    "6986",
  );
}
async function load(b: SigningBundle) {
  const raw = encodeBundle(b);
  assert.equal(
    hex(
      await transport.exchange(
        command(0x10, concat(u16(raw.length), sha256(raw))),
      ),
    ),
    "9000",
  );
  for (let o = 0; o < raw.length; o += 253)
    assert.equal(
      hex(
        await transport.exchange(
          command(0x11, concat(u16(o), raw.slice(o, o + 253))),
        ),
      ),
      "9000",
    );
  return pending(0x12);
}
function bundle() {
  const b = bundleFromJson({ ...f.bundle, network: "simnet" });
  b.inputs = [{ ...b.inputs[0]!, amount: 100000000n }];
  b.outputs = [{ ...b.outputs[0]!, amount: 90000000n }];
  return b;
}
async function reject(p: Pending, button: string) {
  if (nano) {
    await navigate(p, (x) => x.some((v) => v.text === button));
    await e.button("both");
  } else {
    const x = await waitFor(p, (x) => x.some((v) => v.text === button));
    await e.touch(x.find((v) => v.text === button)!);
    await pause(150);
    if (!p.done) {
      const y = await observe();
      const yes = y.find((v) => v.text === "Yes, reject");
      if (yes) await e.touch(yes);
    }
  }
  await result(p, "6985");
  await noSignature();
}
try {
  await e.start();
  label = "reject-account";
  let p = pending(0x01, u32(0));
  await reject(p, nano ? "Reject transaction" : "Reject");
  checks.push({ case: label, status: "6985", signatureAfter: "6986" });
  label = "cancel-address";
  p = pending(0x02, concat(u32(0), Uint8Array.of(0), u32(0)));
  await reject(p, "Cancel");
  checks.push({ case: label, status: "6985", signatureAfter: "6986" });
  label = "reject-account-warning";
  p = pending(0x01, u32(101));
  await reject(p, "Reject");
  checks.push({ case: label, status: "6985", signatureAfter: "6986" });
  label = "reject-address-warning";
  p = pending(0x02, concat(u32(0), Uint8Array.of(0), u32(50001)));
  await reject(p, "Reject");
  checks.push({ case: label, status: "6985", signatureAfter: "6986" });
  label = "reject-high-fee-warning";
  p = await load(bundle());
  await reject(p, "Reject");
  checks.push({ case: label, status: "6985", signatureAfter: "6986" });
  label = "reject-transaction";
  p = await load(bundle());
  if (nano) {
    await navigate(p, (x) => x.some((v) => v.text === "Review anyway"));
    await e.button("both");
  } else {
    let x = await waitFor(p, (x) => x.some((v) => v.text === "Review anyway"));
    await e.touch(x.find((v) => v.text === "Review anyway")!);
    await waitFor(p, (x) => x.some((v) => v.text === "Review Pearl transfer"));
  }
  await reject(p, nano ? "Reject transaction" : "Reject");
  checks.push({ case: label, status: "6985", signatureAfter: "6986" });
  label = "back-short-press-final";
  const b = bundle();
  b.outputs[0]!.amount = 99999999n;
  p = await load(b);
  let x = await navigate(p, (x) =>
    x.some((v) => v.text.startsWith("Recipient")),
  );
  const before = x.map((x) => x.text).join("|");
  if (nano) {
    await e.button("both");
    await pause(200);
    assert(!p.done);
    assert.equal((await observe()).map((x) => x.text).join("|"), before);
    await e.button("right");
    await pause(120);
    await observe();
    await e.button("left");
    await pause(120);
    assert.equal((await observe()).map((x) => x.text).join("|"), before);
  } else {
    // Reject confirmation's Back control must not authorize or abort.
    await e.touch(x.find((v) => v.text === "Reject")!);
    await pause(150);
    x = await observe();
    const back = x.find((v) => v.text === "Go back to transaction");
    assert(back);
    await e.touch(back);
    await pause(150);
    assert(!p.done);
    assert.equal((await observe()).map((x) => x.text).join("|"), before);
  }
  x = await navigate(p, (x) => x.some((v) => v.text === "Sign Pearl transfer"));
  if (nano) {
    await e.button("left");
    await pause(100);
    const priorPage = await observe();
    assert(!priorPage.some((v) => v.text === "Sign Pearl transfer"));
    assert(!p.done);
    await e.button("right");
    await pause(100);
    await observe();
    await e.button("both");
  } else {
    const hold = x.find((v) => v.text === "Hold to sign");
    assert(hold);
    await e.touch(hold, 0.1);
    await pause(400);
    assert(!p.done, "Short touch approved");
    await observe();
    await e.touch(hold, 2.5);
  }
  for (let i = 0; i < 70 && !p.done; i++) await pause(100);
  assert(p.done);
  if (p.error) throw p.error;
  assert.equal(hex(p.value!.slice(-2)), "9000");
  assert.equal(p.value!.length, 35);
  const sig = await transport.exchange(command(0x13, Uint8Array.of(0)));
  assert.equal(hex(sig.slice(-2)), "9000");
  assert(verifySignature(b, 0, sig.slice(0, -2)));
  checks.push({
    case: label,
    intermediateApproval: false,
    backKeepsPending: true,
    shortPressRejected: !nano,
    finalApproval: "9000",
    nativeSignatureVerified: true,
  });
  await writeFile(
    `${e.output}/results.json`,
    JSON.stringify(
      { status: "passed", model, firmware: e.provenance, checks },
      null,
      2,
    ),
  );
  console.log("INTERACTIONS COMPLETE", model);
} finally {
  await e.stop();
}
