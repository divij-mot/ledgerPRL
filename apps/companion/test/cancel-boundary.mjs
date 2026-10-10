/**
 * Actual main.ts and SDK with deterministic, public fixture bytes. DOM, storage
 * scheduling, connection/APDU endpoint, and read-only backend are mocks.
 * No browser upload, hardware, private key, live network, or broadcast is used.
 */
import fs from "node:fs";
import { createPsbtEndpoint, P } from "./psbt-endpoint.mjs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const bundle = sdk.decodeBundle(sdk.fromHex(fixture.bundleHex));
const source =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export { connect };
export function cancel() { currentAbort?.abort(); }
export function oldTransport(t) {transport=t;}
export function state() { return { busy, account, notification }; }
export async function prepareAudit(a,b) {
 account=a; network=a.network;
 snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};
 await store.mutate(accountId(a),j=>reservePayment(j,b,'cancel-audit',1000));
 activePayment='cancel-audit'; await refreshJournal();
}
export async function startSign() { await run('Checking inputs', sign); }
export async function saved() { return store.journal(accountId(account)); }
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
      name: "cancel-test-boundaries",
      setup(build) {
        build.onResolve(
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "test-boundary" }),
        );
        build.onLoad({ filter: /.*/, namespace: "test-boundary" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? `export async function connectLedger() { globalThis.connectCalls++; return globalThis.connectGate; }`
            : a.path.includes("storage")
              ? `export class WatchStorage {
        constructor() { this.rows = new Map(); }
        async journal(k) {
          const j = structuredClone(this.rows.get(k) ?? {schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});
          await globalThis.pauseBoundary?.('journal', j); return j;
        }
        async mutate(k, update) {
          const j = await this.journal(k);
          await globalThis.pauseBoundary?.('before-update', j);
          const value = update(j);
          await globalThis.pauseBoundary?.('before-commit', j);
          this.rows.set(k, structuredClone(j));
          await globalThis.pauseBoundary?.('after-commit', j); return value;
        }
      }`
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
const moduleURL =
  "data:text/javascript;base64," +
  Buffer.from(built.outputFiles[0].text).toString("base64");
let serial = 0;
function gate() {
  let release, reject;
  const pending = new Promise((resolve, fail) => {
    release = resolve;
    reject = fail;
  });
  return { pending, release, reject };
}
function device() {
  return createPsbtEndpoint();
}
let backendCalls = 0;
async function backend(route) {
  backendCalls++;
  assert.equal(route, "/api/check", "No broadcast or external route allowed");
  return new Response(
    JSON.stringify({
      network: "regtest",
      genesisHash: sdk.NETWORKS.regtest.genesisHash,
      tip: { height: 200, hash: "aa".repeat(32) },
      checkedAt: Date.now(),
      coins: bundle.inputs.map((i) => ({
        outpoint: wallet.outpoint(i),
        state: "unspent",
        grains: i.amount.toString(),
        scriptPubKey: sdk.hex(i.scriptPubKey),
        coinbase: false,
        block: { height: 1, hash: "bb".repeat(32) },
        confirmations: 200,
      })),
    }),
  );
}
async function fresh() {
  globalThis.window.location = undefined;
  globalThis.connectCalls = 0;
  globalThis.pauseBoundary = undefined;
  globalThis.fetch = backend;
  const app = await import(`${moduleURL}#${serial++}`);
  const d = device();
  globalThis.connectGate = Promise.resolve(d.transport);
  return { app, d };
}
async function prepared() {
  const context = await fresh();
  await context.app.connect();
  await context.app.prepareAudit(account, bundle);
  context.d.commands.length = 0;
  backendCalls = 0;
  return context;
}
function pauseAt(phase, state) {
  const reached = gate(),
    wait = gate();
  let active = true;
  globalThis.pauseBoundary = async (current, journal) => {
    if (active && current === phase && journal.payments[0]?.state === state) {
      active = false;
      reached.release();
      await wait.pending;
    }
  };
  return { reached: reached.pending, release: wait.release };
}
{
  const { app, d } = await fresh(),
    connecting = gate();
  globalThis.connectGate = connecting.pending;
  const operation = app.connect();
  assert.equal(app.state().busy, true);
  app.cancel();
  connecting.release(d.transport);
  await operation;
  assert.deepEqual(d.commands, []);
  assert.equal(d.closes(), 1);
  assert.equal(app.state().account, null);
  assert.match(app.state().notification, /abort|cancel/i);
  console.log(
    "PASS: canceled pending connection closes its late transport without exporting an account",
  );
}
{
  const { app } = await fresh(),
    closing = gate();
  app.oldTransport({ close: () => closing.pending });
  const unhandled = [];
  const observe = (error) => unhandled.push(error);
  process.on("unhandledRejection", observe);
  globalThis.connectGate = Promise.reject(new Error("Picker rejected"));
  const operation = app.connect();
  await new Promise(setImmediate);
  closing.release();
  await operation;
  process.removeListener("unhandledRejection", observe);
  assert.deepEqual(unhandled, []);
  assert.match(app.state().notification, /Picker rejected/);
  console.log(
    "PASS: early picker rejection is owned while previous session cleanup waits",
  );
}
{
  const { app, d } = await fresh(),
    connecting = gate();
  app.oldTransport({
    close: async () => {
      throw new Error("Old cleanup failed");
    },
  });
  globalThis.connectGate = connecting.pending;
  const operation = app.connect();
  await new Promise(setImmediate);
  assert.equal(app.state().busy, true);
  connecting.release(d.transport);
  await operation;
  assert.equal(d.closes(), 1);
  assert.deepEqual(d.commands, []);
  assert.match(app.state().notification, /Old cleanup failed/);
  console.log(
    "PASS: failed prior cleanup closes a late picker result without using it",
  );
}
for (const cancel of [false, true]) {
  const { app, d } = await fresh(),
    closing = gate();
  globalThis.window.location = { pathname: "/live.html" };
  app.oldTransport({ close: () => closing.pending });
  const operation = app.connect();
  assert.equal(globalThis.connectCalls, 0);
  if (cancel) app.cancel();
  closing.release();
  await operation;
  assert.equal(globalThis.connectCalls, cancel ? 0 : 1);
  assert.equal(app.state().account === null, cancel);
  if (cancel) assert.deepEqual(d.commands, []);
  console.log(
    `PASS: Ledger Wallet reconnect ${cancel ? "cancellation prevents" : "waits for prior cleanup before"} new host transport`,
  );
}

for (const [phase, state, expected] of [
  ["journal", "draft", "draft"],
  ["before-update", "draft", "draft"],
  ["after-commit", "signing", "signing"],
  ["journal", "signing", "signing"],
]) {
  const { app, d } = await prepared(),
    boundary = pauseAt(phase, state);
  const operation = app.startSign();
  await boundary.reached;
  app.cancel();
  boundary.release();
  await operation;
  const journal = await app.saved();
  assert.deepEqual(d.commands, []);
  assert.equal(journal.payments[0].state, expected);
  assert.equal(journal.payments[0].rawTx, undefined);
  assert.equal(wallet.reservedOutpoints(journal).size, 2);
  if (phase === "journal" && state === "draft") assert.equal(backendCalls, 0);
  console.log(
    `PASS: cancellation at ${phase}/${state} sends no signing commands and preserves ${expected} reservations`,
  );
}
{
  const { app, d } = await prepared(),
    reached = gate(),
    wait = gate();
  globalThis.fetch = async (route) => {
    reached.release();
    await wait.pending;
    return backend(route);
  };
  const operation = app.startSign();
  await reached.pending;
  app.cancel();
  wait.release();
  await operation;
  assert.deepEqual(d.commands, []);
  assert.equal((await app.saved()).payments[0].state, "draft");
  console.log(
    "PASS: cancellation during a backend read cannot transition the draft or invoke signing",
  );
}
{
  const { app, d } = await prepared(),
    boundary = pauseAt("before-commit", "signed");
  const operation = app.startSign();
  await boundary.reached;
  assert.equal(d.yields(), 2);
  const commandCount = d.commands.length;
  app.cancel();
  boundary.release();
  await operation;
  const journal = await app.saved(),
    restored = wallet.importWalletBackup(
      wallet.exportWalletBackup(account, journal),
    ).journal;
  assert.equal(restored.payments[0].state, "signed");
  assert.equal(restored.payments[0].rawTx, fixture.rawTx);
  assert.equal(wallet.reservedOutpoints(restored).size, 2);
  assert.equal(d.commands.length, commandCount);
  assert.equal(backendCalls, 1);
  console.log(
    "PASS: cancellation after verified signatures retains exact signed bytes and locks without broadcasting",
  );
}
