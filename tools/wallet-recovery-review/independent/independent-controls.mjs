// CONTROL-FLOW TEST ONLY. Actual main.ts reconciliation orchestration and wallet journal.
// Signature verification is stubbed for up to 2,001 synthetic signed-shaped records.
// This does not establish valid signatures, real RPC, browser, IndexedDB, or hardware.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";
const root = path.resolve(process.env.PRL_ROOT ?? process.cwd());
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const sdk = await import(
  pathToFileURL(path.join(root, "packages/sdk/src/index.ts"))
);
const wallet = await import(
  pathToFileURL(path.join(root, "packages/wallet/src/index.ts"))
);
const fixture = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = sdk.accountFromJson(fixture.publicAccount);
globalThis.controlFinalize = (bundle, signatures) => {
  const unsigned = sdk.serializeUnsignedTransaction(bundle),
    bytes = sdk.concat(
      unsigned.slice(0, 4),
      Uint8Array.of(0, 1),
      unsigned.slice(4, -4),
      ...signatures.map((s) => sdk.concat(Uint8Array.of(1, 64), s)),
      unsigned.slice(-4),
    );
  return { rawTx: sdk.hex(bytes), txid: sdk.parseTransaction(bytes).txid };
};
const journal = wallet.emptyJournal();
for (let i = 0; i < 2001; i++) {
  const bundle = sdk.decodeBundle(sdk.fromHex(fixture.bundleHex));
  bundle.inputs.forEach(
    (v, k) => (v.txid = (5000 + i * 2 + k).toString(16).padStart(64, "0")),
  );
  const tx = globalThis.controlFinalize(
    bundle,
    fixture.signatures.map(sdk.fromHex),
  );
  journal.payments.push({
    id: "synthetic-known-" + i,
    state: "accepted",
    createdAt: 1000,
    bundleHex: sdk.hex(sdk.encodeBundle(bundle)),
    outpoints: bundle.inputs.map(wallet.outpoint),
    rawTx: tx.rawTx,
    txid: tx.txid,
  });
}
journal.nextChangeIndex = 1;
const mainSource = fs.readFileSync(
  path.join(root, "apps/companion/src/main.ts"),
  "utf8",
);
console.log(
  "SOURCE main.ts SHA-256: " +
    createHash("sha256").update(mainSource).digest("hex"),
);
const source =
  mainSource +
  `
export async function auditInstall(a,j){account=a;network=a.network;sourceMode='node';await store.mutate(accountId(a),next=>Object.assign(next,structuredClone(j)));await refreshJournal();}
export {reconcileNodePayments as auditDirect};
export async function auditSaved(){return store.journal(accountId(account));}
`;
const built = await build({
  stdin: {
    contents: source,
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
      name: "explicit-control-stubs",
      setup(b) {
        b.onResolve({ filter: /^@pearl-ledger\/sdk$/ }, () => ({
          path: "sdk-control",
          namespace: "control",
        }));
        b.onResolve(
          { filter: /^\.\/(ledger\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "control" }),
        );
        b.onLoad({ filter: /.*/, namespace: "control" }, (a) => ({
          loader: "js",
          resolveDir: path.join(root, "apps/companion/src"),
          contents:
            a.path === "sdk-control"
              ? `export * from ${JSON.stringify(path.join(root, "packages/sdk/src/index.ts"))}; export function finalizeTransaction(bundle,signatures){return globalThis.controlFinalize(bundle,signatures);}`
              : a.path.includes("ledger")
                ? 'export async function connectLedger(){throw Error("No device allowed");}'
                : a.path.includes("storage")
                  ? `export class WatchStorage {constructor(){this.rows=new Map();}async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}async mutate(k,fn){const j=await this.journal(k);await globalThis.reviewCommitGate?.();const r=fn(j);this.rows.set(k,structuredClone(j));return r;}}`
                  : "",
        }));
      },
    },
  ],
});
globalThis.document = {
  querySelector: () => ({ innerHTML: "" }),
  querySelectorAll: () => [],
  getElementById: () => null,
};
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = class {
  postMessage() {}
};
const app = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
const blockHash = (n) => n.toString(16).padStart(64, "0");
const response = (request, tip = 1000) =>
  new Response(
    JSON.stringify({
      network: "regtest",
      genesisHash: sdk.NETWORKS.regtest.genesisHash,
      tip: { height: tip, hash: blockHash(tip) },
      checkedAt: Date.now(),
      rpcCalls: 8 + 2 * request.payments.length,
      transactions: request.payments.map((p) => ({
        txid: p.expectedTxid,
        state: "confirmed",
        block: { height: tip - 5, hash: blockHash(tip - 5) },
        confirmations: 6,
      })),
      checkpoints: [],
    }),
  );

