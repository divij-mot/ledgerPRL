/** Actual main.ts and wallet discovery/validation. DOM, storage and source
 * scheduling are modeled; total-budget timers use controlled aborts. No network. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { emptyJournal } from "../../../packages/wallet/src/index.ts";
import { publicAccount } from "../../../packages/wallet/test/fixtures.ts";
Error.stackTraceLimit = 3;
const account = { ...publicAccount, network: "mainnet" };
const source =
  fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8") +
  `
export async function mountPublic(a){account=a;network=a.network;sourceMode='public';privacyConsent=true;snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:100,hash:'cc'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:[]};await refreshJournal();}
export async function startPublic(kind){await run(kind,kind==='discover'?syncPublic:checkNode);}
export function cancelPublic(){currentAbort?.abort();}
export function statePublic(){return{snapshot,validation,syncComplete,notification,busy};}
`;
const built = await build({
  stdin: {
    contents: source,
    resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "public-scheduling-model",
      setup(b) {
        b.onResolve(
          {
            filter:
              /^\.\/(ledger|storage|styles|public-source|blockbook-source)\.(?:js|css)$/,
          },
          (a) => ({ path: a.path, namespace: "public-model" }),
        );
        b.onLoad({ filter: /.*/, namespace: "public-model" }, (a) => ({
          loader: "js",
          resolveDir: fileURLToPath(new URL("../src", import.meta.url)),
          contents: a.path.includes("ledger")
            ? 'export async function connectLedger(){throw Error("No device permitted")}'
            : a.path.includes("storage")
              ? `export class WatchStorage{constructor(){this.context=globalThis.publicLifecycle;}async journal(){return structuredClone(this.context.journal);}async mutate(k,fn){await this.context.beforeUpdate?.();const j=structuredClone(this.context.journal);const result=fn(j);this.context.journal=structuredClone(j);this.context.commits++;return result;}}`
              : a.path.includes("public-source")
                ? `import {NETWORKS} from '@pearl-ledger/sdk';export function browserPublicSource(network,consent,signal){const c=globalThis.publicLifecycle;c.signal=signal;return{network,async tip(){await c.beforeSource?.();return{genesisHash:NETWORKS[network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)}};},async blockHash(){return 'aa'.repeat(32)},async address(){return{used:false,confirmedTxCount:0,pendingTxCount:0,txids:[],utxos:[]}},async transaction(){throw Error('No transactions in empty fixture')}}}`
                : a.path.includes("blockbook-source")
                  ? `export async function checkLightSnapshot(source,snapshot){await globalThis.publicLifecycle.beforeSource?.();return{network:snapshot.account.network,genesisHash:snapshot.genesisHash,tip:{height:200,hash:'aa'.repeat(32)},checkedAt:Date.now(),coins:[]}}`
                  : "",
        }));
      },
    },
  ],
});
const url =
  "data:text/javascript;base64," +
  Buffer.from(built.outputFiles[0].text).toString("base64");
let serial = 0;
function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}
async function mount() {
  const context = {
    journal: emptyJournal(),
    commits: 0,
    beforeSource: undefined,
    beforeUpdate: undefined,
    signal: undefined,
  };
  globalThis.publicLifecycle = context;
  globalThis.document = {
    querySelector: () => ({ innerHTML: "" }),
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  globalThis.window = { addEventListener() {} };
  globalThis.BroadcastChannel = class {
    postMessage() {}
  };
  globalThis.fetch = () => {
    throw Error("No network permitted by lifecycle model");
  };
  const app = await import(url + "#" + serial++);
  await app.mountPublic(account);
  return { app, context, prior: app.statePublic().snapshot };
}
function unchanged(t) {
  assert.equal(t.app.statePublic().snapshot, t.prior);
  assert.equal(t.app.statePublic().validation, null);
  assert.equal(t.app.statePublic().syncComplete, false);
  assert.equal(t.context.commits, 0);
  assert.deepEqual(t.context.journal, emptyJournal());
}
for (const kind of ["discover", "check"]) {
  const t = await mount(),
    originalTimeout = AbortSignal.timeout,
    budgets = [],
    controllers = [];
  AbortSignal.timeout = (ms) => {
    if (ms === 300_000 || ms === 90_000) {
      budgets.push(ms);
      const c = new AbortController();
      controllers.push(c);
      return c.signal;
    }
    return originalTimeout(ms);
  };
  const reached = gate(),
    release = gate();
  let paused = false;
  t.context.beforeSource = async () => {
    if (!paused) {
      paused = true;
      reached.open();
      await release.promise;
    }
  };
  try {
    const operation = t.app.startPublic(kind);
    await reached.promise;
    assert.deepEqual(budgets, [kind === "discover" ? 300_000 : 90_000]);
    controllers[0].abort(
      new DOMException("Modeled total operation deadline", "TimeoutError"),
    );
    assert.equal(t.context.signal.aborted, true);
    release.open();
    await operation;
    unchanged(t);
    assert.match(t.app.statePublic().notification, /deadline/);
    console.log(
      `PASS: ${kind} applies its explicit total budget and ignores a late successful source result after expiry`,
    );
  } finally {
    AbortSignal.timeout = originalTimeout;
    release.open();
  }
}
{
  const t = await mount(),
    reached = gate(),
    release = gate();
  t.context.beforeUpdate = async () => {
    reached.open();
    await release.promise;
  };
  const operation = t.app.startPublic("discover");
  await reached.promise;
  t.app.cancelPublic();
  release.open();
  await operation;
  unchanged(t);
  assert.equal(t.context.signal.aborted, true);
  console.log(
    "PASS: cancellation while completed discovery waits for atomic storage prevents every journal and balance update",
  );
}
{
  const t = await mount(),
    reached = gate(),
    release = gate();
  t.context.beforeSource = async () => {
    reached.open();
    await release.promise;
  };
  const operation = t.app.startPublic("check");
  await reached.promise;
  t.app.cancelPublic();
  release.open();
  await operation;
  unchanged(t);
  assert.equal(t.context.signal.aborted, true);
  console.log(
    "PASS: cancellation during input checking cannot apply a late unspent result or claim fresh validation",
  );
}
