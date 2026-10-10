/**
 * Test-only disconnect/journal regression harness.
 * Uses actual SDK, adapter, DMK state machine and main.ts; all endpoint, HID,
 * DOM, storage-scheduling and network inputs are deterministic local mocks.
 * Never import this file from the production companion. See README.md.
 */
import fs from "node:fs";
import { createPsbtEndpoint, P } from "./psbt-endpoint.mjs";
import { LedgerBitcoinPrlClient } from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const {
  DeviceConnectionStateMachine,
} = require("@ledgerhq/device-management-kit");
const { Right } = require("purify-ts");
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
const bundle = () => sdk.bundleFromJson(fixture.bundle);
const adapterBuild = await build({
  entryPoints: [path.join(root, "apps/companion/src/ledger.ts")],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  external: ["@ledgerhq/device-management-kit", "rxjs"],
  logLevel: "silent",
});
const mod = { exports: {} };
new Function("require", "module", "exports", adapterBuild.outputFiles[0].text)(
  require,
  mod,
  mod.exports,
);
const { DmkPearlTransport } = mod.exports;
const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
function device({ delaySignature = false, exportedAccount = account } = {}) {
  let release,
    signatureResolve,
    signatureCount = 0;
  const events = new EventTarget();
  const endpoint = createPsbtEndpoint({
    account: exportedAccount,
    onStage: async (stage) => {
      if (stage !== "signature") return;
      signatureCount++;
      if (delaySignature)
        await new Promise((r) => {
          release = r;
          signatureResolve?.();
        });
    },
  });
  const sent = endpoint.commands;
  const sender = {
    async sendApdu(apdu) {
      const response = await endpoint.transport.exchange(apdu);
      return Right({
        data: response.slice(0, -2),
        statusCode: response.slice(-2),
      });
    },
    async setupConnection() {},
    closeConnection() {},
    getDependencies() {
      return {};
    },
    setDependencies() {},
  };
  const connection = new DeviceConnectionStateMachine({
    deviceId: "public-fixture",
    deviceApduSender: sender,
    timeoutDuration: 5000,
    tryToReconnect() {},
    onTerminated() {},
  });
  const dmk = {
    async sendCommand({ command }) {
      const result = await connection.sendApdu(command.getApdu().getRawApdu());
      return result.caseOf({
        Left: (e) => {
          throw e;
        },
        Right: (r) => command.parseResponse(r),
      });
    },
    async disconnect() {
      connection.closeConnection();
    },
    close() {
      connection.closeConnection();
    },
  };
  const adapter = new DmkPearlTransport(
    dmk,
    "public-fixture",
    events,
    undefined,
    "bitcoin-prl",
  );
  const client = new LedgerBitcoinPrlClient(adapter, "regtest", {
    timeoutMs: 500,
  });
  return {
    sent,
    endpoint,
    events,
    connection,
    adapter,
    client,
    release: () => release?.(),
    waitForSignature: () =>
      signatureCount
        ? Promise.resolve()
        : new Promise((r) => (signatureResolve = r)),
  };
}
function reserve() {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle(), "audit-payment", 1000);
  wallet.transitionPayment(j, "audit-payment", "signing");
  return j;
}
// A completed signature remains usable as exact signed bytes after physical disconnect.
{
  const d = device(),
    j = reserve(),
    tx = await d.client.signBundle(bundle(), account);
  wallet.transitionPayment(j, "audit-payment", "signed", {
    rawTx: tx.rawTx,
    txid: tx.txid,
  });
  d.events.dispatchEvent(new Event("disconnect"));
  d.connection.eventDeviceConnected();
  await assert.rejects(
    d.adapter.exchange(Uint8Array.of(P.cla, P.GET_NETWORK_INFO, 0, 1, 0)),
    /closed/,
  );
  const restored = wallet.importWalletBackup(
    wallet.exportWalletBackup(account, j),
  ).journal;
  assert.equal(restored.payments[0].state, "signed");
  assert.equal(restored.payments[0].rawTx, fixture.rawTx);
  assert.equal(wallet.reservedOutpoints(restored).size, 2);
  const parsed = sdk.parseTransaction(restored.payments[0].rawTx);
  assert.equal(
    sdk.finalizeTransaction(
      bundle(),
      parsed.inputs.map((i) => i.witness[0]),
    ).txid,
    fixture.txid,
  );
  console.log(
    "PASS: disconnect after signed persistence retains exact independently verified bytes and both reservations; no automatic broadcast",
  );
  await d.adapter.close();
}
// An interrupted signature remains uncertain through backup; reconnect cannot send or release it.
{
  const d = device({ delaySignature: true }),
    j = reserve();
  const signing = d.client.signBundle(bundle(), account).then(
    () => {
      throw Error("unexpected signing success");
    },
    (e) => e,
  );
  await d.waitForSignature();
  d.events.dispatchEvent(new Event("disconnect"));
  d.connection.eventDeviceConnected();
  await signing;
  const count = d.sent.length;
  d.release();
  await tick();
  assert.equal(d.sent.length, count);
  assert.equal(d.client.sessionState, "failed");
  await assert.rejects(d.client.capabilities(), /failed/);
  assert.equal(d.sent.length, count);
  const restored = wallet.importWalletBackup(
    wallet.exportWalletBackup(account, j),
  ).journal;
  assert.equal(restored.payments[0].state, "signing");
  assert.equal(restored.payments[0].rawTx, undefined);
  assert.equal(wallet.reservedOutpoints(restored).size, 2);
  assert.throws(() => wallet.discardDraft(restored, "audit-payment"));
  const b = { ...account, chainCode: new Uint8Array(32).fill(0x43) },
    next = device({ exportedAccount: b });
  assert.deepEqual(await next.client.exportAccount(0), b);
  assert.equal(d.sent.length, count);
  console.log(
    "PASS: pending signature disconnect stays uncertain/reserved across recovery; late old response and new account connection cannot resume old command",
  );
  await next.adapter.close();
  await d.adapter.close();
}
// Disconnect after one partial signature must stop before fetching another.
{
  const d = device(),
    j = reserve();
  await assert.rejects(
    d.client.signBundle(bundle(), account, {
      onProgress(phase, complete) {
        if (phase === "signatures" && complete === 1)
          d.events.dispatchEvent(new Event("disconnect"));
      },
    }),
  );
  assert.equal(d.endpoint.yields(), 1);
  assert.equal(j.payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(j).size, 2);
  console.log(
    "PASS: disconnect between signature yields prevents the second signature continuation and leaves payment uncertain",
  );
  await d.adapter.close();
}

