/** Independent deterministic boundary campaign. Public fixture only, no device/network. */
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import * as s from "../../packages/sdk/src/index.ts";
import * as w from "../../packages/wallet/src/index.ts";
import { WatchStorage } from "../../apps/companion/src/storage.ts";
import { signedRecoveryBackup } from "../../apps/companion/src/signed-recovery.ts";

const root = process.cwd();
const seed = Number(process.env.PRL_SEED ?? "0x51a9beef") >>> 0;
let randomState = seed;
function random() {
  randomState ^= randomState << 13;
  randomState ^= randomState >>> 17;
  randomState ^= randomState << 5;
  return randomState >>> 0;
}
const pick = <T,>(items: T[]): T => items[random() % items.length]!;
const clone = <T,>(value: T): T => structuredClone(value);
const fixture = JSON.parse(readFileSync("fixtures/protocol-v1.json", "utf8"));
const account = s.accountFromJson(fixture.publicAccount);
const originalBundle = s.decodeBundle(s.fromHex(fixture.bundleHex));
const states: w.PaymentState[] = ["draft", "signing", "signed", "broadcast-unknown", "accepted"];
const attemptId = "00000000-0000-4000-8000-000000000001";
const output = process.env.PRL_OUTPUT ?? `tools/wallet-property-review/results-${seed.toString(16)}.json`;
const sourcePaths = [
  ...["packages/sdk/src", "packages/wallet/src"].flatMap((dir) =>
    readdirSync(dir).filter((p) => p.endsWith(".ts")).map((p) => `${dir}/${p}`)),
  "apps/companion/src/storage.ts", "apps/companion/src/signed-recovery.ts",
  "apps/companion/src/backup-import.ts", "apps/companion/src/backup-import.worker.ts",
  "apps/companion/src/main.ts", "fixtures/protocol-v1.json", "package-lock.json",
];
function hashes() {
  return Object.fromEntries(sourcePaths.map((p) => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
}
const startedAt = new Date().toISOString();
const initialHashes = hashes();
const results: { name: string; cases: number; durationMs: number; outcome: string; detail?: string }[] = [];
async function check(name: string, cases: number, fn: () => unknown | Promise<unknown>) {
  const start = performance.now();
  try {
    await fn();
    results.push({ name, cases, durationMs: Math.round(performance.now() - start), outcome: "pass" });
    console.log(`PASS ${name} (${cases})`);
  } catch (error) {
    const detail = error instanceof Error ? error.stack ?? error.message : String(error);
    results.push({ name, cases, durationMs: Math.round(performance.now() - start), outcome: "fail", detail });
    console.log(`FAIL ${name}: ${detail}`);
  }
}
function journal(state: w.PaymentState = "draft", id = "property-payment") {
  const j = w.emptyJournal();
  w.reservePayment(j, clone(originalBundle), id, 1000);
  if (state === "draft") return j;
  w.transitionPayment(j, id, "signing").signingAttempt = { id: attemptId, recovery: false };
  if (state === "signing") return j;
  w.transitionPayment(j, id, "signed", { rawTx: fixture.rawTx, txid: fixture.txid });
  if (state === "signed") return j;
  w.transitionPayment(j, id, "broadcast-unknown");
  if (state === "accepted") w.transitionPayment(j, id, "accepted");
  return j;
}
function mergedState(a: w.PaymentState, b: w.PaymentState): w.PaymentState {
  if ([a, b].includes("broadcast-unknown") && [a, b].includes("accepted")) return "broadcast-unknown";
  return states[Math.max(states.indexOf(a), states.indexOf(b))]!;
}
function uniqueDraft(n: number): w.WalletJournal {
  const b = clone(originalBundle);
  for (let i = 0; i < b.inputs.length; i++) b.inputs[i]!.txid = (BigInt(n * 16 + i + 1)).toString(16).padStart(64, "0");
  const j = w.emptyJournal();
  w.reservePayment(j, b, `unique-payment-${n}`, 1000);
  return j;
}

await check("all stale-state pairs preserve reservations, exact signed bytes and uncertainty", 25, () => {
  for (const a of states) for (const b of states) {
    const current = journal(a), incoming = journal(b), incomingBefore = clone(incoming);
    current.nextChangeIndex = 30; incoming.issuedReceiveThrough = 60;
    incomingBefore.issuedReceiveThrough = 60;
    w.mergeRestoredJournal(current, incoming);
    assert.equal(current.payments[0]!.state, mergedState(a, b), `${a} + ${b}`);
    assert.equal(w.reservedOutpoints(current).size, 2);
    assert.equal(current.nextChangeIndex, 30);
    assert.equal(current.issuedReceiveThrough, 60);
    if (states.indexOf(mergedState(a, b)) >= 2) {
      assert.equal(current.payments[0]!.rawTx, fixture.rawTx);
      assert.equal(current.payments[0]!.txid, fixture.txid);
    }
    assert.deepEqual(incoming, incomingBefore, "incoming source remains unchanged");
  }
});

await check("seeded replay sequences are idempotent and retain irreversible signing ambiguity", 1000, () => {
  for (let c = 0; c < 1000; c++) {
    const initial = pick(states), current = journal(initial);
    let expected = initial;
    for (let i = 0; i < 30; i++) {
      const state = pick(states), backup = journal(state);
      backup.nextChangeIndex = random() % 10000;
      backup.issuedReceiveThrough = random() % 10000;
      expected = mergedState(expected, state);
      const beforeChange = current.nextChangeIndex, beforeReceive = current.issuedReceiveThrough;
      w.mergeRestoredJournal(current, backup);
      const once = clone(current);
      w.mergeRestoredJournal(current, backup);
      assert.deepEqual(current, once, `idempotence case=${c} step=${i}`);
      assert.equal(current.payments[0]!.state, expected);
      assert(current.nextChangeIndex >= beforeChange && current.issuedReceiveThrough >= beforeReceive);
      assert.equal(w.reservedOutpoints(current).size, 2);
      if (states.indexOf(expected) >= 2) assert.equal(current.payments[0]!.rawTx, fixture.rawTx);
    }
  }
});

await check("merge failure leaves its target unchanged after a later reservation conflict", 1, () => {
  const existing = uniqueDraft(1), incoming = uniqueDraft(2);
  const conflict = clone(existing.payments[0]!);
  conflict.id = "different-conflicting-id";
  incoming.payments.push(conflict);
  // Both inputs independently pass the production importer, so this is not malformed direct-call input.
  const checkedExisting = w.importWalletBackup(w.exportWalletBackup(account, existing)).journal;
  const checkedIncoming = w.importWalletBackup(w.exportWalletBackup(account, incoming)).journal;
  const before = clone(checkedExisting);
  assert.throws(() => w.mergeRestoredJournal(checkedExisting, checkedIncoming), /conflicts/);
  assert.deepEqual(checkedExisting, before, "Atomic-merge public API changed the target despite rejecting the merge");
});

await check("amount oracle covers exact 64-bit bounds and 5000 seeded canonical round trips", 5018, () => {
  const boundary = [0n, 1n, 9n, 10n, 99_999_999n, 100_000_000n, 9007199254740991n, 9007199254740992n,
    9007199254740993n, s.MAX_GRAINS - 1n, s.MAX_GRAINS];
  for (let i = 0; i < 5000; i++) boundary.push(((BigInt(random()) << 32n) | BigInt(random())) % (s.MAX_GRAINS + 1n));
  for (const amount of boundary) {
    const formatted = `${amount / 100000000n}.${(amount % 100000000n).toString().padStart(8, "0")}`;
    assert.equal(s.formatPrl(amount), formatted);
    assert.equal(s.parsePrl(formatted), amount);
    assert.equal(s.parseGrains(amount.toString()), amount);
  }
  for (const amount of [-1n, s.MAX_GRAINS + 1n, 0xffffffffffffffffn]) {
    assert.throws(() => s.formatPrl(amount));
    assert.throws(() => s.parseGrains(amount.toString()));
  }
  assert.throws(() => s.parsePrl("21000000000.00000001"));
});

await check("amount parsers reject suffix/prefix Unicode, exponent, sign, precision and nonstring mutations", 1200, () => {
  const invalid = ["", " ", "-0", "-1", "+1", "01", "00.1", ".1", "1.", "1e1", "0x10", "1_000", "NaN", "Infinity", "１", "١", "1,0", "1.000000000"];
  const unicode = ["\n", "\r", "\r\n", "\t", " ", "\u00a0", "\u2028", "\u2029", "\u0000", "\u200b", "\ufeff", "💰"];
  for (let i = 0; i < 1200; i++) {
    const mode = random() % 4, canonical = (random() % 1000000).toString();
    const bad: unknown = mode === 0 ? pick(invalid) : mode === 1 ? pick(unicode) + canonical : mode === 2 ? canonical + pick(unicode) : pick([null, false, 1, [], {}, 0n]);
    assert.throws(() => s.parsePrl(bad as string), `PRL accepted ${String(bad)}`);
    assert.throws(() => s.parseGrains(bad as string), `grains accepted ${String(bad)}`);
  }
});

await check("relay integer oracle matches floor, fallback, int64 overflow and monetary cap", 4000, () => {
  for (let i = 0; i < 4000; i++) {
    const size = pick([1, 999, 1000, 1001, Number.MAX_SAFE_INTEGER, random() % 1_000_000 + 1]);
    const rate = pick([0n, 1n, 999n, 1000n, s.MAX_GRAINS, BigInt(random())]);
    const product = BigInt(size) * rate;
    let expected = product > (1n << 63n) - 1n ? s.MAX_GRAINS : product / 1000n;
    if (expected === 0n && rate > 0n) expected = rate;
    if (expected > s.MAX_GRAINS) expected = s.MAX_GRAINS;
    assert.equal(w.minimumRelayFee(size, { minRelayFeeGrainsPerKvB: rate }), expected);
  }
});

const signedBackup = JSON.parse(w.exportWalletBackup(account, journal("signed")));
const invalidMutations: [string, (v: any) => void][] = [
  ["root extra", v => v.privateKey = "no-secret-test-marker"],
  ["root schema", v => v.schema = "2"], ["root missing", v => delete v.account],
  ["root wrong kind", v => v.kind = "pearl-public-recovery"],
  ["account extra", v => v.account.extra = 0], ["account malformed", v => v.account.publicKey = "02" + "00".repeat(32)],
  ["journal extra", v => v.journal.extra = 0], ["journal schema", v => v.journal.schema = 2],
  ["payments not array", v => v.journal.payments = {}], ["too many payments", v => v.journal.payments = Array(2001).fill(v.journal.payments[0])],
  ["duplicate payment", v => v.journal.payments.push(clone(v.journal.payments[0]))],
  ["duplicate reserved", v => { const p = clone(v.journal.payments[0]); p.id = "another-id"; v.journal.payments.push(p); }],
  ["payment extra", v => v.journal.payments[0].extra = 0], ["payment absent", v => delete v.journal.payments[0].bundleHex],
  ["reservation absent", v => v.journal.payments[0].outpoints = []], ["reservation reversed", v => v.journal.payments[0].outpoints.reverse()],
  ["unknown state", v => v.journal.payments[0].state = "rejected"], ["unsigned has bytes", v => v.journal.payments[0].state = "draft"],
  ["signing has bytes", v => v.journal.payments[0].state = "signing"], ["signed lacks bytes", v => delete v.journal.payments[0].rawTx],
  ["changed txid", v => v.journal.payments[0].txid = "00".repeat(32)], ["signed trailing bytes", v => v.journal.payments[0].rawTx += "00"],
  ["uppercase bundle", v => v.journal.payments[0].bundleHex = v.journal.payments[0].bundleHex.toUpperCase()],
  ["change allocation lost", v => v.journal.nextChangeIndex = 0],
  ["attempt in signed", v => v.journal.payments[0].signingAttempt = { id: attemptId, recovery: false }],
  ["error oversize", v => v.journal.payments[0].lastError = "a".repeat(1001)],
];
const invalidNumbers = [null, -1, 0.5, 0x80000000, "1", [], {}];
for (const bad of invalidNumbers) {
  invalidMutations.push([`change ${JSON.stringify(bad)}`, v => v.journal.nextChangeIndex = bad]);
  if (bad !== -1) invalidMutations.push([`receive ${JSON.stringify(bad)}`, v => v.journal.issuedReceiveThrough = bad]);
}
for (const bad of [null, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, "1", [], {}])
  invalidMutations.push([`time ${JSON.stringify(bad)}`, v => v.journal.payments[0].createdAt = bad]);
for (const bad of [null, "", "short", "a".repeat(65), "a b c d e", 1, [], {}])
  invalidMutations.push([`id ${JSON.stringify(bad)}`, v => v.journal.payments[0].id = bad]);

await check("seeded malformed backup schemas always reject before use", 512, () => {
  for (let i = 0; i < 512; i++) {
    const value = clone(signedBackup), [label, mutate] = invalidMutations[i % invalidMutations.length]!;
    mutate(value);
    assert.throws(() => w.importWalletBackup(JSON.stringify(value)), `case=${i}, mutation=${label}`);
  }
});

await check("signed witness and byte corruption cannot survive backup import", 160, () => {
  for (let i = 0; i < 160; i++) {
    const value = clone(signedBackup), p = value.journal.payments[0];
    const chars = p.rawTx.split(""), at = random() % chars.length;
    chars[at] = ((parseInt(chars[at], 16) + 1 + random() % 15) % 16).toString(16);
    p.rawTx = chars.join("");
    assert.throws(() => w.importWalletBackup(JSON.stringify(value)), `byte mutation=${i}, nibble=${at}`);
  }
});

await check("signed emergency backup requires exact verified result and survives roundtrip", 24, () => {
  const valid = s.finalizeTransaction(originalBundle, fixture.signatures.map(s.fromHex));
  for (let i = 0; i < 20; i++) {
    const invalid = clone(valid);
    if (i % 2) invalid.signatures[random() % invalid.signatures.length]![random() % 64] ^= 1;
    else invalid.rawTx += "00";
    assert.throws(() => signedRecoveryBackup(account, originalBundle, invalid, "emergency-property", 1000));
  }
  const restored = w.importWalletBackup(signedRecoveryBackup(account, originalBundle, valid, "emergency-property", 1000));
  assert.equal(restored.journal.payments[0]!.rawTx, fixture.rawTx);
  assert.equal(restored.journal.payments[0]!.txid, fixture.txid);
  assert.equal(restored.journal.payments[0]!.state, "signed");
  assert.equal(w.reservedOutpoints(restored.journal).size, 2);
});

await check("invalid/replayed rejection ownership cannot release uncertainty", 500, () => {
  for (let i = 0; i < 500; i++) {
    const state = pick(states.filter(x => x !== "draft")), j = journal(state);
    const before = clone(j);
    const attempted = i % 2 ? attemptId.replace(/1$/, "2") : "bad-attempt";
    assert.throws(() => w.rejectBeforeSigning(j, "property-payment", attempted));
    assert.deepEqual(j, before);
    assert.throws(() => w.discardDraft(j, "property-payment"));
    assert.equal(w.reservedOutpoints(j).size, 2);
  }
});

/** Deliberately small IDB event model. This verifies production handlers only, not browser durability. */
async function loadedJournal(row: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const tx: any = { error: null, abort() { queueMicrotask(() => tx.onabort?.()); },
    objectStore() { return { get() { const req: any = { result: clone(row) }; queueMicrotask(() => {
      req.onsuccess?.(); queueMicrotask(() => tx.oncomplete?.());
    }); return req; } }; } };
  const db = { transaction() { return tx; } };
  Object.defineProperty(globalThis, "indexedDB", { configurable: true, value: { open() {
    const req: any = { result: db }; queueMicrotask(() => req.onsuccess?.()); return req;
  } } });
  try { return await new WatchStorage().journal("public-fixture-account"); }
  finally {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  }
}

await check("corrupt stored signed reservation list fails closed before input reuse", 1, async () => {
  const damaged = journal("signed");
  damaged.payments[0]!.outpoints = [];
  let returned: w.WalletJournal;
  try { returned = await loadedJournal(damaged); }
  catch { return; }
  const second = clone(originalBundle), change = second.outputs.find(o => o.role === "change")!;
  change.index = returned.nextChangeIndex;
  change.scriptPubKey = s.deriveAddress(account, 1, change.index).scriptPubKey;
  s.validateBundle(second, account);
  assert.throws(() => w.reservePayment(returned, second, "replacement-payment", 1001),
    "Corrupt signed record was trusted and the same two inputs were reserved for a second payment");
});

await check("corrupt local high-water bounds fail closed", 6, async () => {
  const accepted: unknown[] = [];
  for (const mutate of [
    (j: any) => j.nextChangeIndex = -1,
    (j: any) => j.nextChangeIndex = Number.MAX_SAFE_INTEGER,
    (j: any) => j.issuedReceiveThrough = "1",
    (j: any) => j.issuedReceiveThrough = -2,
    (j: any) => j.issuedReceiveThrough = 0x80000000,
    (j: any) => j.issuedReceiveThrough = null,
  ]) {
    const damaged = w.emptyJournal(); mutate(damaged);
    try { await loadedJournal(damaged); accepted.push(damaged); } catch { /* fail closed */ }
  }
  assert.deepEqual(accepted, [], "Malformed local recovery bounds were accepted");
});

const finalHashes = hashes();
const report = {
  startedAt, finishedAt: new Date().toISOString(), seed, seedHex: `0x${seed.toString(16)}`,
  rng: "xorshift32", node: process.version, baseCommit: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
  initialHashes, finalHashes, sourceChangedDuringRun: sourcePaths.filter(p => initialHashes[p] !== finalHashes[p]),
  results, cases: results.reduce((n, r) => n + r.cases, 0), failures: results.filter(r => r.outcome === "fail").length,
  limitations: [
    "Offline frozen public fixture. No real device, seed, funded account, browser profile, server or network broadcast.",
    "IndexedDB event source is modeled. No claim of actual IndexedDB scheduling, rollback, quota, crash or power-loss behavior.",
    "Public merge API atomicity finding may be contained by application's enclosing IndexedDB transaction abort.",
    "Persisted-row corruption tests assume malformed local data already exists; no source of corruption or external attack path is demonstrated.",
    "No absolute security conclusion. Case counts describe bounded deterministic assertions, not independent vulnerabilities or physical tests.",
  ],
};
mkdirSync(output.slice(0, output.lastIndexOf("/")), { recursive: true });
writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ output, seed, cases: report.cases, failures: report.failures, sourceChangedDuringRun: report.sourceChangedDuringRun }));
process.exitCode = report.failures ? 1 : 0;
