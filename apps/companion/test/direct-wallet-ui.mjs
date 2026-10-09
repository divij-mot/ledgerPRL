/** Actual direct-website UI and PSBT adapter, with mocked DOM, clipboard,
 * storage, backend and device endpoint. No browser/hardware/native execution,
 * upload, live RPC, real broadcast, private seed, or MetaMask is involved. */
import assert from "node:assert/strict";
import fs from "node:fs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as sdk from "../../../packages/sdk/src/index.ts";
import * as wallet from "../../../packages/wallet/src/index.ts";
import { verifyBroadcastPayload } from "../src/bridge.ts";
import {
  createPsbtEndpoint,
  P,
  ok,
  publicFixture as f,
} from "./psbt-endpoint.mjs";
Error.stackTraceLimit = 3;
const account = sdk.accountFromJson(f.publicAccount),
  bundle = sdk.bundleFromJson(f.bundle),
  ownerId = wallet.accountId(account);
const source =
  fs.readFileSync(new URL("../src/main.ts", import.meta.url), "utf8") +
  `
export function auditState(){return{busy,notification,account,privacyConsent,verifiedReceive,receiveIndex,sourceMode,activePayment,hasClient:!!client};}
export function auditShow(p){page=p;render();}
export function auditReplaceAccount(a){account=a;network=a.network;verifiedReceive=null;render();}
export async function auditOpenPublicPayment(a,id){account=a;network=a.network;sourceMode='public';privacyConsent=true;activePayment=id;page='send';await refreshJournal();render();}
export function auditAlterBroadcastContext(kind){if(kind==='owner')account={...account,chainCode:new Uint8Array(32).fill(9)};if(kind==='network')network='testnet2';if(kind==='source')sourceMode='node';if(kind==='payment')activePayment='another-payment';}
export async function auditLoadWatch(a,b){snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};page='send';await refreshJournal();render();}
export async function auditSync(){await run('Explicit public discovery',syncPublic);}
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
      name: "direct-ui-mock-boundaries",
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(ledger\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "direct-ui-mock" }),
        );
        b.onLoad({ filter: /.*/, namespace: "direct-ui-mock" }, (a) => ({
          loader: "js",
          contents: a.path.includes("ledger")
            ? `export async function connectLedger(cb,protocol){if(protocol!=='bitcoin-prl')throw Error('Legacy fallback is forbidden');globalThis.directContext.disconnect=cb;return globalThis.directContext.endpoint.transport;}`
            : a.path.includes("storage")
              ? `export class WatchStorage{
    constructor(){this.context=globalThis.directContext;}
    async journal(k){return structuredClone(this.context.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}
    async mutate(k,fn){const j=await this.journal(k);await this.context.hook?.('before-update',j);const result=fn(j);await this.context.hook?.('before-commit',j);this.context.rows.set(k,structuredClone(j));this.context.mutations++;return result;}
    async save(k,v){this.context.cache.set(k,structuredClone(v));this.context.saves++;}
    async load(k){return structuredClone(this.context.cache.get(k));}
    async removeSavedSnapshot(){if(this.context.clearFailure)throw this.context.clearFailure;this.context.cache.delete('last-snapshot');}
  }`
              : "",
        }));
      },
    },
  ],
});
const sourceURL =
  "data:text/javascript;base64," +
  Buffer.from(built.outputFiles[0].text).toString("base64");
let serial = 0;
function gate() {
  let open;
  const promise = new Promise((r) => (open = r));
  return { promise, open };
}
async function settle(app) {
  const deadline = Date.now() + 5000;
  while (app.auditState().busy) {
    assert(Date.now() < deadline, "Mock UI operation did not finish");
    await new Promise((r) => setTimeout(r, 1));
  }
}
async function setup(options = {}) {
  const context = {
    rows: options.rows ?? new Map(),
    cache: new Map(),
    nodes: new Map(),
    coins: [],
    nav: [],
    requests: [],
    clipboard: [],
    saves: 0,
    mutations: 0,
    disconnect: undefined,
    hook: undefined,
  };
  context.endpoint = createPsbtEndpoint(options.deviceOptions);
  const dom = {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value) {
      this._html = value;
      context.nodes.clear();
      for (const [, tag, id] of value.matchAll(
        /<([^>]+)\sid="([^"]+)"[^>]*>/g,
      )) {
        const full =
          value.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))?.[0] ?? "";
        context.nodes.set(id, {
          disabled: /\sdisabled(?:\s|>)/.test(full),
          checked: false,
          addEventListener(type, fn) {
            this[type] = fn;
          },
        });
      }
      context.coins = [...value.matchAll(/data-coin="([^"]+)"/g)].map(
        ([, id]) => ({ dataset: { coin: id }, checked: false }),
      );
      context.nav = [...value.matchAll(/data-nav="([^"]+)"/g)].map(
        ([, nav]) => ({ dataset: { nav } }),
      );
    },
  };
  globalThis.directContext = context;
  globalThis.document = {
    querySelector: () => dom,
    querySelectorAll: (selector) =>
      selector === "[data-coin]"
        ? context.coins
        : selector === "[data-nav]"
          ? context.nav
          : [],
    getElementById: (id) => context.nodes.get(id) ?? null,
  };
  globalThis.window = {
    addEventListener() {},
    get ethereum() {
      throw Error("Direct Ledger flow must not access MetaMask");
    },
  };
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: { writeText: async (value) => context.clipboard.push(value) },
    },
  });
  globalThis.BroadcastChannel = class {
    postMessage() {}
  };
  globalThis.fetch = async (route, options) => {
    context.requests.push({ route, body: options?.body });
    if (route === "/api/check")
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
    if (route === "/api/indexer/broadcast") {
      const body = JSON.parse(options.body);
      assert.deepEqual(body, {
        network: "mainnet",
        consent: true,
        rawTx: f.rawTx,
        expectedTxid: f.txid,
      });
      assert.equal(options.credentials, "omit");
      assert.equal(options.cache, "no-store");
      assert.equal(options.redirect, "error");
      if (
        context.requests.filter((request) => request.route === route).length ===
        1
      )
        throw Error("Modeled public broadcast response lost");
      return new Response(
        JSON.stringify({ txid: sdk.parseTransaction(body.rawTx).txid }),
      );
    }
    if (route === "/api/broadcast") {
      const body = JSON.parse(options.body);
      assert.equal(body.rawTx, f.rawTx);
      assert.equal(body.expectedTxid, f.txid);
      return new Response(
        JSON.stringify({ txid: verifyBroadcastPayload("regtest", body).txid }),
      );
    }
    throw Error("Unexpected source call " + route);
  };
  const app = await import(sourceURL + "#" + serial++);
  const click = async (id) => {
    const element = context.nodes.get(id);
    assert(element, "Missing control " + id);
    assert(!element.disabled, "Control is disabled: " + id);
    element.click();
    await settle(app);
  };
  const change = (id, value) => {
    const element = context.nodes.get(id);
    assert(element, "Missing control " + id);
    if (typeof value === "boolean") element.checked = value;
    else element.value = value;
    element.change({ target: element });
  };
  const input = (id, value) => {
    const element = context.nodes.get(id);
    assert(element, "Missing control " + id);
    element.input({ target: { value } });
  };
  return {
    app,
    context,
    dom,
    click,
    change,
    input,
    saved: () => context.rows.get(ownerId),
  };
}
{
  const t = await setup();
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.saves, 0);
  await t.click("connect");
  assert.deepEqual(t.app.auditState().account, account);
  assert.equal(t.app.auditState().hasClient, true);
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.saves, 0);
  assert.equal(t.context.mutations, 0);
  assert.equal(t.app.auditState().privacyConsent, false);
  assert(t.context.endpoint.commands.includes(P.GET_EXTENDED_PUBKEY));
  await t.app.auditSync();
  assert.equal(t.context.requests.length, 0);
  assert.match(t.app.auditState().notification, /approve address disclosure/);
  t.app.auditShow("receive");
  assert.equal(t.context.nodes.get("copy-address").disabled, true);
  await t.click("verify-receive");
  const address = sdk.deriveAddress(account, 0, 0).address;
  assert.equal(t.app.auditState().verifiedReceive, address);
  assert.equal(t.saved().issuedReceiveThrough, 0);
  assert.equal(t.context.saves, 0);
  assert.equal(t.context.endpoint.merkleRequests(), 6);
  await t.click("copy-address");
  assert.deepEqual(t.context.clipboard, [address]);
  t.change("receive-index", "1");
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(t.context.nodes.get("copy-address").disabled, true);
  await t.click("verify-receive");
  assert.equal(t.saved().issuedReceiveThrough, 1);
  assert.equal(t.context.saves, 0);
  t.app.auditShow("overview");
  assert.equal(t.app.auditState().privacyConsent, false);
  const retained = structuredClone(t.saved());
  await t.click("disconnect");
  assert.equal(t.app.auditState().account, null);
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(t.app.auditState().privacyConsent, false);
  assert.deepEqual(
    t.saved(),
    retained,
    "Disconnect must retain durable receive recovery bounds",
  );
  assert.equal(t.context.requests.length, 0);
  console.log(
    "PASS: direct Ledger connect/receive/copy needs no MetaMask, sends no source data and preserves durable receive bounds on disconnect",
  );
}
for (const mode of ["mismatch", "cancel", "storage-failure"]) {
  const reached = gate(),
    release = gate();
  const t = await setup({
    deviceOptions: {
      onStage: async (stage) => {
        if (stage !== "address") return;
        if (mode === "mismatch")
          return ok(
            new TextEncoder().encode(sdk.deriveAddress(account, 0, 1).address),
          );
        if (mode === "cancel") {
          reached.open();
          await release.promise;
        }
      },
    },
  });
  await t.click("connect");
  t.app.auditShow("receive");
  if (mode === "storage-failure")
    t.context.hook = (phase) => {
      if (phase === "before-commit")
        throw Error("Receive-range storage failed");
    };
  const verifying = t.click("verify-receive");
  if (mode === "cancel") {
    await reached.promise;
    await t.click("cancel-device");
    release.open();
  }
  await verifying;
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(t.context.nodes.get("copy-address").disabled, true);
  assert.equal(
    t.saved()?.issuedReceiveThrough ?? -1,
    mode === "storage-failure" ? -1 : 0,
  );
  if (mode === "storage-failure")
    assert(
      !t.context.endpoint.commands.includes(P.GET_WALLET_ADDRESS),
      "Storage failure must precede any displayed address",
    );
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.clipboard.length, 0);
  console.log(
    `PASS: receive ${mode} never enables address copy; any exposed receive range remains saved`,
  );
}
{
  const t = await setup();
  await t.click("connect");
  await t.app.auditLoadWatch(account, bundle);
  for (const input of bundle.inputs) {
    const coin = t.context.coins.find(
      (c) => c.dataset.coin === wallet.outpoint(input),
    );
    assert(coin);
    coin.checked = true;
    coin.onchange();
  }
  t.input("recipient", f.addresses.recipient);
  t.input("amount", sdk.formatPrl(bundle.outputs[0].amount));
  t.input("fee", "0.00001000");
  t.input("change-index", "0");
  await t.click("prepare");
  assert.equal(t.saved().payments.length, 1);
  assert.equal(t.saved().payments[0].bundleHex, f.bundleHex);
  assert.equal(t.saved().payments[0].state, "draft");
  assert.equal(wallet.reservedOutpoints(t.saved()).size, 2);
  assert.equal(t.context.requests.length, 0);
  await t.click("sign");
  assert.equal(t.saved().payments[0].rawTx, f.rawTx);
  assert.equal(t.saved().payments[0].state, "signed");
  assert.deepEqual(
    t.context.requests.map((r) => r.route),
    ["/api/check"],
  );
  assert.equal(t.context.nodes.get("broadcast").disabled, true);
  assert.equal(
    t.context.saves,
    0,
    "Ordinary signing must not opt into optional snapshot caching",
  );
  const commands = t.context.endpoint.commands.length;
  t.change("broadcast-approval", true);
  await t.click("broadcast");
  assert.equal(t.saved().payments[0].state, "accepted");
  assert.equal(t.saved().payments[0].rawTx, f.rawTx);
  assert.equal(t.context.endpoint.commands.length, commands);
  assert.deepEqual(
    t.context.requests.map((r) => r.route),
    ["/api/check", "/api/broadcast"],
  );
  assert.equal(wallet.reservedOutpoints(t.saved()).size, 2);
  t.app.auditShow("overview");
  const journal = structuredClone(t.saved());
  await t.click("disconnect");
  assert.deepEqual(t.saved(), journal);
  const reopened = await setup({ rows: t.context.rows });
  await reopened.click("connect");
  assert.deepEqual(reopened.saved(), journal);
  assert.equal(reopened.app.auditState().privacyConsent, false);
  assert.equal(reopened.context.requests.length, 0);
  assert.equal(reopened.context.saves, 0);
  console.log(
    "PASS: direct prepare/sign/explicit broadcast handlers preserve exact bytes and reservations through disconnect/reopen without optional account caching",
  );
}
{
  const reached = gate(),
    release = gate();
  const t = await setup({
    deviceOptions: {
      onStage: async (stage) => {
        if (stage === "address") {
          reached.open();
          await release.promise;
        }
      },
    },
  });
  await t.click("connect");
  t.app.auditShow("receive");
  const verifying = t.click("verify-receive");
  await reached.promise;
  const calls = t.context.endpoint.commands.length;
  const repeat = t.context.nodes.get("verify-receive");
  assert.equal(repeat.disabled, true);
  repeat.click();
  assert.equal(t.context.endpoint.commands.length, calls);
  t.context.disconnect();
  release.open();
  await verifying;
  assert.equal(t.app.auditState().hasClient, false);
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(t.saved()?.issuedReceiveThrough ?? -1, 0);
  assert.equal(t.context.nodes.get("copy-address").disabled, true);
  assert.equal(t.context.requests.length, 0);
  console.log(
    "PASS: repeated receive clicks cannot duplicate device work and a late result after disconnect cannot restore verification",
  );
}

for (const mode of [
  "cancel-before-commit",
  "index-before-display",
  "owner-before-display",
  "index-after-display",
  "owner-after-display",
]) {
  const reached = gate(),
    release = gate();
  let t;
  t = await setup({
    deviceOptions: {
      onStage: async (stage) => {
        if (stage !== "address") return;
        assert.equal(
          t.saved().issuedReceiveThrough,
          0,
          "Receive range must be durable before device address result",
        );
        if (mode.endsWith("after-display")) {
          reached.open();
          await release.promise;
        }
      },
    },
  });
  await t.click("connect");
  t.app.auditShow("receive");
  if (!mode.endsWith("after-display"))
    t.context.hook = async (phase) => {
      if (phase === "before-update") {
        reached.open();
        await release.promise;
      }
    };
  const verifying = t.click("verify-receive");
  await reached.promise;
  if (mode === "cancel-before-commit")
    t.context.nodes.get("cancel-device").click();
  else if (mode.startsWith("index"))
    t.change("receive-index", "1"); // A queued stale DOM event, despite disabled current input.
  else
    t.app.auditReplaceAccount({
      ...account,
      chainCode: new Uint8Array(32).fill(3),
    });
  release.open();
  await verifying;
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(t.context.nodes.get("copy-address").disabled, true);
  assert.equal(
    t.saved()?.issuedReceiveThrough ?? -1,
    mode === "cancel-before-commit" ? -1 : 0,
  );
  if (!mode.endsWith("after-display"))
    assert(!t.context.endpoint.commands.includes(P.GET_WALLET_ADDRESS));
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.clipboard.length, 0);
  console.log(
    `PASS: receive ${mode} cannot grant stale verification or lose an already reserved receive index`,
  );
}
{
  const t = await setup();
  await t.click("connect");
  t.app.auditShow("receive");
  t.context.hook = (phase, j) => {
    if (phase === "before-update") j.issuedReceiveThrough = 8;
  };
  await t.click("verify-receive");
  assert.equal(t.saved().issuedReceiveThrough, 8);
  assert.equal(
    t.app.auditState().verifiedReceive,
    sdk.deriveAddress(account, 0, 0).address,
  );
  console.log(
    "PASS: receive verification preserves a higher range learned from another tab's atomic journal",
  );
}
{
  let addressCalls = 0;
  const t = await setup({
    deviceOptions: {
      onStage(stage) {
        if (stage === "address" && ++addressCalls === 2)
          return Uint8Array.of(0x69, 0x85);
      },
    },
  });
  await t.click("connect");
  t.app.auditShow("receive");
  await t.click("verify-receive");
  assert(t.app.auditState().verifiedReceive);
  await t.click("verify-receive");
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(t.context.nodes.get("copy-address").disabled, true);
  assert.equal(t.saved().issuedReceiveThrough, 0);
  assert.equal(t.context.requests.length, 0);
  console.log(
    "PASS: failed repeated receive verification invalidates the previous verified label and copy authority",
  );
}

{
  const publicAccount = { ...account, network: "mainnet" },
    publicBundle = { ...bundle, network: "mainnet" };
  const journal = wallet.emptyJournal(),
    paymentId = "public-retry";
  wallet.reservePayment(journal, publicBundle, paymentId, 1000);
  wallet.transitionPayment(journal, paymentId, "signing");
  wallet.transitionPayment(journal, paymentId, "signed", {
    rawTx: f.rawTx,
    txid: f.txid,
  });
  const publicOwnerId = wallet.accountId(publicAccount),
    t = await setup({ rows: new Map([[publicOwnerId, journal]]) });
  await t.app.auditOpenPublicPayment(publicAccount, paymentId);
  assert.equal(t.context.nodes.get("broadcast").disabled, true);
  assert.equal(t.context.requests.length, 0);
  // Dispatching the handler directly models stale/synthetic events; the handler
  // must check approval itself rather than relying on a disabled DOM control.
  t.context.nodes.get("broadcast").click();
  await settle(t.app);
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.rows.get(publicOwnerId).payments[0].state, "signed");
  t.change("broadcast-approval", true);
  await t.click("broadcast");
  assert.equal(
    t.context.rows.get(publicOwnerId).payments[0].state,
    "broadcast-unknown",
  );
  assert.equal(t.context.rows.get(publicOwnerId).payments[0].rawTx, f.rawTx);
  assert.equal(
    wallet.reservedOutpoints(t.context.rows.get(publicOwnerId)).size,
    2,
  );
  assert.equal(t.context.nodes.get("broadcast").disabled, true);
  t.context.nodes.get("broadcast").click();
  await settle(t.app);
  assert.equal(
    t.context.requests.length,
    1,
    "Uncertain retry needs a fresh approval",
  );
  t.change("broadcast-approval", true);
  await t.click("broadcast");
  assert.equal(t.context.rows.get(publicOwnerId).payments[0].state, "accepted");
  assert.equal(
    wallet.reservedOutpoints(t.context.rows.get(publicOwnerId)).size,
    2,
  );
  assert.equal(t.context.requests.length, 2);
  assert.deepEqual(t.context.requests[1], t.context.requests[0]);
  assert.equal(t.context.endpoint.commands.length, 0);
  assert.equal(t.context.saves, 0);
  console.log(
    "PASS: explicit public broadcast/retry sends only exact signed bytes and txid, never account/xpub/bundle, with ambiguous outcomes locked",
  );
}

for (const mode of ["owner", "network", "source", "payment", "signed-bytes"]) {
  const publicAccount = { ...account, network: "mainnet" },
    publicBundle = { ...bundle, network: "mainnet" };
  const publicOwnerId = wallet.accountId(publicAccount),
    paymentId = "immutable-approval",
    journal = wallet.emptyJournal();
  wallet.reservePayment(journal, publicBundle, paymentId, 1000);
  wallet.transitionPayment(journal, paymentId, "signing");
  wallet.transitionPayment(journal, paymentId, "signed", {
    rawTx: f.rawTx,
    txid: f.txid,
  });
  const t = await setup({ rows: new Map([[publicOwnerId, journal]]) }),
    reached = gate(),
    release = gate();
  await t.app.auditOpenPublicPayment(publicAccount, paymentId);
  t.context.hook = async (phase, j) => {
    if (phase !== "before-update") return;
    reached.open();
    await release.promise;
    if (mode === "signed-bytes") {
      const alternate = JSON.parse(
        fs.readFileSync(
          new URL(
            "./fixtures/signing-recovery-alternate.json",
            import.meta.url,
          ),
          "utf8",
        ),
      );
      j.payments[0].rawTx = alternate.rawTx;
      t.context.rows.set(publicOwnerId, structuredClone(j));
    }
  };
  t.change("broadcast-approval", true);
  const broadcasting = t.click("broadcast");
  await reached.promise;
  t.app.auditAlterBroadcastContext(mode);
  release.open();
  await broadcasting;
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.endpoint.commands.length, 0);
  assert.equal(t.context.rows.get(publicOwnerId).payments[0].state, "signed");
  assert.equal(
    wallet.reservedOutpoints(t.context.rows.get(publicOwnerId)).size,
    2,
  );
  assert.match(t.app.auditState().notification, /changed|review|approve/i);
  console.log(
    `PASS: broadcast approval cannot survive a concurrent ${mode} change or submit bytes outside its approved scope`,
  );
}

// Optional watch-cache deletion is a privacy action, never a payment-journal reset.
for (const fail of [false, true]) {
  const journal = wallet.emptyJournal();
  wallet.reservePayment(journal, bundle, "retained-payment", 1000);
  wallet.transitionPayment(journal, "retained-payment", "signing");
  wallet.transitionPayment(journal, "retained-payment", "signed", {
    rawTx: f.rawTx,
    txid: f.txid,
  });
  const t = await setup({ rows: new Map([[ownerId, journal]]) });
  t.context.cache.set("last-snapshot", "synthetic optional snapshot");
  t.context.cache.set("other-entry", "untouched");
  if (fail) t.context.clearFailure = Error("Modeled snapshot deletion failed");
  await t.app.auditLoadWatch(account, bundle);
  t.app.auditShow("overview");
  const before = structuredClone(t.context.rows);
  await t.click("clear-cache");
  assert.deepEqual(t.context.rows, before);
  assert.equal(t.context.cache.get("other-entry"), "untouched");
  assert.equal(t.context.cache.has("last-snapshot"), fail);
  assert.equal(t.context.requests.length, 0);
  assert.equal(t.context.endpoint.commands.length, 0);
  assert.match(
    t.app.auditState().notification,
    fail ? /failed/ : /recovery records are unchanged/,
  );
  console.log(
    `PASS: optional snapshot clear ${fail ? "failure" : "success"} never touches payment journals or sends a request`,
  );
}
