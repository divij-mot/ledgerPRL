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
  publicFixture as f,
} from "../../apps/companion/test/psbt-endpoint.mjs";

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
export function auditState(){return {account,network,sourceMode,privacyConsent,activePayment,busy,notification,client,transport,emergency:emergencySignedRecovery,journal,verifiedReceive,form:{...form}};}
export async function auditMount(a,b,id,options={}){
  account=a;network=a.network;sourceMode=options.source??'node';privacyConsent=options.consent??true;activePayment=id;page=options.page??'send';
  snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};
  selected.clear();for(const i of b.inputs)selected.add(outpoint(i));
  Object.assign(form,{recipient:scriptToAddress(b.outputs[0].scriptPubKey,b.network),amount:formatPrl(b.outputs[0].amount),fee:'0.00001000',changeIndex:'0'});
  await refreshJournal();render();
}
export function auditAlter(kind){if(kind==='owner')account={...account,chainCode:new Uint8Array(32).fill(9)};if(kind==='network')network='testnet2';if(kind==='source')sourceMode=sourceMode==='node'?'public':'node';if(kind==='payment')activePayment='another-payment';if(kind==='consent')privacyConsent=false;}
export function auditRender(){render();}
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
        b.onResolve({ filter: /^\.\/(ledger\.js|storage\.js)$/ }, (a) => ({
          path: a.path,
          namespace: "review-mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "review-mock" }, (a) => ({
          loader: "js",
          contents: a.path.includes("ledger")
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
      c.requests.push({ route, body: JSON.parse(options.body) });
      if (route === "/api/check") {
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

test("independent: settled signed write with failed read-back must leave a recovery warning, not perpetual saving", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "read-back-failure",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  let signedCommit = false;
  t.c.hook = async (phase: string, key: string, row: any) => {
    if (phase === "after-commit" && row.payments[0].state === "signed")
      signedCommit = true;
    if (phase === "before-read" && signedCommit)
      throw Error("Read-back transaction aborted");
  };
  await t.app.auditMount(fixtureAccount, fixtureBundle, id);
  t.app.auditActualDevice(t.c.endpoint.transport);
  await t.app.auditSign();
  assert.equal(t.app.auditState().busy, false);
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
  assert(
    t.app.auditState().emergency,
    "unverified durable copy must retain emergency recovery",
  );
  assert.equal(
    t.app.auditState().emergency.pending,
    false,
    "read-back has failed and signing settled; no storage task remains pending",
  );
  assert.match(t.dom.innerHTML, /Signed payment needs a recovery backup/);
  assert.doesNotMatch(t.dom.innerHTML, /Saving signed payment/);
});

test("independent: successful exact-match read-back clears recovery and unload warning", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "durable-exact",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, id);
  t.app.auditActualDevice(t.c.endpoint.transport);
  await t.app.auditSign();
  assert.equal(t.app.auditState().emergency, null);
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  let warned = false;
  t.c.handlers.get("beforeunload")({
    preventDefault() {
      warned = true;
    },
    returnValue: undefined,
  });
  assert.equal(warned, false);
});

for (const alteration of [
  "missing",
  "partial",
  "payment-id",
  "created-at",
  "outpoints",
  "bundle",
  "txid",
  "raw-signature",
]) {
  test(`independent: read-back ${alteration} cannot clear the sole verified recovery copy`, async () => {
    const owner = wallet.accountId(fixtureAccount),
      id = "retained-recovery",
      j = wallet.emptyJournal();
    wallet.reservePayment(j, fixtureBundle, id, 1000);
    const t = await setup(new Map([[owner, j]]));
    t.c.hook = async (phase: string, key: string, row: any) => {
      if (phase === "after-update" && row.payments[0].state === "signed")
        throw Error("Signed write aborted");
    };
    await t.app.auditMount(fixtureAccount, fixtureBundle, id);
    t.app.auditActualDevice(t.c.endpoint.transport);
    await t.app.auditSign();
    const recovery = t.app.auditState().emergency;
    assert(recovery);
    t.c.hook = undefined;
    const restored = wallet.importWalletBackup(recovery.text).journal;
    const saved = restored.payments[0];
    if (alteration === "missing") restored.payments = [];
    if (alteration === "partial") {
      saved.state = "signing";
      delete saved.rawTx;
      delete saved.txid;
    }
    if (alteration === "payment-id") saved.id += "-different";
    if (alteration === "created-at") saved.createdAt++;
    if (alteration === "outpoints") saved.outpoints.reverse();
    if (alteration === "bundle") saved.bundleHex += "00";
    if (alteration === "txid") saved.txid = "00".repeat(32);
    if (alteration === "raw-signature")
      saved.rawTx = saved.rawTx.slice(0, -10) + "00".repeat(5);
    t.c.rows.set(owner, restored);
    await t.app.auditVerifyEmergency();
    assert.equal(t.app.auditState().emergency, recovery);
    assert.equal(
      wallet.importWalletBackup(recovery.text).journal.payments[0].rawTx,
      f.rawTx,
    );
  });
}

for (const phase of ["before-update", "after-commit"]) {
  for (const kind of ["owner", "network", "source"]) {
    test(`independent: preparation ${kind} replacement at ${phase} cannot open a stale review`, async () => {
      const t = await setup(),
        reached = gate(),
        release = gate();
      await t.app.auditMount(fixtureAccount, fixtureBundle, null);
      t.c.hook = async (p: string) => {
        if (p === phase) {
          reached.open();
          await release.promise;
        }
      };
      t.event("prepare");
      await reached.promise;
      t.app.auditAlter(kind);
      release.open();
      await t.settle();
      assert.equal(t.app.auditState().activePayment, null);
      const saved = t.c.rows.get(wallet.accountId(fixtureAccount));
      if (phase === "before-update") assert.equal(saved, undefined);
      else {
        assert.equal(saved.payments[0].state, "draft");
        assert.equal(wallet.reservedOutpoints(saved).size, 2);
      }
      assert.equal(t.c.requests.length, 0);
    });
  }
  for (const type of ["public", "snapshot"]) {
    test(`independent: ${type} import account replacement at ${phase} cannot open a stale account`, async () => {
      const t = await setup(),
        reached = gate(),
        release = gate();
      await t.app.auditMount(fixtureAccount, fixtureBundle, null, {
        page: "overview",
      });
      const text =
        type === "public"
          ? wallet.exportPublicRecovery(fixtureAccount, {
              ...wallet.emptyJournal(),
              issuedReceiveThrough: 9,
              nextChangeIndex: 11,
            })
          : readFileSync(
              new URL(
                "../../apps/companion/public/example-watch.json",
                import.meta.url,
              ),
              "utf8",
            );
      t.c.hook = async (p: string) => {
        if (p === phase) {
          reached.open();
          await release.promise;
        }
      };
      t.event(type === "public" ? "public-file" : "snapshot-file", "change", {
        files: [{ size: text.length, text: async () => text }],
      });
      await reached.promise;
      t.app.auditAlter("owner");
      const newerAccount = t.app.auditState().account;
      release.open();
      await t.settle();
      assert.equal(t.app.auditState().account, newerAccount);
      assert.equal(t.c.rows.size, phase === "after-commit" ? 1 : 0);
      assert.equal(t.c.requests.length, 0);
    });
  }
}

test("independent: public import clears a former public-source consent and device session", async () => {
  const t = await setup();
  await t.app.auditMount(fixtureAccount, fixtureBundle, null, {
    page: "overview",
    source: "public",
    consent: true,
  });
  t.app.auditActualDevice(t.c.endpoint.transport);
  const text = wallet.exportPublicRecovery(
    fixtureAccount,
    wallet.emptyJournal(),
  );
  t.event("public-file", "change", {
    files: [{ size: text.length, text: async () => text }],
  });
  await t.settle();
  const state = t.app.auditState();
  assert.equal(
    wallet.accountId(state.account),
    wallet.accountId(fixtureAccount),
  );
  assert.equal(state.sourceMode, "node");
  assert.equal(state.privacyConsent, false);
  assert.equal(state.client, null);
  assert.equal(state.transport, null);
  assert.equal(t.c.requests.length, 0);
});

for (const phase of ["after-update", "after-commit"]) {
  test(`independent: public broadcast consent revoked at ${phase} cannot transmit bytes`, async () => {
    const a = { ...fixtureAccount, network: "mainnet" as const },
      b = { ...fixtureBundle, network: "mainnet" as const },
      owner = wallet.accountId(a);
    const t = await setup(new Map([[owner, signedJournal(a, b)]])),
      reached = gate(),
      release = gate();
    await t.app.auditMount(a, b, "review-payment", { source: "public" });
    t.c.hook = async (p: string) => {
      if (p === phase) {
        reached.open();
        await release.promise;
      }
    };
    t.approve();
    t.event("broadcast");
    await reached.promise;
    t.app.auditAlter("consent");
    release.open();
    await t.settle();
    assert.equal(t.c.requests.length, 0);
    assert.equal(t.c.rows.get(owner).payments[0].state, "broadcast-unknown");
    assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  });
}