// Independent count/budget controls. Real ownership checks and journal mutation;
// signatures/DOM/storage/RPC transport are modeled, not a browser qualification.
const { getEventListeners } = await import("node:events");
const cases = [
  { n: 0, budget: 80000, batches: 1 },
  { n: 1, budget: 80000, batches: 1 },
  { n: 100, budget: 80000, batches: 1 },
  { n: 101, budget: 160000, batches: 2 },
  { n: 2000, budget: 1600000, batches: 20 },
  { n: 2000, archived: true, budget: 80000, batches: 1 },
  { n: 2001, budget: undefined, batches: 0, error: /journal limit exceeded/ },
];
for (const c of cases) {
  const seed = structuredClone(journal);
  seed.payments = seed.payments.slice(0, c.n);
  if (c.archived)
    for (const p of seed.payments)
      p.archived = {
        status: "confirmed",
        block: { height: 995, hash: blockHash(995) },
        checkedAt: 1000,
      };
  await app.auditInstall(account, seed);
  const original = JSON.stringify(seed.payments);
  const realTimeout = globalThis.setTimeout,
    realClear = globalThis.clearTimeout;
  const timeouts = [],
    pending = new Set(),
    timeoutSignals = [];
  const realSignalTimeout = AbortSignal.timeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms >= 80000) {
      const handle = { fn, ms, args };
      timeouts.push(handle);
      pending.add(handle);
      return handle;
    }
    return realTimeout(fn, ms, ...args);
  };
  globalThis.clearTimeout = (handle) => {
    if (!pending.delete(handle)) realClear(handle);
  };
  AbortSignal.timeout = (ms) => {
    timeoutSignals.push(ms);
    return new AbortController().signal;
  };
  const requests = [];
  const control = new AbortController();
  globalThis.fetch = async (route, options) => {
    assert.equal(route, "/api/reconcile");
    assert.equal(options.signal.aborted, false);
    const req = JSON.parse(options.body);
    requests.push(req);
    const resp = await response(req).json();
    resp.checkpoints = req.checkpoints.map((p) => ({
      ...p,
      state: "confirmed",
      confirmations: 1000 - p.height + 1,
    }));
    return new Response(JSON.stringify(resp));
  };
  try {
    if (c.error) await assert.rejects(app.auditDirect(control.signal), c.error);
    else await app.auditDirect(control.signal);
    assert.equal(requests.length, c.batches);
    const networkBudgets = [
      ...timeouts.map((t) => t.ms),
      ...timeoutSignals.filter((ms) => ms !== 90000),
    ];
    assert.deepEqual(networkBudgets, c.budget ? [c.budget] : []);
    assert(requests.every((req) => req.payments.length <= 100));
    assert(requests.slice(1).every((req) => req.checkpoints.length === 0));
    assert.equal(getEventListeners(control.signal, "abort").length, 0);
    assert.equal(pending.size, 0, "owned long-lived timers must be cleared");
    const saved = await app.auditSaved();
    if (c.error) assert.equal(JSON.stringify(saved.payments), original);
    else {
      assert.equal(saved.payments.filter((p) => p.archived).length, c.n);
      const stripped = structuredClone(saved);
      for (const p of stripped.payments) delete p.archived;
      const expected = structuredClone(seed);
      for (const p of expected.payments) delete p.archived;
      assert.deepEqual(stripped, expected);
    }
    console.log(
      `PASS independent count ${c.n} archived=${Boolean(c.archived)}: ${c.batches} batches, ${c.budget ?? 0}ms budget, cleanup`,
    );
  } finally {
    globalThis.setTimeout = realTimeout;
    globalThis.clearTimeout = realClear;
    AbortSignal.timeout = realSignalTimeout;
  }
}

for (const mode of [
  "preabort",
  "fetch-error",
  "cancel-fetch",
  "deadline-fetch",
  "cancel-queued-commit",
  "deadline-queued-commit",
  "storage-error",
]) {
  const seed = structuredClone(journal);
  seed.payments = seed.payments.slice(0, 1);
  await app.auditInstall(account, seed);
  const expected = JSON.stringify(await app.auditSaved());
  const control = new AbortController();
  const realTimeout = globalThis.setTimeout,
    realClear = globalThis.clearTimeout;
  const pending = new Set();
  let networkTimeout;
  globalThis.setTimeout = (fn, ms, ...args) => {
    if (ms >= 80000) {
      const handle = { fn, ms, args };
      networkTimeout = handle;
      pending.add(handle);
      return handle;
    }
    return realTimeout(fn, ms, ...args);
  };
  globalThis.clearTimeout = (handle) => {
    if (!pending.delete(handle)) realClear(handle);
  };
  let requests = 0;
  globalThis.fetch = async (route, options) => {
    requests++;
    if (mode === "fetch-error") throw Error("forced fetch error");
    if (mode === "cancel-fetch")
      control.abort(new Error("forced fetch cancel"));
    if (mode === "deadline-fetch") networkTimeout.fn();
    options.signal.throwIfAborted();
    return response(JSON.parse(options.body));
  };
  if (mode === "preabort") control.abort(new Error("forced preabort"));
  if (mode === "cancel-queued-commit" || mode === "deadline-queued-commit")
    globalThis.reviewCommitGate = async () => {
      if (mode === "cancel-queued-commit")
        control.abort(new Error("forced queued cancel"));
      else networkTimeout.fn();
    };
  // A storage fault after network success must also dispose the network scope.
  if (mode === "storage-error")
    globalThis.reviewCommitGate = async () => {
      throw Error("forced storage fault");
    };
  try {
    await assert.rejects(app.auditDirect(control.signal), /forced|deadline/i);
    assert.equal(JSON.stringify(await app.auditSaved()), expected);
    assert.equal(requests, mode === "preabort" ? 0 : 1);
    assert.equal(pending.size, 0);
    assert.equal(getEventListeners(control.signal, "abort").length, 0);
    console.log(
      "PASS independent teardown " +
        mode +
        ": unchanged exact journal; no owned timer or abort listener",
    );
  } finally {
    delete globalThis.reviewCommitGate;
    globalThis.setTimeout = realTimeout;
    globalThis.clearTimeout = realClear;
  }
}

console.log(
  "SUMMARY: all 14 independent controls passed (7 count/budget + 7 teardown).",
);