// Actual main.ts at a simulated storage-commit boundary.
const { verifyBroadcastPayload } = await import(
  pathToFileURL(path.join(root, "apps/companion/src/bridge.ts"))
);
const source =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export {connect};
// Explicit test-only approval; the actual checkbox handler is tested separately.
export async function approveAndBroadcast(){const p=getPayment();const approval=Object.freeze({ownerId:accountId(account),paymentId:p.id,network,source:sourceMode,rawTx:p.rawTx,txid:p.txid});await broadcast(undefined,approval);}
export async function signForTest() { await run('Checking inputs', sign); }
export async function auditPrepare(a,b){account=a;network=a.network;snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};validation=null;await store.mutate(accountId(a),j=>reservePayment(j,b,'audit-payment',1000));activePayment='audit-payment';await refreshJournal();}
export async function auditJournal(){return store.journal(accountId(account));}
export function auditStatus(){return {hasClient:client!==null,activePayment,sourceMode};}
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
      name: "isolated-state-stubs",
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "audit" }),
        );
        b.onLoad({ filter: /.*/, namespace: "audit" }, (a) => ({
          contents: a.path.includes("device")
            ? `export async function connectLedger(cb){globalThis.auditDisconnectCallback=cb;return globalThis.auditTransport;}`
            : a.path.includes("storage")
              ? `export class WatchStorage{constructor(){this.rows=new Map();}async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}async mutate(k,fn){const j=await this.journal(k);const result=fn(j);if(globalThis.auditDelaySigned&&j.payments.some(p=>p.state==='signed')){globalThis.auditDelaySigned=false;globalThis.auditSignedCommitReached();await globalThis.auditSignedCommitGate;}this.rows.set(k,structuredClone(j));return result;}}`
              : "",
          loader: "js",
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
const d = device();
globalThis.auditTransport = d.adapter;
const calls = [];
globalThis.fetch = async (route, options) => {
  calls.push(route);
  const body = JSON.parse(options.body);
  if (route === "/api/check")
    return new Response(
      JSON.stringify({
        network: "regtest",
        genesisHash: sdk.NETWORKS.regtest.genesisHash,
        tip: { height: 200, hash: "aa".repeat(32) },
        checkedAt: Date.now(),
        coins: bundle().inputs.map((i) => ({
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
  if (route === "/api/broadcast") {
    const result = verifyBroadcastPayload("regtest", body);
    return new Response(JSON.stringify({ txid: result.txid }));
  }
  throw Error("Unexpected external request: " + route);
};
await app.connect();
await app.auditPrepare(account, bundle());
let reached, release;
globalThis.auditSignedCommitGate = new Promise((r) => (release = r));
const committed = new Promise((r) => (reached = r));
globalThis.auditSignedCommitReached = reached;
globalThis.auditDelaySigned = true;
const signing = app.signForTest();
await committed;
assert.equal((await app.auditJournal()).payments[0].state, "signing");
d.events.dispatchEvent(new Event("disconnect"));
globalThis.auditDisconnectCallback();
release();
await signing;
const signed = await app.auditJournal();
assert.equal(signed.payments[0].state, "signed");
assert.equal(signed.payments[0].rawTx, fixture.rawTx);
assert.equal(wallet.reservedOutpoints(signed).size, 2);
assert.deepEqual(calls, ["/api/check"]);
assert.equal(app.auditStatus().hasClient, false);
const restored = wallet.importWalletBackup(
  wallet.exportWalletBackup(account, signed),
);
assert.equal(restored.journal.payments[0].state, "signed");
console.log(
  "PASS: real main.ts disconnect between signature return and simulated signed-storage commit keeps signed bytes/reservations and never automatically broadcasts",
);
const commands = d.sent.length;
await app.approveAndBroadcast();
assert.deepEqual(calls, ["/api/check", "/api/broadcast"]);
assert.equal(d.sent.length, commands);
assert.equal((await app.auditJournal()).payments[0].state, "accepted");
console.log(
  "PASS: only explicit broadcast call submits exact verified bytes to isolated fake backend after disconnect; no device command or real network transaction",
);
