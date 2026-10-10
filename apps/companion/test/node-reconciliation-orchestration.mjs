// CONTROL-FLOW TEST ONLY. Actual main.ts reconciliation orchestration and wallet journal.
// Signature verification is explicitly stubbed for101 synthetic signed-shaped records.
// It is not evidence of101 valid signatures, real RPC, browser, IndexedDB, or hardware.
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
for (let i = 0; i < 101; i++) {
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
const original = JSON.stringify(journal.payments);
const source =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export async function auditInstall(a,j){account=a;network=a.network;sourceMode='node';await store.mutate(accountId(a),next=>Object.assign(next,structuredClone(j)));await refreshJournal();}
export async function auditReconcile(){await run('Batch review',async signal=>{
 const add=signal.addEventListener.bind(signal), remove=signal.removeEventListener.bind(signal);
 globalThis.auditForwardedListeners=0;
 signal.addEventListener=(type,...args)=>{if(type==='abort')globalThis.auditForwardedListeners++;return add(type,...args);};
 signal.removeEventListener=(type,...args)=>{if(type==='abort')globalThis.auditForwardedListeners--;return remove(type,...args);};
 try {await reconcileNodePayments(signal);}finally{signal.addEventListener=add;signal.removeEventListener=remove;}
});}
export function auditCancel(){currentAbort?.abort();}
export function auditState(){return {busy,notification,journal};}
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
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "control" }),
        );
        b.onLoad({ filter: /.*/, namespace: "control" }, (a) => ({
          loader: "js",
          resolveDir: path.join(root, "apps/companion/src"),
          contents:
            a.path === "sdk-control"
              ? `export * from ${JSON.stringify(path.join(root, "packages/sdk/src/index.ts"))}; export function finalizeTransaction(bundle,signatures){return globalThis.controlFinalize(bundle,signatures);}`
              : a.path.includes("device")
                ? 'export async function connectLedger(){throw Error("No device allowed");}'
                : a.path.includes("storage")
                  ? `export class WatchStorage {constructor(){this.rows=new Map();}async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}async mutate(k,fn){const j=await this.journal(k),r=fn(j);this.rows.set(k,structuredClone(j));return r;}}`
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
for (const mode of [
  "success",
  "slow-local-success",
  "slow-two-batch-success",
  "clock-budget-second",
  "cancel-local",
  "cancel-second",
  "deadline-second",
  "tip-change-second",
]) {
  await app.auditInstall(account, journal);
  const requests = [],
    timers = [];
  const originalTimeout = AbortSignal.timeout;
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const networkTimers = [];
  const originalNow = Object.getOwnPropertyDescriptor(performance, "now");
  let clock = 0;
  Object.defineProperty(performance, "now", {
    configurable: true,
    value: () => clock,
  });
  // Fake elapsed time, not weakened production validation. Yielding remains real.
  globalThis.setTimeout = (callback, ms, ...args) => {
    if (ms >= 80_000 && ms <= 1_600_000 && ms % 80_000 === 0) {
      const handle = {};
      networkTimers.push({
        ms,
        handle,
        createdAt: clock,
        cleared: false,
        callback: () => callback(...args),
      });
      return handle;
    }
    return originalSetTimeout(() => {
      if (ms === 0 && mode === "slow-local-success") clock += 100_000;
      if (ms === 0 && mode === "cancel-local") app.auditCancel();
      callback(...args);
    }, ms);
  };
  globalThis.clearTimeout = (handle) => {
    const timer = networkTimers.find((t) => t.handle === handle);
    if (timer) timer.cleared = true;
    else originalClearTimeout(handle);
  };
  AbortSignal.timeout = (ms) => {
    const c = new AbortController();
    timers.push({ ms, c });
    return c.signal;
  };
  let arrived;
  const second = new Promise((r) => (arrived = r));
  globalThis.fetch = async (route, options) => {
    assert.equal(route, "/api/reconcile");
    const request = JSON.parse(options.body);
    requests.push(request);
    if (mode === "slow-two-batch-success") clock += 79_000;
    if (mode === "clock-budget-second") clock += 80_000;
    if (
      requests.length === 2 &&
      (mode === "cancel-second" || mode === "deadline-second")
    ) {
      return await new Promise((resolve, reject) => {
        options.signal.addEventListener(
          "abort",
          () => reject(options.signal.reason),
          { once: true },
        );
        arrived();
      });
    }
    return response(
      request,
      mode === "tip-change-second" && requests.length === 2 ? 1001 : 1000,
    );
  };
  try {
    const running = app.auditReconcile();
    if (mode === "cancel-second" || mode === "deadline-second") {
      await second;
      if (mode === "cancel-second") app.auditCancel();
      else {
        assert.equal(networkTimers.filter((t) => t.ms === 160000).length, 1);
        assert.equal(timers.filter((t) => t.ms === 90000).length, 2);
        networkTimers.find((t) => t.ms === 160000).callback();
      }
    }
    await running;
    assert.deepEqual(
      requests.map((r) => r.payments.length),
      mode === "cancel-local" ? [] : [100, 1],
    );
    assert.equal(
      networkTimers.filter((t) => t.ms === 160000).length,
      mode === "cancel-local" ? 0 : 1,
      "Exactly one count-bounded network deadline starts after local validation",
    );
    assert.equal(timers.filter((t) => t.ms === 90000).length, requests.length);
    assert(
      networkTimers.every((t) => t.cleared),
      "Network scope must clear its timer on every terminal outcome",
    );
    assert.equal(
      globalThis.auditForwardedListeners,
      0,
      "Forwarded user-abort listener must be removed on every terminal outcome",
    );
    if (mode === "slow-local-success")
      assert(networkTimers[0].createdAt > 80_000);

    if (
      ["success", "slow-local-success", "slow-two-batch-success"].includes(mode)
    ) {
      assert.equal(
        app.auditState().journal.payments.filter((p) => p.archived).length,
        101,
      );
      assert.equal(
        wallet.reservedOutpoints(app.auditState().journal).size,
        202,
      );
    } else {
      assert.equal(JSON.stringify(app.auditState().journal.payments), original);
      assert.equal(
        app.auditState().journal.payments.filter((p) => p.archived).length,
        0,
      );
      assert.equal(
        wallet.reservedOutpoints(app.auditState().journal).size,
        202,
      );
    }
    console.log(
      "PASS control-flow:",
      mode,
      "Bounded batches, cancellable local validation, all-or-none archive and202 locks retained.",
    );
  } finally {
    AbortSignal.timeout = originalTimeout;
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
    if (originalNow) Object.defineProperty(performance, "now", originalNow);
    else delete performance.now;
  }
}
console.log(
  "BOUNDARY: signature verification stubbed for synthetic many-record control flow. Genuine-signature bridge/UI tests are in node-reconciliation.test.ts and node-reconciliation-ui.mjs.",
);
