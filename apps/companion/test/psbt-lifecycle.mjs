/** Actual main.ts, wallet, and PSBT adapter. DOM, storage scheduling, source,
 * Snap provider (where used), and APDU endpoint are mocks. No browser, device,
 * native firmware, upload, real funds, or external network is accessed. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as sdk from "../../../packages/sdk/src/index.ts";
import * as wallet from "../../../packages/wallet/src/index.ts";
import { createPsbtEndpoint, P, publicFixture as f } from "./psbt-endpoint.mjs";

Error.stackTraceLimit = 3;
const account = sdk.accountFromJson(f.publicAccount),
  bundle = sdk.bundleFromJson(f.bundle);
const ownerId = wallet.accountId(account),
  id = "psbt-lifecycle",
  createdAt = 1000;
const source =
  fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8") +
  `
export async function lifecycleMount(a,b,t,options={}) {
  account=a; network=a.network; sourceMode='node'; transport=t;
  client=new LedgerBitcoinPrlClient(t,a.network,options); activePayment='psbt-lifecycle';page='send';
  snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,
    tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},
    coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};
  await refreshJournal();render();
}
export async function lifecycleSign() { await run('Review fixture payment', sign); }
export function lifecycleCancel() { currentAbort?.abort(); }
export function lifecycleState() { return {busy,notification,notificationType,emergency:emergencySignedRecovery,deviceState:client?.sessionState}; }
export async function lifecycleVerifyRestore() { await verifyRestoredEmergencyBackup();render(); }
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
      name: "explicit-lifecycle-mock-boundaries",
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "lifecycle-mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "lifecycle-mock" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? 'export async function connectLedger(){throw Error("No real device permitted")}'
            : a.path.includes("storage")
              ? `export class WatchStorage {
        constructor(){this.context=globalThis.lifecycleContext;}
        async journal(k){const j=structuredClone(this.context.rows.get(k));await this.context.hook?.('read',j);return j;}
        async mutate(k,fn){const j=structuredClone(this.context.rows.get(k));await this.context.hook?.('before-update',j);const value=fn(j);await this.context.hook?.('before-commit',j);this.context.rows.set(k,structuredClone(j));await this.context.hook?.('after-commit',j);return value;}
      }`
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
function tick() {
  return new Promise((r) => setTimeout(r, 0));
}
function backupJournal() {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle, id, createdAt);
  wallet.transitionPayment(j, id, "signing");
  wallet.transitionPayment(j, id, "signed", { rawTx: f.rawTx, txid: f.txid });
  return j;
}
async function mount({ deviceOptions = {}, clientOptions = {} } = {}) {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle, id, createdAt);
  const context = {
    rows: new Map([[ownerId, j]]),
    requests: [],
    notifications: [],
    downloads: [],
    nodes: new Map(),
    handlers: new Map(),
    hook: undefined,
  };
  const dom = {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value) {
      this._html = value;
      context.nodes = new Map(
        [...value.matchAll(/id="([^"]+)"/g)].map(([, id]) => [
          id,
          {
            addEventListener(type, fn) {
              this[type] = fn;
            },
          },
        ]),
      );
    },
  };
  globalThis.lifecycleContext = context;
  globalThis.document = {
    querySelector: () => dom,
    querySelectorAll: () => [],
    getElementById: (id) => context.nodes.get(id) ?? null,
    createElement: () => ({
      click() {
        context.downloads.push({ name: this.download, blob: context.blob });
      },
    }),
  };
  globalThis.window = {
    addEventListener: (name, fn) => context.handlers.set(name, fn),
  };
  globalThis.BroadcastChannel = class {
    postMessage(message) {
      context.notifications.push(message);
    }
  };
  globalThis.URL.createObjectURL = (blob) => {
    context.blob = blob;
    return "blob:mock-lifecycle";
  };
  globalThis.URL.revokeObjectURL = () => {};
  globalThis.fetch = async (route, options) => {
    assert.equal(
      route,
      "/api/check",
      "Signing must never broadcast or call a live service",
    );
    context.requests.push(route);
    assert.deepEqual(
      JSON.parse(options.body).coins.map(wallet.outpoint),
      bundle.inputs.map(wallet.outpoint),
    );
    return new Response(
      JSON.stringify({
        network: account.network,
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
  };
  const endpoint = createPsbtEndpoint(deviceOptions),
    app = await import(url + "#" + serial++);
  await app.lifecycleMount(account, bundle, endpoint.transport, clientOptions);
  return {
    app,
    endpoint,
    context,
    dom,
    saved: () => context.rows.get(ownerId),
  };
}
function assertSigned(j) {
  assert.equal(j.payments[0].state, "signed");
  assert.equal(j.payments[0].rawTx, f.rawTx);
  assert.equal(j.payments[0].txid, f.txid);
  assert.equal(wallet.reservedOutpoints(j).size, 2);
  const restored = wallet.importWalletBackup(
    wallet.exportWalletBackup(account, j),
  );
  assert.equal(restored.journal.payments[0].rawTx, f.rawTx);
}
function assertEmergency(t) {
  const emergency = t.app.lifecycleState().emergency;
  assert(
    emergency,
    "Complete verified bytes must have an emergency recovery copy",
  );
  const restored = wallet.importWalletBackup(emergency.text);
  assertSigned(restored.journal);
  assert.equal(restored.journal.payments[0].id, id);
  assert.equal(restored.journal.payments[0].createdAt, createdAt);
  assert.match(t.dom.innerHTML, /id="download-signed-recovery"/);
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.equal(t.saved().payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(t.saved()).size, 2);
  return emergency;
}
{
  const reached = gate(),
    release = gate();
  let t;
  t = await mount({
    deviceOptions: {
      onStage(stage) {
        if (stage === "ack") assertSigned(t.saved());
      },
    },
  });
  t.context.hook = async (phase, j) => {
    if (phase === "before-commit" && j.payments[0].state === "signed") {
      reached.open();
      await release.promise;
    }
  };
  const signing = t.app.lifecycleSign();
  await reached.promise;
  assert.equal(t.endpoint.yields(), 2);
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.equal(t.saved().payments[0].state, "signing");
  await tick();
  assert.equal(t.endpoint.acknowledgements(), 0);
  release.open();
  await signing;
  assertSigned(t.saved());
  assert.equal(t.endpoint.acknowledgements(), 1);
  assert.equal(t.app.lifecycleState().emergency, null);
  assert.deepEqual(t.context.requests, ["/api/check"]);
  console.log(
    "PASS: full verified signature set is committed before the final ACK and no implicit broadcast occurs",
  );
}
for (const mode of ["cancel", "expiry"]) {
  const reached = gate(),
    release = gate(),
    t = await mount({
      clientOptions: { timeoutMs: mode === "expiry" ? 250 : 5000 },
    });
  t.context.hook = async (phase, j) => {
    if (phase === "before-commit" && j.payments[0].state === "signed") {
      reached.open();
      await release.promise;
    }
  };
  const signing = t.app.lifecycleSign();
  await reached.promise;
  if (mode === "cancel") t.app.lifecycleCancel();
  else await new Promise((r) => setTimeout(r, 275));
  release.open();
  await signing;
  assertSigned(t.saved());
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.equal(t.app.lifecycleState().deviceState, "failed");
  assert.match(
    t.app.lifecycleState().notification,
    /acknowledgement was not confirmed/,
  );
  assert.equal(t.app.lifecycleState().emergency, null);
  assert.deepEqual(t.context.requests, ["/api/check"]);
  console.log(
    `PASS: ${mode} during durable signed storage retains exact bytes and locks without a final ACK`,
  );
}
for (const failure of ["throw", "status", "malformed"]) {
  let t;
  t = await mount({
    deviceOptions: {
      onStage(stage) {
        if (stage !== "ack") return;
        assertSigned(t.saved());
        if (failure === "throw") throw Error("Lost final acknowledgement");
        return failure === "status"
          ? Uint8Array.of(0x69, 0x85)
          : Uint8Array.of(0x90);
      },
    },
  });
  await t.app.lifecycleSign();
  assertSigned(t.saved());
  assert.equal(t.endpoint.acknowledgements(), 1);
  assert.equal(t.app.lifecycleState().deviceState, "failed");
  assert.match(
    t.app.lifecycleState().notification,
    /final device acknowledgement was not confirmed/,
  );
  assert.equal(t.app.lifecycleState().notificationType, "error");
  assert.equal(t.app.lifecycleState().emergency, null);
  const sent = t.endpoint.commands.length;
  await t.app.lifecycleSign();
  assert.equal(t.endpoint.commands.length, sent);
  assertSigned(t.saved());
  console.log(
    `PASS: final-ACK ${failure} keeps signed bytes, marks terminal session and blocks repeat signing`,
  );
}
{
  const t = await mount();
  t.context.hook = (phase, j) => {
    if (phase === "before-commit" && j.payments[0].state === "signed")
      throw Error("Modeled quota/write failure");
  };
  await t.app.lifecycleSign();
  const emergency = assertEmergency(t);
  const commands = t.endpoint.commands.length,
    requests = t.context.requests.length;
  await t.app.lifecycleSign();
  assert.equal(t.endpoint.commands.length, commands);
  assert.equal(t.context.requests.length, requests);
  assert.match(t.app.lifecycleState().notification, /Save and restore/);
  t.context.nodes.get("download-signed-recovery").click();
  assert.equal(t.context.downloads.length, 1);
  const download = t.context.downloads[0];
  assert.equal(download.name, "pearl-signed-payment-backup.json");
  assert.equal(await download.blob.text(), emergency.text);
  assert.equal(
    t.app.lifecycleState().emergency,
    emergency,
    "Download alone cannot clear the recovery requirement",
  );
  let prevented = 0;
  const event = {
    preventDefault() {
      prevented++;
    },
    returnValue: undefined,
  };
  t.context.handlers.get("beforeunload")(event);
  assert.equal(prevented, 1);
  assert.equal(event.returnValue, "");
  console.log(
    "PASS: failed signed storage exposes a verified downloadable emergency backup, blocks signing and warns on unload",
  );
  t.context.hook = undefined;
  const valid = backupJournal();
  for (const mutate of [
    (j) => {
      j.payments[0].id = "wrong-payment";
    },
    (j) => {
      j.payments[0].createdAt++;
    },
    (j) => {
      j.payments[0].outpoints.reverse();
    },
    (j) => {
      j.payments[0].bundleHex = f.bundleHex.slice(0, -2) + "01";
    },
    (j) => {
      j.payments[0].txid = "00".repeat(32);
    },
    (j) => {
      j.payments[0].state = "signing";
    },
    (j) => {
      j.payments[0].rawTx = f.rawTx.slice(0, -20) + "00" + f.rawTx.slice(-18);
    },
  ]) {
    const wrong = structuredClone(valid);
    mutate(wrong);
    t.context.rows.set(ownerId, wrong);
    await t.app.lifecycleVerifyRestore();
    assert.equal(t.app.lifecycleState().emergency, emergency);
  }
  t.context.rows.set(ownerId, structuredClone(valid));
  t.context.hook = (phase) => {
    if (phase === "read") throw Error("Read-back unavailable");
  };
  await t.app.lifecycleVerifyRestore();
  assert.equal(t.app.lifecycleState().emergency, emergency);
  t.context.hook = undefined;
  t.context.rows.set(ownerId, structuredClone(valid));
  await t.app.lifecycleVerifyRestore();
  assert.equal(t.app.lifecycleState().emergency, null);
  assert.doesNotMatch(t.dom.innerHTML, /id="download-signed-recovery"/);
  assertSigned(t.saved());
  console.log(
    "PASS: recovery banner clears only after exact payment identity, reservations and valid signed bytes read back durably",
  );
}
{
  const t = await mount();
  t.context.hook = (phase, j) => {
    if (phase === "after-commit" && j.payments[0].state === "signed")
      throw Error("Commit succeeded; acknowledgement lost");
  };
  await t.app.lifecycleSign();
  assertSigned(t.saved());
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.equal(
    t.app.lifecycleState().emergency,
    null,
    "Verified durable read-back resolves the commit-acknowledgement uncertainty",
  );
  console.log(
    "PASS: a lost storage acknowledgement resolves only through matching verified durable read-back",
  );
}
{
  const t = await mount({ clientOptions: { durabilityTimeoutMs: 15 } });
  t.context.hook = (phase, j) => {
    if (phase === "before-commit" && j.payments[0].state === "signed")
      return new Promise(() => {});
  };
  await t.app.lifecycleSign();
  assertEmergency(t);
  assert.equal(t.app.lifecycleState().deviceState, "failed");
  console.log(
    "PASS: bounded hung-storage failure retains the complete signed transaction in an emergency backup",
  );
}
