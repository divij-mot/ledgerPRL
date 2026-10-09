/** Device-identity review using the actual companion main.ts. No browser, native code,
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
export function auditPage(next){page=next;render();}
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
    frames: [],
  };
  const dom = {
    _html: "",
    set innerHTML(value: string) {
      this._html = value;
      c.frames.push({
        html: value,
        deviceState: c.readState?.().client?.sessionState,
      });
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
  c.readState = app.auditState;
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

for (const fault of ["rejected-ack", "lost-ack"] as const) {
  test(`fixed D1: prior verified receive clears after terminal ${fault}, preserving signed bytes`, async () => {
    const owner = wallet.accountId(fixtureAccount),
      id = "identity-review-payment",
      j = wallet.emptyJournal();
    wallet.reservePayment(j, fixtureBundle, id, 1000);
    const t = await setup(new Map([[owner, j]]));
    t.c.endpoint = createPsbtEndpoint({
      onStage: (stage: string) => {
        if (stage === "ack") {
          if (fault === "rejected-ack") return Uint8Array.of(0x69, 0x85);
          throw new Error("Synthetic final acknowledgement lost");
        }
      },
    });
    await t.app.auditMount(fixtureAccount, fixtureBundle, id, {
      page: "receive",
    });
    t.app.auditActualDevice(t.c.endpoint.transport);
    t.app.auditRender();
    t.event("verify-receive");
    await t.settle();
    const expected = sdk.deriveAddress(fixtureAccount, 0, 0).address;
    assert.equal(t.app.auditState().verifiedReceive, expected);
    assert.equal(t.c.nodes.get("copy-address").disabled, false);
    await t.app.auditSign();
    const after = t.app.auditState();
    assert.equal(after.client.sessionState, "failed");
    assert.match(after.notification, /acknowledgement was not confirmed/);
    assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
    assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
    assert.equal(
      t.c.requests.some((r: any) => r.route.endsWith("broadcast")),
      false,
    );
    assert.equal(after.verifiedReceive, null);
    t.app.auditPage("receive");
    assert.match(t.dom.innerHTML, />Not device verified</);
    assert.equal(t.c.nodes.get("copy-address").disabled, true);
    assert.equal(t.c.nodes.get("verify-receive").disabled, true);
    const count = t.c.endpoint.commands.length;
    await assert.rejects(
      after.client.verifyAddress(fixtureAccount, 0, 0),
      /failed/,
    );
    await assert.rejects(
      after.client.signBundle(fixtureBundle, fixtureAccount),
      /failed/,
    );
    assert.equal(t.c.endpoint.commands.length, count);
  });
}

test("control: device review rejection before any signatures clears the prior verified receive label", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "review-rejection",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  t.c.endpoint = createPsbtEndpoint({
    onStage: (stage: string) =>
      stage === "review" ? Uint8Array.of(0x69, 0x85) : undefined,
  });
  await t.app.auditMount(fixtureAccount, fixtureBundle, id, {
    page: "receive",
  });
  t.app.auditActualDevice(t.c.endpoint.transport);
  t.app.auditRender();
  t.event("verify-receive");
  await t.settle();
  assert.equal(
    t.app.auditState().verifiedReceive,
    sdk.deriveAddress(fixtureAccount, 0, 0).address,
  );
  await t.app.auditSign();
  assert.equal(t.app.auditState().client.sessionState, "failed");
  assert.equal(t.app.auditState().verifiedReceive, null);
  t.app.auditPage("receive");
  assert.equal(t.c.nodes.get("copy-address").disabled, true);
  assert.equal(t.c.rows.get(owner).payments[0].state, "signing");
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, undefined);
});

test("failed signed-storage render stays unverified while the next journal read is stalled", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "stalled-storage-cleanup",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, id, {
    page: "receive",
  });
  t.app.auditActualDevice(t.c.endpoint.transport);
  t.app.auditRender();
  t.event("verify-receive");
  await t.settle();
  const blocked = gate(),
    reached = gate();
  let failed = false;
  t.c.hook = async (phase: string, _key: string, row: any) => {
    if (phase === "after-update" && row.payments[0]?.state === "signed") {
      failed = true;
      throw new Error("Synthetic signed-storage failure");
    }
    if (phase === "before-read" && failed) {
      reached.open();
      await blocked.promise;
    }
  };
  const signing = t.app.auditSign();
  await reached.promise;
  const state = t.app.auditState();
  assert.equal(state.client.sessionState, "failed");
  assert.equal(state.verifiedReceive, null);
  assert(state.emergency);
  assert.equal(state.emergency.pending, false);
  assert.equal(
    JSON.parse(state.emergency.text).journal.payments[0].rawTx,
    f.rawTx,
  );
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  assert.equal(t.c.rows.get(owner).payments[0].state, "signing");
  assert.match(t.dom.innerHTML, />Not device verified</);
  assert.equal(t.c.nodes.get("copy-address").disabled, true);
  assert.equal(
    t.c.frames.filter(
      (frame: any) =>
        frame.deviceState === "failed" &&
        />Verified on device</.test(frame.html),
    ).length,
    0,
  );
  blocked.open();
  await signing;
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.equal(
    t.c.requests.some((r: any) => r.route.endsWith("broadcast")),
    false,
  );
});

test("ordinary successful signing preserves valid same-session receive verification", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "successful-session",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, id, {
    page: "receive",
  });
  t.app.auditActualDevice(t.c.endpoint.transport);
  t.app.auditRender();
  t.event("verify-receive");
  await t.settle();
  const expected = sdk.deriveAddress(fixtureAccount, 0, 0).address;
  await t.app.auditSign();
  assert.equal(t.app.auditState().client.sessionState, "ready");
  assert.equal(t.app.auditState().verifiedReceive, expected);
  assert.equal(t.c.nodes.get("copy-address").disabled, false);
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
});

test("lost final ACK immediately clears the displayed label before a stalled journal refresh", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "lost-ack-stalled-refresh",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  let failedAck = false;
  t.c.endpoint = createPsbtEndpoint({
    onStage: (stage: string) => {
      if (stage === "ack") {
        failedAck = true;
        throw new Error("Synthetic lost final acknowledgement");
      }
    },
  });
  await t.app.auditMount(fixtureAccount, fixtureBundle, id, {
    page: "receive",
  });
  t.app.auditActualDevice(t.c.endpoint.transport);
  t.app.auditRender();
  t.event("verify-receive");
  await t.settle();
  const blocked = gate(),
    reached = gate();
  t.c.hook = async (phase: string) => {
    if (phase === "before-read" && failedAck) {
      reached.open();
      await blocked.promise;
    }
  };
  const signing = t.app.auditSign();
  await reached.promise;
  try {
    assert.equal(t.app.auditState().client.sessionState, "failed");
    assert.equal(t.app.auditState().verifiedReceive, null);
    assert.match(t.dom.innerHTML, />Not device verified</);
    assert.doesNotMatch(t.dom.innerHTML, />Verified on device</);
    assert.equal(t.c.nodes.get("copy-address").disabled, true);
    assert.equal(t.c.nodes.get("verify-receive").disabled, true);
    assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
    assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  } finally {
    blocked.open();
    await signing;
  }
});
