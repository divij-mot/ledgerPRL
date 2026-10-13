/** Pure-host review of the actual companion main.ts. No browser, native code,
 * device, private key, external HTTP, upload, deployment or actual broadcast.
 * Test-only appendages expose state; production source is never rewritten.
 * Fixed-boundary tests assert rejection and retention. Optional model-only probes
 * do not establish real-browser reachability or exploitability. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as sdk from "../../packages/sdk/src/index.ts";
import * as wallet from "../../packages/wallet/src/index.ts";
import {
  createPsbtEndpoint,
  P,
  publicFixture as f,
} from "../../apps/companion/test/psbt-endpoint.mjs";

import {
  rawTransaction,
  blockHash,
} from "../../packages/wallet/test/fixtures.js";
import { LOCAL_SOURCE_COMMIT } from "../../apps/companion/src/local-source.js";

Error.stackTraceLimit = 4;
const fixtureAccount = sdk.accountFromJson(f.publicAccount);
const fixtureBundle = sdk.bundleFromJson(f.bundle);
const resolveDir = fileURLToPath(
  new URL("../../apps/companion/src/", import.meta.url),
);
const source =
  readFileSync(resolveDir + "main.ts", "utf8") +
  `
const testContext = globalThis.operationReview;
export async function auditOwnLocal(a){await localSession.start(a,[-1,-1],async()=>({}));}
export function auditSync(){startLocalSync();}
export function auditFlow(flow){if(flow==="busy")busy=true;else page=flow;}
export function auditState(){return {page,sendStep,snapshot,syncComplete,syncActive:!!localSyncAbort,receiveIndex,lastUsed,account,network,sourceMode,privacyConsent,activePayment,busy,notification,client,transport,emergency:emergencySignedRecovery,journal,verifiedReceive,form:{...form}};}
export async function auditMount(a,b,id,options={}){
  account=a;network=a.network;sourceMode=options.source??'node';privacyConsent=options.consent??true;activePayment=id;page=options.page??'send';
  snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};
  selected.clear();for(const i of b.inputs)selected.add(outpoint(i));
  Object.assign(form,{recipient:scriptToAddress(b.outputs[0].scriptPubKey,b.network),amount:formatPrl(b.outputs[0].amount),fee:'0.00001000',changeIndex:'0'});
  await refreshJournal();render();
}
export function auditAlter(kind){if(kind==='owner')account={...account,chainCode:new Uint8Array(32).fill(9)};if(kind==='network')network='testnet2';if(kind==='source')sourceMode=sourceMode==='node'?'public':'node';if(kind==='payment')activePayment='another-payment';if(kind==='consent')privacyConsent=false;}
export function auditRender(){render();}
export function auditNavigate(next){return navigate(next);}
export function auditCleanup(owner,id){return discardUnsignedReviews(owner,id);}
export async function auditReloadJournal(){await refreshJournal();render();}
export function auditAbort(){currentAbort?.abort();}
export function auditPrepareView(){activePayment=null;page='send';sendStep=1;feeSelection='custom';form.fee='0.00001000';manualSelection=true;render();}
export function auditEmpty(net){account=null;network=net;activePayment=null;snapshot=null;page='overview';render();}
export async function auditVerifyEmergency(){await verifyRestoredEmergencyBackup();render();}
export async function auditSign(){await run('Review fixture payment',sign);}
export function auditActualDevice(t,options={}){transport=t;client=new LedgerBitcoinPrlClient(t,network,options);}
export function auditFixtureDevice(signatures){
  client={sessionState:'ready',async signBundle(b,a,options){
    const result=finalizeTransaction(b,signatures);
    const pending=options.onVerifiedSigned(result);
    let timer;
    try{await Promise.race([pending,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Modeled late persistence')),15);})]);return result;}
    catch(error){throw new VerifiedSigningResultError(result,error);}
    finally{clearTimeout(timer);}
  }};
}
`;
const built = await build({
  stdin: { contents: source, resolveDir, loader: "ts" },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "operation-review-explicit-mocks",
      setup(b) {
        b.onResolve({ filter: /^\.\/(device\.js|storage\.js)$/ }, (a) => ({
          path: a.path,
          namespace: "review-mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "review-mock" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? `export async function connectLedger(cb){const c=globalThis.operationReview;c.disconnects.push(cb);return c.endpoint.transport;}`
            : `
export class WatchStorage{
  constructor(){this.c=globalThis.operationReview;}
  async journal(k){await this.c.hook?.('before-read',k);return structuredClone(this.c.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}
  async mutate(k,update){await this.c.hook?.('before-update',k);const j=structuredClone(this.c.rows.get(k)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});const result=update(j);await this.c.hook?.('after-update',k,j);this.c.rows.set(k,structuredClone(j));await this.c.hook?.('after-commit',k,j);return result;}
  async save(k,v){this.c.cache.set(k,structuredClone(v));}
  async load(k){return this.c.cache.get(k);}
  async removeSavedSnapshot(){this.c.cache.delete('last-snapshot');}
}`,
        }));
      },
    },
  ],
});
const moduleUrl =
  "data:text/javascript;base64," +
  Buffer.from(built.outputFiles[0]!.text).toString("base64");
let serial = 0;
function gate() {
  let open!: (value?: any) => void;
  const promise = new Promise<any>((r) => {
    open = r;
  });
  return { promise, open };
}
async function until(condition: () => boolean) {
  const end = Date.now() + 3000;
  while (!condition()) {
    assert(Date.now() < end, "modeled boundary not reached");
    await new Promise((r) => setTimeout(r, 1));
  }
}
function signedJournal(
  a = fixtureAccount,
  b = fixtureBundle,
  id = "review-payment",
) {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, b, id, 1000);
  wallet.transitionPayment(j, id, "signing");
  wallet.transitionPayment(j, id, "signed", { rawTx: f.rawTx, txid: f.txid });
  return j;
}
async function setup(rows = new Map<string, any>()) {
  const c: any = {
    rows,
    cache: new Map(),
    nodes: new Map(),
    requests: [],
    disconnects: [],
    hook: undefined,
    endpoint: createPsbtEndpoint(),
    handlers: new Map(),
  };
  const dom = {
    _html: "",
    set innerHTML(value: string) {
      this._html = value;
      c.nodes.clear();
      for (const [, tag, id] of value.matchAll(
        /<([^>]+)\sid="([^"]+)"[^>]*>/g,
      )) {
        const full =
          value.match(new RegExp('<[^>]+id="' + id + '"[^>]*>'))?.[0] ?? "";
        c.nodes.set(id, {
          disabled: /\sdisabled(?:\s|>)/.test(full),
          checked: /\schecked(?:\s|>)/.test(full),
          addEventListener(type: string, fn: Function) {
            this[type] = fn;
          },
        });
      }
    },
    get innerHTML() {
      return this._html;
    },
  };
  Object.assign(globalThis, {
    operationReview: c,
    document: {
      querySelector: () => dom,
      querySelectorAll: () => [],
      getElementById: (id: string) => c.nodes.get(id) ?? null,
    },
    window: {
      addEventListener: (kind: string, fn: Function) =>
        c.handlers.set(kind, fn),
    },
    BroadcastChannel: class {
      postMessage() {}
    },
    fetch: async (route: string, options: any) => {
      if (route === "/api/indexer/read") {
        const body = JSON.parse(options.body);
        assert.deepEqual(Object.keys(body).sort(), [
          "consent",
          "network",
          "path",
        ]);
        assert.match(
          body.path,
          /^\/api\/(?:v2\/(?:|block-index\/[0-9]+)|v1\/estimatefee\/(?:1|10|25))$/,
        );
        // Anonymous estimates are separate from the owned local-process requests under test.
        throw new Error("Modeled fee service unavailable");
      }
      c.requests.push({ route, body: JSON.parse(options.body) });
      if (route === "/api/local/close")
        return new Response(
          JSON.stringify(
            c.closeFailure ? { error: "Shutdown failed" } : { closed: true },
          ),
          { status: c.closeFailure ? 400 : 200 },
        );
      if (c.localSnapshot && route.startsWith("/api/local/")) {
        if (route === "/api/local/blockHash") {
          const { height } = JSON.parse(options.body);
          return Response.json({
            height,
            hash: blockHash(height),
            tip: c.localSnapshot.tip,
          });
        }
        if (route === "/api/local/snapshot" && c.snapshotGate) {
          c.snapshotEntered = true;
          await c.snapshotGate;
        }
        return Response.json(c.localSnapshot);
      }
      if (route === "/api/local/start")
        return new Response(
          JSON.stringify({ error: "Fixture has no native scanner" }),
          { status: 400 },
        );
      if (route === "/api/check") {
        await c.checkHook?.();
        const body = JSON.parse(options.body);
        return new Response(
          JSON.stringify({
            network: body.account.network,
            genesisHash: sdk.NETWORKS[body.account.network].genesisHash,
            tip: { height: 200, hash: "aa".repeat(32) },
            checkedAt: Date.now(),
            coins: fixtureBundle.inputs.map((i) => ({
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
      assert(
        ["/api/broadcast", "/api/indexer/broadcast"].includes(route),
        "unexpected source request",
      );
      return new Response(JSON.stringify({ txid: f.txid }));
    },
  });
  const app: any = await import(moduleUrl + "#" + serial++);
  function event(id: string, type = "click", target?: any) {
    const el = c.nodes.get(id);
    assert(el, `missing control ${id}`);
    el[type](target ? { target } : undefined);
  }
  async function settle() {
    await until(() => !app.auditState().busy);
    await new Promise((r) => setImmediate(r));
  }
  function approve() {
    const el = c.nodes.get("broadcast-approval");
    assert(el);
    el.checked = true;
    el.change({ target: el });
  }
  return { c, app, dom, event, settle, approve };
}

test("public import closes the tracked local owner before starting and remembering replacement", async () => {
  const t = await setup();
  const a = { ...fixtureAccount, network: "mainnet" as const };
  const b = { ...fixtureBundle, network: "mainnet" as const };
  const replacement = { ...a, chainCode: new Uint8Array(32).fill(9) };
  await t.app.auditMount(a, b, null, { source: "local", page: "overview" });
  await t.app.auditOwnLocal(a);
  const text = wallet.exportPublicRecovery(replacement, wallet.emptyJournal());
  t.event("public-file", "change", {
    files: [{ size: text.length, text: async () => text }],
  });
  await t.settle();
  assert.equal(
    wallet.accountId(t.app.auditState().account),
    wallet.accountId(replacement),
  );
  assert.deepEqual(
    t.c.cache.get("last-account"),
    sdk.accountToJson(replacement),
  );
  assert.equal(t.c.requests[0].route, "/api/local/close");
  assert.equal(t.c.requests[0].body.owner, wallet.accountId(a));
  assert.equal(t.c.requests[1].route, "/api/local/start");
  t.event("disconnect");
  await t.settle();
  assert.equal(t.app.auditState().account, null);
  assert.equal(t.c.requests.at(-1).body.owner, wallet.accountId(replacement));
});

test("failed local shutdown retains the old account and owner for explicit retry", async () => {
  const t = await setup();
  const a = { ...fixtureAccount, network: "mainnet" as const };
  const b = { ...fixtureBundle, network: "mainnet" as const };
  const replacement = { ...a, chainCode: new Uint8Array(32).fill(9) };
  await t.app.auditMount(a, b, null, { source: "node", page: "overview" });
  await t.app.auditOwnLocal(a);
  t.c.closeFailure = true;
  const text = wallet.exportPublicRecovery(replacement, wallet.emptyJournal());
  t.event("public-file", "change", {
    files: [{ size: text.length, text: async () => text }],
  });
  await t.settle();
  assert.equal(
    wallet.accountId(t.app.auditState().account),
    wallet.accountId(a),
  );
  assert.equal(t.c.requests[0].body.owner, wallet.accountId(a));
  t.c.closeFailure = false;
  t.event("disconnect");
  await t.settle();
  assert.equal(t.app.auditState().account, null);
  assert.equal(t.c.requests.at(-1).body.owner, wallet.accountId(a));
});

test("disconnected draft connects the matching Ledger and signs only after a separate explicit action", async () => {
  const id = "inline-connect-draft",
    owner = wallet.accountId(fixtureAccount);
  const journal = wallet.emptyJournal();
  wallet.reservePayment(journal, fixtureBundle, id, 1000);
  const saved = JSON.stringify(journal),
    t = await setup(new Map([[owner, journal]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, id);
  const watch = t.app.auditState().snapshot;
  assert.equal(t.c.nodes.get("connect-inline")?.disabled, false);
  assert.equal((t.dom.innerHTML.match(/id="connect-inline"/g) ?? []).length, 1);
  assert.equal(t.c.nodes.has("sign"), false);
  t.event("connect-inline");
  await t.settle();
  assert.equal(t.app.auditState().client?.sessionState, "ready");
  assert.equal(t.app.auditState().activePayment, id);
  assert.equal(t.app.auditState().snapshot, watch);
  assert.equal(JSON.stringify(t.c.rows.get(owner)), saved);
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  assert.equal(t.c.endpoint.commands.includes(P.SIGN_PSBT), false);
  assert.equal(t.c.requests.length, 0);
  assert.equal(t.c.nodes.has("connect-inline"), false);
  assert.equal(t.c.nodes.get("sign")?.disabled, false);
  t.event("sign");
  await t.settle();
  assert.equal(
    t.c.endpoint.commands.filter((ins: number) => ins === P.SIGN_PSBT).length,
    1,
  );
  assert.equal(t.c.requests[0]?.route, "/api/check");
  assert.equal(t.c.rows.get(owner).payments[0].state, "signed");
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  assert.equal(
    t.c.requests.some((request: any) => request.route.endsWith("/broadcast")),
    false,
  );
});

test("matching mainnet draft connection preserves review without starting another background scan", async () => {
  const a = { ...fixtureAccount, network: "mainnet" as const },
    b = { ...fixtureBundle, network: "mainnet" as const };
  const id = "mainnet-inline-draft",
    owner = wallet.accountId(a),
    journal = wallet.emptyJournal();
  wallet.reservePayment(journal, b, id, 1000);
  const saved = JSON.stringify(journal),
    t = await setup(new Map([[owner, journal]]));
  t.c.endpoint = createPsbtEndpoint({ account: a });
  await t.app.auditMount(a, b, id, { source: "local", page: "send" });
  const watch = t.app.auditState().snapshot;
  t.event("connect-inline");
  await t.settle();
  assert.equal(t.app.auditState().client?.sessionState, "ready");
  assert.equal(t.app.auditState().activePayment, id);
  assert.equal(t.app.auditState().snapshot, watch);
  assert.equal(JSON.stringify(t.c.rows.get(owner)), saved);
  assert.equal(t.c.endpoint.commands.includes(P.SIGN_PSBT), false);
  assert.equal(t.c.requests.length, 0);
  assert.equal(t.app.auditState().syncActive, false);
});

test("connecting a different Ledger drops only the old unsigned review and keeps recovery indices", async () => {
  const id = "foreign-inline-draft",
    owner = wallet.accountId(fixtureAccount),
    journal = wallet.emptyJournal();
  wallet.reservePayment(journal, fixtureBundle, id, 1000);
  const highWater = journal.nextChangeIndex,
    t = await setup(new Map([[owner, journal]]));
  const foreign = { ...fixtureAccount, chainCode: new Uint8Array(32).fill(9) };
  t.c.endpoint = createPsbtEndpoint({ account: foreign });
  await t.app.auditMount(fixtureAccount, fixtureBundle, id);
  t.event("connect-inline");
  await t.settle();
  assert.equal(
    wallet.accountId(t.app.auditState().account),
    wallet.accountId(foreign),
  );
  assert.equal(t.app.auditState().activePayment, null);
  assert.equal(t.app.auditState().snapshot, null);
  assert.equal(t.c.rows.get(owner).nextChangeIndex, highWater);
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 0);
  assert.equal(t.c.endpoint.commands.includes(P.SIGN_PSBT), false);
});

test("nonzero mainnet account offers explicit public sync instead of unsupported local sync", async () => {
  const t = await setup(),
    a = { ...fixtureAccount, network: "mainnet" as const, account: 1 },
    b = { ...fixtureBundle, network: "mainnet" as const, account: 1 };
  await t.app.auditMount(a, b, null, { page: "overview", consent: false });
  assert.equal(t.c.nodes.has("sync-local"), false);
  assert.equal(t.c.nodes.has("sync-public"), true);
  assert.equal(
    (t.dom.innerHTML.match(/id="privacy-consent"/g) ?? []).length,
    1,
  );
  t.app.auditSync();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(t.c.requests.length, 0);
});

function localFixture(account: sdk.AccountPublicKey, index: number) {
  const tx = rawTransaction(500_000_000n, index, true, account);
  return {
    schema: 1,
    sourceCommit: LOCAL_SOURCE_COMMIT,
    watchOnly: true,
    network: "mainnet",
    account: 0,
    publicAccount: sdk.accountToJson(account),
    genesisHash: sdk.NETWORKS.mainnet.genesisHash,
    tip: { height: 200, hash: blockHash(200) },
    headerHeight: 200,
    filterHeight: 200,
    bestPeerHeight: 200,
    connections: 2,
    walletSynced: true,
    synced: true,
    ready: true,
    needsRegistration: false,
    lastUsed: [index, -1],
    registeredThrough: [index + 20, 19],
    coverage: {
      externalScannedThrough: index + 20,
      changeScannedThrough: 19,
      gapLimit: 20,
      scanComplete: true,
    },
    complete: true,
    transactions: [
      { txid: tx.txid, rawTransaction: tx.rawTransaction, block: tx.block },
    ],
    unspent: [{ txid: tx.txid, vout: 0 }],
  };
}

test("fresh browser discovers native-known receive use beyond its first gap", async () => {
  const t = await setup(),
    a = { ...fixtureAccount, network: "mainnet" as const },
    b = { ...fixtureBundle, network: "mainnet" as const };
  await t.app.auditMount(a, b, null, { source: "local", page: "overview" });
  t.c.localSnapshot = localFixture(a, 50);
  t.app.auditSync();
  await until(() => !t.app.auditState().syncActive);
  const state = t.app.auditState();
  assert.equal(state.syncComplete, true, state.notification);
  assert.equal(state.snapshot.coins.length, 1);
  assert.equal(state.snapshot.coins[0].index, 50);
  assert.equal(state.snapshot.coverage.externalScannedThrough, 70);
  assert.equal(t.c.rows.get(wallet.accountId(a)).issuedReceiveThrough, 50);
});

for (const flow of ["busy", "send", "receive"])
  test(`background discovery does not replace review state during ${flow}`, async () => {
    const t = await setup(),
      a = { ...fixtureAccount, network: "mainnet" as const },
      b = { ...fixtureBundle, network: "mainnet" as const };
    await t.app.auditMount(a, b, null, { source: "local", page: "overview" });
    const before = t.app.auditState(),
      release = gate();
    t.c.localSnapshot = localFixture(a, 0);
    t.c.snapshotGate = release.promise;
    t.app.auditSync();
    await until(() => t.c.snapshotEntered);
    t.app.auditFlow(flow);
    release.open();
    await until(() => !t.app.auditState().syncActive);
    const after = t.app.auditState();
    assert.equal(after.snapshot, before.snapshot);
    assert.equal(after.receiveIndex, before.receiveIndex);
    assert.equal(t.c.rows.has(wallet.accountId(a)), false);
  });

for (const boundary of ["before-update", "after-commit"])
  test(`receive opened at discovery journal ${boundary} prevents replacing its view`, async () => {
    const t = await setup(),
      a = { ...fixtureAccount, network: "mainnet" as const },
      b = { ...fixtureBundle, network: "mainnet" as const };
    await t.app.auditMount(a, b, null, { source: "local", page: "overview" });
    const before = t.app.auditState(),
      entered = gate(),
      release = gate();
    t.c.localSnapshot = localFixture(a, 0);
    t.c.hook = async (phase: string) => {
      if (phase === boundary) {
        entered.open();
        await release.promise;
      }
    };
    t.app.auditSync();
    await entered.promise;
    t.app.auditFlow("receive");
    release.open();
    await until(() => !t.app.auditState().syncActive);
    const after = t.app.auditState();
    assert.equal(after.snapshot, before.snapshot);
    assert.equal(after.receiveIndex, before.receiveIndex);
    assert.equal(
      t.c.rows.get(wallet.accountId(a))?.issuedReceiveThrough ?? -1,
      boundary === "before-update" ? -1 : 0,
    );
  });

function unsignedJournal(id = "temporary-review") {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  return j;
}

for (const action of ["flow-close", "discard", "back-payments", "fresh-send"])
  test(`temporary review ${action} releases inputs without rolling back recovery ranges`, async () => {
    const id = "temporary-review",
      owner = wallet.accountId(fixtureAccount),
      j = unsignedJournal(id);
    const t = await setup(new Map([[owner, j]]));
    await t.app.auditMount(fixtureAccount, fixtureBundle, id);
    assert.match(t.dom.innerHTML, />Cancel<\/button>/);
    assert.doesNotMatch(t.dom.innerHTML, /Discard draft/);
    if (action === "fresh-send") await t.app.auditNavigate("send");
    else t.event(action);
    await t.settle();
    const saved = t.c.rows.get(owner);
    assert.equal(saved.payments.length, 0);
    assert.equal(wallet.reservedOutpoints(saved).size, 0);
    assert.equal(saved.nextChangeIndex, j.nextChangeIndex);
    assert.equal(saved.issuedReceiveThrough, j.issuedReceiveThrough);
    assert.equal(t.app.auditState().activePayment, null);
    assert.equal(t.app.auditState().form.recipient, "");
    assert.equal(t.app.auditState().form.amount, "");
    assert.equal(t.c.endpoint.commands.length, 0);
  });

for (const state of [
  "signing",
  "signed",
  "broadcast-unknown",
  "accepted",
  "archived",
])
  test(`fresh Send never releases ${state} or changes its recovery data`, async () => {
    const owner = wallet.accountId(fixtureAccount),
      j = unsignedJournal();
    wallet.transitionPayment(j, "temporary-review", "signing");
    if (state !== "signing")
      wallet.transitionPayment(j, "temporary-review", "signed", {
        rawTx: f.rawTx,
        txid: f.txid,
      });
    if (["broadcast-unknown", "accepted", "archived"].includes(state))
      wallet.transitionPayment(j, "temporary-review", "broadcast-unknown");
    if (["accepted", "archived"].includes(state))
      wallet.transitionPayment(j, "temporary-review", "accepted");
    if (state === "archived")
      j.payments[0]!.archived = {
        status: "confirmed",
        block: { height: 100, hash: "ab".repeat(32) },
        checkedAt: 2000,
      };
    const before = JSON.stringify(j),
      t = await setup(new Map([[owner, j]]));
    await t.app.auditMount(fixtureAccount, fixtureBundle, null);
    await t.app.auditNavigate("send");
    assert.equal(JSON.stringify(t.c.rows.get(owner)), before);
    assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  });

test("restoring a saved account removes an abandoned unsigned review but retains its high-water marks", async () => {
  const a = { ...fixtureAccount, network: "mainnet" as const },
    b = { ...fixtureBundle, network: "mainnet" as const },
    j = wallet.emptyJournal();
  wallet.reservePayment(j, b, "abandoned-review", 1000);
  const owner = wallet.accountId(a),
    t = await setup(new Map([[owner, j]]));
  t.app.auditEmpty("mainnet");
  t.c.cache.set("last-account", sdk.accountToJson(a));
  await t.app.restoreSavedAccount();
  await until(() => !t.app.auditState().syncActive);
  assert.equal(t.c.rows.get(owner).payments.length, 0);
  assert.equal(t.c.rows.get(owner).nextChangeIndex, j.nextChangeIndex);
  assert.equal(
    t.c.rows.get(owner).issuedReceiveThrough,
    j.issuedReceiveThrough,
  );
});

test("public import removes a legacy unsigned review without deleting recovery indices", async () => {
  const owner = wallet.accountId(fixtureAccount),
    j = unsignedJournal(),
    t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "temporary-review");
  const text = wallet.exportPublicRecovery(fixtureAccount, j);
  t.event("public-file", "change", {
    files: [{ size: text.length, text: async () => text }],
  });
  await t.settle();
  assert.equal(t.c.rows.get(owner).payments.length, 0);
  assert.equal(t.c.rows.get(owner).nextChangeIndex, j.nextChangeIndex);
});

for (const claimed of [false, true])
  test(`cancel after prepare commit ${claimed ? "preserves a concurrent signing claim" : "releases only the just-created unsigned review"}`, async () => {
    const owner = wallet.accountId(fixtureAccount),
      t = await setup();
    await t.app.auditMount(fixtureAccount, fixtureBundle, null);
    t.app.auditPrepareView();
    let cancelled = false,
      allocated = 0;
    t.c.hook = async (phase: string, _owner: string, j: any) => {
      if (phase === "after-commit" && !cancelled && j.payments.length) {
        cancelled = true;
        allocated = j.nextChangeIndex;
        if (claimed)
          wallet.transitionPayment(
            t.c.rows.get(owner),
            j.payments[0].id,
            "signing",
          );
        t.app.auditAbort();
      }
    };
    t.event("prepare");
    await t.settle();
    assert.equal(cancelled, true, t.app.auditState().notification);
    assert.equal(t.c.rows.get(owner).payments.length, claimed ? 1 : 0);
    if (claimed) assert.equal(t.c.rows.get(owner).payments[0].state, "signing");
    assert.equal(t.c.rows.get(owner).nextChangeIndex, allocated);
    assert.equal(t.app.auditState().activePayment, null);
    assert.equal(t.c.endpoint.commands.length, 0);
  });

test("queued cleanup re-reads a competing signing claim and leaves it reserved", async () => {
  const owner = wallet.accountId(fixtureAccount),
    j = unsignedJournal(),
    t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "temporary-review");
  let once = false;
  t.c.hook = async (phase: string) => {
    if (phase === "before-update" && !once) {
      once = true;
      wallet.transitionPayment(
        t.c.rows.get(owner),
        "temporary-review",
        "signing",
      );
    }
  };
  t.event("flow-close");
  await t.settle();
  assert.equal(t.c.rows.get(owner).payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
});

test("cleanup winning during signing validation prevents any SIGN_PSBT", async () => {
  const owner = wallet.accountId(fixtureAccount),
    j = unsignedJournal(),
    t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "temporary-review");
  t.app.auditActualDevice(t.c.endpoint.transport);
  t.c.checkHook = () => t.app.auditCleanup(fixtureAccount, "temporary-review");
  await t.app.auditSign();
  assert.match(t.app.auditState().notification, /Payment changed/);
  assert.equal(t.c.endpoint.commands.includes(P.SIGN_PSBT), false);
  assert.equal(t.c.rows.get(owner).payments.length, 0);
});

test("cleanup failure keeps unsigned inputs reserved and reports the storage error", async () => {
  const owner = wallet.accountId(fixtureAccount),
    j = unsignedJournal(),
    t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "temporary-review");
  t.c.hook = async (phase: string) => {
    if (phase === "before-update") throw Error("Fixture storage unavailable");
  };
  t.event("flow-close");
  await t.settle();
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  assert.equal(t.app.auditState().activePayment, "temporary-review");
  assert.match(t.app.auditState().notification, /storage unavailable/);
});

test("queued fresh Send cleanup cannot navigate or reset a replacement account", async () => {
  const owner = wallet.accountId(fixtureAccount),
    j = unsignedJournal(),
    t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "temporary-review");
  const entered = gate(),
    release = gate();
  let once = false;
  t.c.hook = async (phase: string) => {
    if (phase === "before-update" && !once) {
      once = true;
      entered.open();
      await release.promise;
    }
  };
  const navigating = t.app.auditNavigate("send");
  await entered.promise;
  const replacement = {
    ...fixtureAccount,
    chainCode: new Uint8Array(32).fill(9),
  };
  await t.app.auditMount(replacement, fixtureBundle, null, {
    page: "overview",
  });
  const recipient = t.app.auditState().form.recipient;
  release.open();
  await navigating;
  assert.equal(
    wallet.accountId(t.app.auditState().account),
    wallet.accountId(replacement),
  );
  assert.equal(t.app.auditState().page, "overview");
  assert.equal(t.app.auditState().form.recipient, recipient);
  assert.equal(t.c.rows.get(owner).payments.length, 0);
});

test("cross-tab journal refresh only clears missing active IDs and never sweeps a live review", async () => {
  const owner = wallet.accountId(fixtureAccount),
    j = unsignedJournal(),
    t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "temporary-review");
  await t.app.auditReloadJournal();
  assert.equal(t.c.rows.get(owner).payments.length, 1);
  assert.equal(t.app.auditState().activePayment, "temporary-review");
  wallet.discardDraft(t.c.rows.get(owner), "temporary-review");
  await t.app.auditReloadJournal();
  assert.equal(t.app.auditState().activePayment, null);
  assert.equal(t.app.auditState().form.recipient, "");
});
