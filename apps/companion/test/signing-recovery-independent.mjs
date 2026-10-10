// Independent actual-main.ts/SDK recovery probe. Public frozen signatures only.
// DOM, atomic storage scheduler, APDU endpoint and source responses are mocks.
// No browser, physical device, seed import, broadcast or live endpoint is used.
import fs from "node:fs";
import { createPsbtEndpoint, P } from "./psbt-endpoint.mjs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
Error.stackTraceLimit = 3;
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url))),
  require = createRequire(path.join(root, "package.json")),
  { build } = require("esbuild");
const sdk = await import(
    pathToFileURL(path.join(root, "packages/sdk/src/index.ts"))
  ),
  wallet = await import(
    pathToFileURL(path.join(root, "packages/wallet/src/index.ts"))
  );
const f = JSON.parse(
    fs.readFileSync(path.join(root, "fixtures/protocol-v1.json"), "utf8"),
  ),
  alt = JSON.parse(
    fs.readFileSync(
      new URL("./fixtures/signing-recovery-alternate.json", import.meta.url),
      "utf8",
    ),
  );
const account = sdk.accountFromJson(f.publicAccount),
  bundle = sdk.bundleFromJson(f.bundle),
  id = "uncertain-recovery-fixture";
const source =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export async function auditInit(a,b,endpoint) {account=a;network=a.network;sourceMode='node';snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};client=new LedgerBitcoinPrlClient(endpoint,network);activePayment='uncertain-recovery-fixture';await refreshJournal();page='send';render();}
export async function auditStart(recover=true){await run(recover?'Recover':'Sign',signal=>sign(signal,recover));}
export function auditCancel(){currentAbort?.abort();}
export function auditState(){return{busy,notification,journal};}
`;
const compiled = await build({
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
      name: "boundaries",
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "probe" }),
        );
        b.onLoad({ filter: /.*/, namespace: "probe" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? 'export async function connectLedger(){throw Error("No real device allowed")}'
            : a.path.includes("storage")
              ? `export class WatchStorage{constructor(){this.tab=globalThis.nextTab;}async mutate(k,fn){const previous=globalThis.storeTail;let done;globalThis.storeTail=new Promise(r=>done=r);await previous;try{const j=structuredClone(globalThis.storeRows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0});const result=fn(j);globalThis.storeRows.set(k,structuredClone(j));return result}finally{done()}}async journal(k){const j=await this.mutate(k,v=>structuredClone(v));await globalThis.afterRead?.(this.tab,j);return j}}`
              : "",
        }));
      },
    },
  ],
});
let serial = 0;
const sourceURL =
  "data:text/javascript;base64," +
  Buffer.from(compiled.outputFiles[0].text).toString("base64");
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = class {
  postMessage() {}
};
function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}
function endpoint({
  rejectReview = false,
  pauseReview = false,
  alternate = false,
  wrongAccount = false,
  afterExport,
} = {}) {
  const review = gate(),
    entered = gate();
  const endpoint = createPsbtEndpoint({
    account: wrongAccount
      ? { ...account, chainCode: new Uint8Array(32).fill(3) }
      : account,
    signatures: (alternate ? alt : f).signatures,
    onStage: async (stage) => {
      if (stage === "export") afterExport?.();
      if (stage === "review") {
        entered.open();
        if (pauseReview) await review.promise;
        if (rejectReview) return Uint8Array.of(0x69, 0x85);
      }
    },
  });
  return { ...endpoint.transport, sent: endpoint.commands, review, entered };
}
function seed(state = "signing") {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle, id, 1000);
  if (state === "signing") wallet.transitionPayment(j, id, "signing");
  return j;
}
function reset(state = "signing") {
  globalThis.storeRows = new Map([[wallet.accountId(account), seed(state)]]);
  globalThis.storeTail = Promise.resolve();
  delete globalThis.afterRead;
  globalThis.fetch = async (route, options) => {
    assert.equal(route, "/api/check", "No broadcast or new route in recovery");
    const request = JSON.parse(options.body);
    return new Response(
      JSON.stringify({
        network: "regtest",
        genesisHash: sdk.NETWORKS.regtest.genesisHash,
        tip: { height: 200, hash: "aa".repeat(32) },
        checkedAt: Date.now(),
        coins: request.coins.map((c) => {
          const i = bundle.inputs.find(
            (i) => i.txid === c.txid && i.vout === c.vout,
          );
          assert(i);
          return {
            outpoint: wallet.outpoint(i),
            state: "unspent",
            grains: i.amount.toString(),
            scriptPubKey: sdk.hex(i.scriptPubKey),
            block: { height: 1, hash: "bb".repeat(32) },
            coinbase: false,
            confirmations: 200,
          };
        }),
      }),
    );
  };
}
async function tab(name, device) {
  const dom = { innerHTML: "" };
  globalThis.nextTab = name;
  globalThis.document = {
    querySelector: () => dom,
    querySelectorAll: () => [],
    getElementById: () => null,
  };
  const app = await import(sourceURL + "#" + ++serial);
  await app.auditInit(account, bundle, device);
  return { ...app, dom };
}
function saved() {
  return structuredClone(globalThis.storeRows.get(wallet.accountId(account)));
}
function unchanged(j, { signed = false } = {}) {
  assert.equal(j.payments.length, 1);
  assert.equal(j.payments[0].id, id);
  assert.equal(j.payments[0].bundleHex, f.bundleHex);
  assert.equal(wallet.reservedOutpoints(j).size, 2);
  assert.equal(j.nextChangeIndex, 1);
  if (!signed) {
    assert.equal(j.payments[0].state, "signing");
    assert.equal(j.payments[0].rawTx, undefined);
    assert.equal(j.payments[0].txid, undefined);
  }
}
{
  reset();
  const d = endpoint({ alternate: true }),
    app = await tab("success", d);
  assert.match(app.dom.innerHTML, /id="recover-signing"/);
  await app.auditStart();
  const j = saved();
  unchanged(j, { signed: true });
  assert.equal(j.payments[0].state, "signed");
  assert.equal(j.payments[0].rawTx, alt.rawTx);
  assert.equal(j.payments[0].txid, f.txid);
  assert.equal(d.sent.filter((x) => x === P.GET_EXTENDED_PUBKEY).length, 1);
  assert.equal(d.sent.filter((x) => x === P.SIGN_PSBT).length, 1);
  console.log(
    "PASS approved: same record, bundle, txid, change and locks; new account approval and full review; alternate valid witnesses saved",
  );
}
{
  reset();
  const d = endpoint({ rejectReview: true }),
    app = await tab("rejection", d);
  await app.auditStart();
  const j = saved();
  unchanged(j);
  assert.doesNotMatch(app.dom.innerHTML, /id="discard"/);
  assert.doesNotMatch(
    app.auditState().notification,
    /discard it|unsigned draft/,
  );
  const restored = wallet.importWalletBackup(
    wallet.exportWalletBackup(account, j),
  );
  assert.equal(restored.journal.payments[0].lastError, j.payments[0].lastError);
  unchanged(restored.journal);
  console.log(
    "PASS rejected: previous ambiguity remains signing and locked, including through backup restore",
  );
}
{
  reset();
  const d = endpoint({ pauseReview: true }),
    app = await tab("cancel", d);
  const run = app.auditStart();
  await d.entered.promise;
  app.auditCancel();
  d.review.open();
  await run;
  unchanged(saved());
  console.log(
    "PASS cancelled: current approval cancellation never releases an older ambiguous payment",
  );
}
for (const status of ["spent-or-unknown", "reorged", "timeout"]) {
  reset();
  globalThis.fetch = async () => {
    if (status === "timeout") throw Error("Backend timeout; outcome unknown");
    return new Response(
      JSON.stringify({
        network: "regtest",
        genesisHash: sdk.NETWORKS.regtest.genesisHash,
        tip: { height: 200, hash: "aa".repeat(32) },
        checkedAt: Date.now(),
        coins: bundle.inputs.map((i) => ({
          outpoint: wallet.outpoint(i),
          state: status,
        })),
      }),
    );
  };
  const d = endpoint(),
    app = await tab(status, d);
  await app.auditStart();
  unchanged(saved());
  assert(!d.sent.includes(P.SIGN_PSBT));
  console.log(
    "PASS unavailable: " +
      status +
      " blocks re-signing without assuming payment absence",
  );
}
{
  reset();
  const d = endpoint({ wrongAccount: true }),
    app = await tab("wrong-account", d);
  await app.auditStart();
  unchanged(saved());
  assert(!d.sent.includes(P.SIGN_PSBT));
  console.log(
    "PASS identity: a newly exported different account cannot recover the saved payment",
  );
}
{
  reset();
  const d = endpoint({ pauseReview: true, alternate: true }),
    app = await tab("other-completed", d);
  const run = app.auditStart();
  await d.entered.promise;
  await globalThis.storeTail;
  const j = saved();
  wallet.transitionPayment(j, id, "signed", { rawTx: f.rawTx, txid: f.txid });
  globalThis.storeRows.set(wallet.accountId(account), j);
  d.review.open();
  await run;
  const after = saved();
  unchanged(after, { signed: true });
  assert.equal(after.payments[0].rawTx, f.rawTx);
  assert.equal(after.payments[0].txid, f.txid);
  console.log(
    "PASS first completion: another tab’s already verified bytes survive later different valid witnesses",
  );
}
{
  reset("draft");
  const originalDevice = endpoint({ pauseReview: true, rejectReview: true }),
    original = await tab("old-initial", originalDevice);
  const oldRun = original.auditStart(false);
  await originalDevice.entered.promise;
  const recoveryDevice = endpoint({ pauseReview: true }),
    recovery = await tab("new-recovery", recoveryDevice);
  const newRun = recovery.auditStart(true);
  await recoveryDevice.entered.promise;
  originalDevice.review.open();
  await oldRun;
  unchanged(saved());
  assert.doesNotMatch(
    original.auditState().notification,
    /discard it|unsigned draft/,
  );
  recoveryDevice.review.open();
  await newRun;
  unchanged(saved(), { signed: true });
  assert.equal(saved().payments[0].state, "signed");
  console.log(
    "PASS interleaving: old SIGN_PSBT rejection cannot undo a durably started recovery",
  );
}
{
  reset("draft");
  const originalDevice = endpoint({ pauseReview: true, rejectReview: true }),
    original = await tab("first-rejects", originalDevice);
  const oldRun = original.auditStart(false);
  await originalDevice.entered.promise;
  const recoveryDevice = endpoint(),
    recovery = await tab("stale-recovery", recoveryDevice),
    captured = gate(),
    release = gate();
  let used = false;
  globalThis.afterRead = async (name, j) => {
    if (
      name === "stale-recovery" &&
      !used &&
      j.payments[0].state === "signing"
    ) {
      used = true;
      captured.open();
      await release.promise;
    }
  };
  const newRun = recovery.auditStart(true);
  await captured.promise;
  originalDevice.review.open();
  await oldRun;
  assert.equal(saved().payments[0].state, "signing");
  release.open();
  await newRun;
  delete globalThis.afterRead;
  assert.equal(saved().payments[0].state, "signed");
  assert.equal(saved().payments[0].rawTx, f.rawTx);
  assert.equal(wallet.reservedOutpoints(saved()).size, 2);
  assert.equal(
    recoveryDevice.sent.filter((ins) => ins === P.SIGN_PSBT).length,
    1,
  );
  console.log(
    "PASS opposite ordering: generic initial rejection retains locks until fresh explicit identical-payment recovery verifies every signature",
  );
}
{
  reset();
  const firstDevice = endpoint({ pauseReview: true }),
    first = await tab("recovery-one", firstDevice),
    one = first.auditStart();
  await firstDevice.entered.promise;
  const secondDevice = endpoint({ pauseReview: true, alternate: true }),
    second = await tab("recovery-two", secondDevice),
    two = second.auditStart();
  await secondDevice.entered.promise;
  firstDevice.review.open();
  await one;
  const firstStored = saved().payments[0].rawTx;
  secondDevice.review.open();
  await two;
  const j = saved();
  unchanged(j, { signed: true });
  assert.equal(j.payments[0].state, "signed");
  if (firstStored) assert.equal(j.payments[0].rawTx, firstStored);
  assert([f.rawTx, alt.rawTx].includes(j.payments[0].rawTx));
  console.log(
    "PASS concurrent recovery: first stored verified witness set stays immutable, with one payment and both locks",
  );
}
{
  reset("draft");
  const d = endpoint({ pauseReview: true, rejectReview: true }),
    app = await tab("import-revokes", d),
    run = app.auditStart(false);
  await d.entered.promise;
  const current = saved();
  assert(current.payments[0].signingAttempt);
  const backup = wallet.exportWalletBackup(account, current);
  const exported = JSON.parse(backup);
  assert.equal(exported.journal.payments[0].signingAttempt, undefined);
  const incoming = wallet.importWalletBackup(backup);
  assert.equal(incoming.journal.payments[0].signingAttempt, undefined);
  wallet.mergeRestoredJournal(current, incoming.journal);
  assert.equal(current.payments[0].signingAttempt, undefined);
  globalThis.storeRows.set(wallet.accountId(account), current);
  d.review.open();
  await run;
  unchanged(saved());
  console.log(
    "PASS import revocation: backup strips active ownership and equal-state merge prevents an old initial rejection from releasing ambiguity",
  );
}

for (const mode of ["success", "spent", "error", "still-stale", "clock-back"]) {
  reset();
  const realNow = Date.now,
    baseFetch = globalThis.fetch;
  let checks = 0;
  globalThis.fetch = async (route, options) => {
    checks++;
    assert(
      checks <= 2,
      "recovery may perform at most one conditional freshness recheck",
    );
    if (checks === 2 && mode === "error")
      throw Error("Second source check unavailable; outcome unknown");
    const response = await baseFetch(route, options);
    if (checks !== 2 || !["spent", "still-stale"].includes(mode))
      return response;
    const value = await response.json();
    if (mode === "spent")
      value.coins = value.coins.map((c) => ({
        outpoint: c.outpoint,
        state: "spent-or-unknown",
      }));
    else value.checkedAt = realNow();
    return new Response(JSON.stringify(value));
  };
  try {
    const d = endpoint({
        afterExport: () => {
          Date.now = () => realNow() + (mode === "clock-back" ? -1000 : 61001);
        },
      }),
      app = await tab("freshness-" + mode, d);
    await app.auditStart();
    assert.equal(checks, 2, "aged evidence needs exactly one new source check");
    if (mode === "success" || mode === "clock-back") {
      unchanged(saved(), { signed: true });
      assert.equal(saved().payments[0].state, "signed");
      assert.equal(saved().payments[0].rawTx, f.rawTx);
      assert(d.sent.includes(P.SIGN_PSBT));
    } else {
      unchanged(saved());
      assert(!d.sent.includes(P.SIGN_PSBT));
    }
    console.log(
      "PASS bounded freshness: " +
        mode +
        " requires a fresh second source check and never accepts stale evidence or retries indefinitely",
    );
  } finally {
    Date.now = realNow;
  }
}
{
  reset();
  const realNow = Date.now,
    baseFetch = globalThis.fetch;
  let checks = 0;
  globalThis.fetch = async (route, options) => {
    checks++;
    const response = await baseFetch(route, options);
    assert.deepEqual(
      JSON.parse(options.body).coins.map(wallet.outpoint),
      bundle.inputs.map(wallet.outpoint),
    );
    if (checks === 2) {
      const j = saved();
      wallet.transitionPayment(j, id, "signed", {
        rawTx: f.rawTx,
        txid: f.txid,
      });
      globalThis.storeRows.set(wallet.accountId(account), j);
    }
    return response;
  };
  try {
    const d = endpoint({
        afterExport: () => {
          Date.now = () => realNow() + 61001;
        },
      }),
      app = await tab("second-check-race", d);
    await app.auditStart();
    assert.equal(checks, 2);
    assert(!d.sent.includes(P.SIGN_PSBT));
    unchanged(saved(), { signed: true });
    assert.equal(saved().payments[0].rawTx, f.rawTx);
    console.log(
      "PASS refresh interleaving: another tab finishing during second source check blocks new signing and retains its exact bytes",
    );
  } finally {
    Date.now = realNow;
  }
}
{
  reset();
  const realNow = Date.now,
    baseFetch = globalThis.fetch,
    entered = gate(),
    release = gate(),
    signals = [];
  let checks = 0;
  globalThis.fetch = async (route, options) => {
    checks++;
    signals.push(options.signal);
    const response = await baseFetch(route, options);
    assert.deepEqual(
      JSON.parse(options.body).coins.map(wallet.outpoint),
      bundle.inputs.map(wallet.outpoint),
    );
    if (checks === 2) {
      entered.open();
      await release.promise;
    }
    return response;
  };
  try {
    const d = endpoint({
        afterExport: () => {
          Date.now = () => realNow() + 61001;
        },
      }),
      app = await tab("second-check-cancel", d),
      run = app.auditStart();
    await entered.promise;
    app.auditCancel();
    assert(
      signals.every((s) => s.aborted),
      "both checks must share cancellation from the original run",
    );
    release.open();
    await run;
    assert.equal(checks, 2);
    assert(!d.sent.includes(P.SIGN_PSBT));
    unchanged(saved());
    console.log(
      "PASS refresh cancellation: original run cancels both request signals, and even a late response cannot start signing",
    );
  } finally {
    Date.now = realNow;
  }
}
