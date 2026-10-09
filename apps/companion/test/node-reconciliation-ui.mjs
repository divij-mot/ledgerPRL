// Independent known-payment archival review. Actual UI, wallet, SDK, bridge;
// public frozen signatures only; in-process mocks, no listener/network/browser/device.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const sdk = await import(
  pathToFileURL(path.join(root, "packages/sdk/src/index.ts"))
);
const wallet = await import(
  pathToFileURL(path.join(root, "packages/wallet/src/index.ts"))
);
const { checkKnownPayments } = await import(
  pathToFileURL(path.join(root, "apps/companion/src/bridge.ts"))
);
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = sdk.accountFromJson(fixture.publicAccount),
  bundle = sdk.decodeBundle(sdk.fromHex(fixture.bundleHex));
const payload = {
  bundleHex: fixture.bundleHex,
  rawTx: fixture.rawTx,
  expectedTxid: fixture.txid,
};
const blockHash = (n) => n.toString(16).padStart(64, "0");
function source(mode = "confirmed", tip = 100) {
  const calls = [];
  let tips = 0;
  const rpc = async (method, params) => {
    calls.push([method, params]);
    switch (method) {
      case "getblockchaininfo":
        return { chain: "regtest" };
      case "getblockcount":
        return mode === "tip-change" && ++tips > 1 ? tip + 1 : tip;
      case "getblockhash":
        return params[0] === 0
          ? mode === "wrong-genesis"
            ? "ff".repeat(32)
            : sdk.NETWORKS.regtest.genesisHash
          : mode === "reorg" && params[0] === 95
            ? "bb".repeat(32)
            : blockHash(params[0]);
      case "getrawtransaction":
        assert.deepEqual(params, [fixture.txid, 1]);
        if (mode === "missing") throw Error("not found or txindex absent");
        if (mode === "pending-omitted")
          return { hex: fixture.rawTx, txid: fixture.txid };
        return {
          hex: mode === "wrong-raw" ? fixture.rawTx + "00" : fixture.rawTx,
          txid: mode === "wrong-txid" ? "ee".repeat(32) : fixture.txid,
          confirmations:
            mode === "pending"
              ? 0
              : mode === "five"
                ? 5
                : mode === "bad-conf"
                  ? 101.5
                  : 6,
          ...(mode === "pending"
            ? {}
            : { blockhash: blockHash(mode === "five" ? 96 : 95) }),
        };
      default:
        throw Error("Unexpected method, possible mutation: " + method);
    }
  };
  return { rpc, calls };
}
for (const [mode, expected] of [
  ["confirmed", "confirmed"],
  ["five", "confirmed"],
  ["pending", "pending"],
  ["missing", "unknown"],
  ["wrong-raw", "unknown"],
  ["wrong-txid", "unknown"],
  ["bad-conf", "unknown"],
  ["reorg", "detached"],
]) {
  const s = source(mode);
  const r = await checkKnownPayments(s.rpc, "regtest", {
    payments: [payload],
    checkpoints: [],
  });
  assert.equal(r.transactions[0].state, expected, mode);
  assert(!s.calls.some(([m]) => m === "sendrawtransaction"));
}
for (const mode of ["wrong-genesis", "tip-change"])
  await assert.rejects(
    checkKnownPayments(source(mode).rpc, "regtest", {
      payments: [payload],
      checkpoints: [],
    }),
  );
{
  const s = source();
  await assert.rejects(
    checkKnownPayments(s.rpc, "regtest", {
      payments: [{ ...payload, rawTx: fixture.rawTx + "00" }],
      checkpoints: [],
    }),
  );
  assert.equal(s.calls.length, 0);
  await assert.rejects(
    checkKnownPayments(s.rpc, "regtest", {
      payments: [payload, payload],
      checkpoints: [],
    }),
  );
  assert.equal(s.calls.length, 0);
}
{
  const s = source();
  const result = await checkKnownPayments(s.rpc, "regtest", {
    payments: [],
    checkpoints: [
      { height: 95, hash: blockHash(95) },
      { height: 95, hash: "bb".repeat(32) },
    ],
  });
  assert.deepEqual(
    result.checkpoints.map((c) => c.state),
    ["confirmed", "detached"],
  );
  assert.equal(
    s.calls.filter(([m, p]) => m === "getblockhash" && p[0] === 95).length,
    1,
  );
}
{
  const s = source("confirmed", 4000),
    checkpoints = Array.from({ length: 2000 }, (_, i) => ({
      height: i + 1,
      hash: blockHash(i + 1),
    }));
  const r = await checkKnownPayments(s.rpc, "regtest", {
    payments: [],
    checkpoints,
  });
  assert.equal(r.checkpoints.length, 2000);
  assert.equal(r.rpcCalls, 2008);
  assert(r.checkpoints.every((c) => c.state === "confirmed"));
  await assert.rejects(
    checkKnownPayments(s.rpc, "regtest", {
      payments: [],
      checkpoints: [...checkpoints, { height: 2001, hash: blockHash(2001) }],
    }),
  );
}
console.log(
  "PASS: bridge exact-byte, signature, wrong-network, reorg, pending, unknown, tip-change, grouped checkpoint and2000-checkpoint boundary checks.",
);
const omitted = await checkKnownPayments(
  source("pending-omitted").rpc,
  "regtest",
  { payments: [payload], checkpoints: [] },
);
assert.notEqual(omitted.transactions[0].state, "confirmed");
console.log(
  "Actual Pearl omitted-confirmation pending shape:",
  omitted.transactions[0].state,
);
const j = wallet.emptyJournal();
wallet.reservePayment(j, bundle, "archival-fixture", 1000);
wallet.transitionPayment(j, "archival-fixture", "signing");
wallet.transitionPayment(j, "archival-fixture", "signed", {
  rawTx: fixture.rawTx,
  txid: fixture.txid,
});
wallet.transitionPayment(j, "archival-fixture", "broadcast-unknown");
wallet.transitionPayment(j, "archival-fixture", "accepted");
j.payments[0].archived = {
  status: "confirmed",
  block: { height: 95, hash: blockHash(95) },
  checkedAt: 1,
};
const backup = wallet.exportWalletBackup(account, j);
const sourceText =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export async function auditReconcile() { await run('Archive',reconcileNodePayments); }
export function auditState(){return {busy,notification,journal,account,sourceMode};}
export async function auditOtherTab(){await store.mutate(accountId(account),j=>{j.payments[0].lastError='other tab observed';});}
export async function auditInvalidReceipt(){await store.mutate(accountId(account),j=>{j.payments[0].archived={status:'confirmed',checkedAt:1};});}
`;
const built = await build({
  stdin: {
    contents: sourceText,
    resolveDir: path.join(root, "apps/companion/src"),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "boundaries",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^\.\/(ledger\.js|storage\.js|styles\.css|backup-import\.js)$/,
          },
          (a) => ({ path: a.path, namespace: "audit" }),
        );
        b.onLoad({ filter: /.*/, namespace: "audit" }, (a) => ({
          loader: "js",
          resolveDir: root,
          // Worker transport is modeled in this archival test; the unchanged
          // validator still runs. Dedicated worker tests cover its real entry.
          contents: a.path.includes("backup-import")
            ? 'import { importWalletBackup } from "@pearl-ledger/wallet"; export async function importWalletBackupFile(file, signal) { signal.throwIfAborted(); return importWalletBackup(await file.text()); }'
            : a.path.includes("ledger")
              ? 'export async function connectLedger(){throw Error("No device permitted");}'
              : a.path.includes("storage")
                ? `export class WatchStorage {constructor(){this.rows=new Map();} async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}async mutate(k,fn){const j=await this.journal(k);const r=fn(j);this.rows.set(k,structuredClone(j));return r;}}`
                : "",
        }));
      },
    },
  ],
});
const listeners = new Map(),
  dom = { innerHTML: "" };
globalThis.document = {
  querySelector: () => dom,
  querySelectorAll: () => [],
  getElementById: (id) => ({
    addEventListener: (event, fn) => listeners.set(id + ":" + event, fn),
  }),
};
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = class {
  postMessage() {}
};
const app = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
listeners.get("backup-file:change")({
  target: {
    files: [new Blob([backup])],
  },
});
while (app.auditState().busy) await new Promise((r) => setImmediate(r));
assert.equal(
  app.auditState().journal.payments[0].archived,
  undefined,
  "restored archival claim must be stripped",
);
assert.doesNotMatch(dom.innerHTML, /<button id="reconcile"[^>]*disabled/);
let mode = "confirmed",
  corruptResponse = false,
  interleave = false,
  requests = [];
globalThis.fetch = async (route, options) => {
  assert.equal(route, "/api/reconcile");
  const request = JSON.parse(options.body);
  requests.push(request);
  const response = await checkKnownPayments(
    source(mode).rpc,
    "regtest",
    request,
  );
  if (corruptResponse) response.checkpoints = [];
  if (interleave) await app.auditOtherTab();
  return new Response(JSON.stringify(response));
};
await app.auditReconcile();
assert(app.auditState().journal.payments[0].archived);
assert.equal(requests[0].payments.length, 1);
assert.equal(
  requests[0].checkpoints.length,
  0,
  "backup cannot be accepted as prior inclusion proof",
);
await app.auditReconcile();
assert.equal(requests[1].payments.length, 0);
assert.equal(requests[1].checkpoints.length, 1);
assert(app.auditState().journal.payments[0].archived);
const before = JSON.stringify(app.auditState().journal);
corruptResponse = true;
await app.auditReconcile();
assert.equal(JSON.stringify(app.auditState().journal), before);
assert.match(app.auditState().notification, /Incomplete/);
corruptResponse = false;
mode = "reorg";
await app.auditReconcile();
assert.equal(app.auditState().journal.payments[0].archived, undefined);
assert.equal(wallet.reservedOutpoints(app.auditState().journal).size, 2);
assert.equal(app.auditState().journal.payments[0].rawTx, fixture.rawTx);
mode = "five";
await app.auditReconcile();
assert.equal(app.auditState().journal.payments[0].archived, undefined);
await app.auditInvalidReceipt();
mode = "missing";
await app.auditReconcile();
assert.equal(requests.at(-1).payments.length, 1);
assert.equal(requests.at(-1).checkpoints.length, 0);
assert.equal(app.auditState().journal.payments[0].archived, undefined);
mode = "confirmed";
interleave = true;
await app.auditReconcile();
assert.equal(app.auditState().journal.payments[0].archived, undefined);
assert.equal(
  app.auditState().journal.payments[0].lastError,
  "other tab observed",
);
assert.match(app.auditState().notification, /journal changed/);
interleave = false;
await app.auditReconcile();
assert(app.auditState().journal.payments[0].archived);
assert.equal(wallet.reservedOutpoints(app.auditState().journal).size, 2);
console.log(
  "PASS: actual UI normal control enabled; backup proof stripped/requalified; checkpoint reuse; incomplete-response atomicity; reorg/5conf/missing legacy receipt stay active; concurrent-tab guard; exact bytes and2 input locks retained.",
);
// Boundary-only local journal fixtures: 99 canonical unsigned drafts plus one
// independently verified signed fixture. These synthetic drafts are never sent.
const capped = wallet.importWalletBackup(backup).journal;
function draftAt(index) {
  const d = sdk.decodeBundle(sdk.fromHex(fixture.bundleHex));
  d.inputs.forEach(
    (i, k) => (i.txid = (10000 + index * 2 + k).toString(16).padStart(64, "0")),
  );
  const change = d.outputs.find((o) => o.role === "change");
  change.index = index;
  change.scriptPubKey = sdk.deriveAddress(account, 1, index).scriptPubKey;
  return d;
}
for (let i = 1; i <= 99; i++)
  wallet.reservePayment(capped, draftAt(i), "synthetic-draft-" + i, 1000);
assert.equal(capped.payments.filter((p) => !p.archived).length, 100);
assert.throws(
  () => wallet.reservePayment(capped, draftAt(100), "synthetic-extra-100"),
  /journal is full/,
);
wallet.reconcileConfirmed(
  capped,
  [
    {
      txid: fixture.txid,
      state: "confirmed",
      block: { height: 95, hash: blockHash(95) },
      received: 0n,
      spent: 0n,
    },
  ],
  { height: 100, hash: blockHash(100) },
);
assert.equal(capped.payments.filter((p) => !p.archived).length, 99);
wallet.reservePayment(capped, draftAt(100), "synthetic-extra-100");
assert.equal(wallet.reservedOutpoints(capped).size, 202);
wallet.reconcileConfirmed(capped, [], { height: 100, hash: "aa".repeat(32) });
assert.equal(capped.payments.filter((p) => !p.archived).length, 101);
assert.throws(
  () => wallet.reservePayment(capped, draftAt(101), "synthetic-extra-101"),
  /journal is full/,
);
assert.equal(wallet.reservedOutpoints(capped).size, 202);
console.log(
  "PASS: 100-active cap blocks; qualifying archival frees one active slot without unlocking; reorg restores active count and blocks again with all202 outpoint reservations retained.",
);

// A corrupt/budget-exhausted response cannot update even previously proven receipts.
const guardedBefore = JSON.stringify(app.auditState().journal);
const normalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  const result = await normalFetch(...args);
  const response = await result.json();
  response.rpcCalls = 2109;
  return new Response(JSON.stringify(response));
};
await app.auditReconcile();
assert.equal(JSON.stringify(app.auditState().journal), guardedBefore);
assert.match(app.auditState().notification, /bounded|budget/);
globalThis.fetch = normalFetch;
console.log(
  "PASS: an over-budget reconciliation response leaves exact journal bytes unchanged.",
);

// Model an expired network-phase deadline after bounded local verification.
const normalTimeout = globalThis.setTimeout;
const requestCount = requests.length;
try {
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds === 80000) {
      callback(...args);
      return normalTimeout(() => {}, 0);
    }
    return normalTimeout(callback, milliseconds, ...args);
  };
  await app.auditReconcile();
  assert.equal(requests.length, requestCount);
  assert.equal(JSON.stringify(app.auditState().journal), guardedBefore);
  assert.match(app.auditState().notification, /deadline/);
} finally {
  globalThis.setTimeout = normalTimeout;
}
console.log(
  "PASS: an expired network deadline sends no RPC request and preserves the prior journal.",
);
