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
  feeSelection='custom';manualSelection=true;maxAmount=false;
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

for (const phase of ["before-update", "after-update"])
  for (const kind of ["owner", "network", "source", "payment"]) {
    test(`REGRESSION B1: broadcast ${kind} change ${phase} rejects submission`, async () => {
      const owner = wallet.accountId(fixtureAccount),
        t = await setup(new Map([[owner, signedJournal()]]));
      await t.app.auditMount(fixtureAccount, fixtureBundle, "review-payment");
      const reached = gate(),
        release = gate();
      t.c.hook = async (p: string) => {
        if (p === phase) {
          reached.open();
          await release.promise;
        }
      };
      t.approve();
      t.event("broadcast");
      await reached.promise;
      t.app.auditAlter(kind);
      release.open();
      await t.settle();
      const submitted = t.c.requests.filter((r: any) =>
        r.route.endsWith("/broadcast"),
      );
      assert.equal(submitted.length, 0);
      if (submitted.length) {
        assert.equal(submitted[0].body.rawTx, f.rawTx);
        assert.equal(submitted[0].body.expectedTxid, f.txid);
      }
      assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
    });
  }

test("CONTROL: Cancel after broadcast update and before completion prevents submission but preserves uncertainty", async () => {
  const owner = wallet.accountId(fixtureAccount),
    t = await setup(new Map([[owner, signedJournal()]]));
  await t.app.auditMount(fixtureAccount, fixtureBundle, "review-payment");
  const reached = gate(),
    release = gate();
  t.c.hook = async (p: string) => {
    if (p === "after-update") {
      reached.open();
      await release.promise;
    }
  };
  t.approve();
  t.event("broadcast");
  await reached.promise;
  t.event("cancel-device");
  release.open();
  await t.settle();
  assert.equal(t.c.requests.length, 0);
  assert.equal(t.c.rows.get(owner).payments[0].state, "broadcast-unknown");
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
});

test("REGRESSION B2: consent revoked while broadcast waits prevents any signed-payload transmission", async () => {
  const a = { ...fixtureAccount, network: "mainnet" as const },
    b = { ...fixtureBundle, network: "mainnet" as const },
    owner = wallet.accountId(a),
    t = await setup(new Map([[owner, signedJournal(a, b)]]));
  await t.app.auditMount(a, b, "review-payment", { source: "public" });
  const reached = gate(),
    release = gate();
  t.c.hook = async (p: string) => {
    if (p === "before-update") {
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
  assert.equal(t.c.rows.get(owner).payments[0].state, "signed");
});

for (const phase of ["file-read", "before-update"])
  test(`REGRESSION C1: public-account import honors Cancel during ${phase}`, async () => {
    const t = await setup(),
      reached = gate(),
      release = gate();
    const text = wallet.exportPublicRecovery(fixtureAccount, {
      ...wallet.emptyJournal(),
      issuedReceiveThrough: 9,
      nextChangeIndex: 11,
    });
    const file = {
      size: text.length,
      async text() {
        if (phase === "file-read") {
          reached.open();
          await release.promise;
        }
        return text;
      },
    };
    if (phase === "before-update")
      t.c.hook = async (p: string) => {
        if (p === "before-update") {
          reached.open();
          await release.promise;
        }
      };
    t.event("public-file", "change", { files: [file] });
    await reached.promise;
    t.event("cancel-device");
    release.open();
    await t.settle();
    assert.equal(t.app.auditState().account, null);
    assert.equal(t.c.rows.has(wallet.accountId(fixtureAccount)), false);
    assert.doesNotMatch(
      t.app.auditState().notification,
      /Public account loaded/,
    );
    assert.equal(t.c.requests.length, 0);
  });

test("REGRESSION C2: preparing a payment honors Cancel before the storage update", async () => {
  const t = await setup(),
    reached = gate(),
    release = gate();
  await t.app.auditMount(fixtureAccount, fixtureBundle, null);
  t.c.hook = async (p: string) => {
    if (p === "before-update") {
      reached.open();
      await release.promise;
    }
  };
  t.event("prepare");
  await reached.promise;
  t.event("cancel-device");
  release.open();
  await t.settle();
  const j = t.c.rows.get(wallet.accountId(fixtureAccount));
  assert.equal(j, undefined);
  assert.doesNotMatch(
    t.app.auditState().notification,
    /Unsigned payment prepared/,
  );
  assert.equal(t.c.requests.length, 0);
});

test(
  "MODEL ONLY D1: an injected superseded disconnect callback clears the new connection",
  { skip: !process.env.REVIEW_MODEL_PROBES },
  async () => {
    const t = await setup();
    t.event("connect");
    await t.settle();
    assert(t.app.auditState().client);
    const old = t.c.disconnects[0];
    t.c.endpoint = createPsbtEndpoint();
    t.event("connect");
    await t.settle();
    assert(t.app.auditState().client);
    assert.equal(t.c.disconnects.length, 2);
    const currentTransport = t.app.auditState().transport;
    old();
    assert.equal(t.app.auditState().client, null);
    assert.equal(t.app.auditState().transport, currentTransport);
    assert.match(t.app.auditState().notification, /Ledger disconnected/);
    assert.equal(t.c.requests.length, 0);
  },
);

test("MODEL ONLY E1: unordered late write failure cannot overwrite the staged newer recovery copy", async () => {
  const a = fixtureAccount,
    b = fixtureBundle,
    id1 = "old-payment",
    owner1 = wallet.accountId(a),
    a2 = { ...a, network: "mainnet" as const },
    b2 = { ...b, network: "mainnet" as const },
    owner2 = wallet.accountId(a2),
    id2 = "new-payment";
  const old = wallet.emptyJournal(),
    next = wallet.emptyJournal();
  wallet.reservePayment(old, b, id1, 1000);
  wallet.reservePayment(next, b2, id2, 2000);
  const t = await setup(
      new Map([
        [owner1, old],
        [owner2, next],
      ]),
    ),
    oldRelease = gate();
  let oldPending = false;
  t.c.hook = async (phase: string, key: string, j: any) => {
    if (phase === "after-update" && j.payments[0].state === "signed") {
      if (key === owner1) {
        oldPending = true;
        await oldRelease.promise;
        throw Error("Old write eventually aborted");
      }
      if (key === owner2) throw Error("New write quota failure");
    }
  };
  const sigs = f.signatures.map((s: string) => sdk.fromHex(s));
  await t.app.auditMount(a, b, id1);
  t.app.auditFixtureDevice(sigs);
  await t.app.auditSign();
  assert(oldPending);
  assert.equal(t.app.auditState().emergency.paymentId, id1);
  // Modeled independent restore: genuine backup importer cryptographically verifies the public bytes.
  const restored = wallet.importWalletBackup(t.app.auditState().emergency.text);
  t.c.rows.set(owner1, restored.journal);
  await t.app.auditVerifyEmergency();
  assert.equal(t.app.auditState().emergency, null);
  await t.app.auditMount(a2, b2, id2);
  t.app.auditFixtureDevice(sigs);
  await t.app.auditSign();
  assert.equal(t.app.auditState().emergency.paymentId, id2);
  assert.equal(t.c.rows.get(owner2).payments[0].state, "signing");
  oldRelease.open();
  await new Promise((r) => setImmediate(r));
  assert.equal(
    t.app.auditState().emergency.paymentId,
    id2,
    "old late catch must not replace the only exposed new signed backup",
  );
  await t.app.auditVerifyEmergency();
  assert.equal(t.app.auditState().emergency.paymentId, id2);
  assert.equal(t.c.rows.get(owner2).payments[0].rawTx, undefined);
  assert.equal(
    t.c.requests.filter((r: any) => r.route.endsWith("/broadcast")).length,
    0,
  );
});

test("REGRESSION E2: unload warns while verified signatures await storage completion", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "unload-pending",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]])),
    reached = gate(),
    release = gate();
  t.c.hook = async (phase: string, key: string, row: any) => {
    if (phase === "after-update" && row.payments[0].state === "signed") {
      reached.open();
      await release.promise;
    }
  };
  await t.app.auditMount(fixtureAccount, fixtureBundle, id);
  t.app.auditActualDevice(t.c.endpoint.transport, {
    durabilityTimeoutMs: 5000,
  });
  const signing = t.app.auditSign();
  await reached.promise;
  assert.equal(t.c.rows.get(owner).payments[0].state, "signing");
  assert.equal(t.app.auditState().emergency.paymentId, id);
  assert.equal(t.app.auditState().emergency.pending, true);
  assert.match(t.dom.innerHTML, /Saving payment/);
  assert.doesNotMatch(t.dom.innerHTML, /Payment could not be saved/);
  const backup = wallet.importWalletBackup(t.app.auditState().emergency.text);
  assert.equal(backup.journal.payments[0].rawTx, f.rawTx);
  let prevented = 0;
  const event = {
    preventDefault() {
      prevented++;
    },
    returnValue: undefined,
  };
  t.c.handlers.get("beforeunload")(event);
  assert.equal(
    prevented,
    1,
    "verified signed bytes must have an unload guard before any storage await",
  );
  release.open();
  await signing;
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
});

for (const phase of ["after-update", "after-commit"]) {
  test(`REGRESSION C1: Cancel ${phase} preserves committed public ranges without opening an account`, async () => {
    const t = await setup(),
      reached = gate(),
      release = gate();
    const text = wallet.exportPublicRecovery(fixtureAccount, {
      ...wallet.emptyJournal(),
      issuedReceiveThrough: 9,
      nextChangeIndex: 11,
    });
    t.c.hook = async (p: string) => {
      if (p === phase) {
        reached.open();
        await release.promise;
      }
    };
    t.event("public-file", "change", {
      files: [{ size: text.length, text: async () => text }],
    });
    await reached.promise;
    t.event("cancel-device");
    release.open();
    await t.settle();
    assert.equal(t.app.auditState().account, null);
    assert.equal(
      t.c.rows.get(wallet.accountId(fixtureAccount)).issuedReceiveThrough,
      9,
    );
    assert.equal(
      t.c.rows.get(wallet.accountId(fixtureAccount)).nextChangeIndex,
      11,
    );
    assert.match(t.app.auditState().notification, /range saved.*cancelled/);
  });
  test(`REGRESSION C2: Cancel ${phase} preserves the prepared unsigned reservation`, async () => {
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
    t.event("cancel-device");
    release.open();
    await t.settle();
    const saved = t.c.rows.get(wallet.accountId(fixtureAccount));
    assert.equal(saved.payments.length, 1);
    assert.equal(saved.payments[0].state, "draft");
    assert.equal(wallet.reservedOutpoints(saved).size, 2);
    assert.equal(t.app.auditState().activePayment, null);
    assert.match(
      t.app.auditState().notification,
      /Unsigned payment saved.*cancelled/,
    );
  });
}

for (const phase of ["file-read", "before-update", "after-update"]) {
  test(`REGRESSION C3: snapshot import Cancel during ${phase} cannot apply a stale view`, async () => {
    const t = await setup(),
      reached = gate(),
      release = gate();
    const text = readFileSync(
      new URL(
        "../../apps/companion/test/fixtures/example-watch.json",
        import.meta.url,
      ),
      "utf8",
    );
    const imported = wallet.parseWatchSnapshot(text),
      owner = wallet.accountId(imported.account);
    if (phase !== "file-read")
      t.c.hook = async (p: string) => {
        if (p === phase) {
          reached.open();
          await release.promise;
        }
      };
    const file = {
      size: text.length,
      async text() {
        if (phase === "file-read") {
          reached.open();
          await release.promise;
        }
        return text;
      },
    };
    t.event("snapshot-file", "change", { files: [file] });
    await reached.promise;
    t.event("cancel-device");
    release.open();
    await t.settle();
    assert.equal(t.app.auditState().account, null);
    assert.equal(t.c.rows.has(owner), phase === "after-update");
    assert.equal(t.c.requests.length, 0);
  });
}

test("REGRESSION C2: queued input events cannot mutate the payment preparation snapshot", async () => {
  const t = await setup(),
    reached = gate(),
    release = gate();
  await t.app.auditMount(fixtureAccount, fixtureBundle, null);
  t.c.hook = async (p: string) => {
    if (p === "before-update") {
      reached.open();
      await release.promise;
    }
  };
  t.event("prepare");
  await reached.promise;
  t.event("amount", "input", { value: "0.00010000" });
  t.event("fee", "input", { value: "0.00002000" });
  release.open();
  await t.settle();
  assert.equal(
    t.c.rows.get(wallet.accountId(fixtureAccount)).payments[0].bundleHex,
    f.bundleHex,
  );
});

test("REGRESSION E2: closing the account after signed-storage failure cannot discard recovery or its unload guard", async () => {
  const owner = wallet.accountId(fixtureAccount),
    id = "closed-recovery",
    j = wallet.emptyJournal();
  wallet.reservePayment(j, fixtureBundle, id, 1000);
  const t = await setup(new Map([[owner, j]]));
  t.c.hook = async (phase: string, key: string, row: any) => {
    if (phase === "after-update" && row.payments[0].state === "signed")
      throw Error("Modeled signed write failure");
  };
  await t.app.auditMount(fixtureAccount, fixtureBundle, id, {
    page: "overview",
  });
  t.app.auditActualDevice(t.c.endpoint.transport);
  await t.app.auditSign();
  const recovery = t.app.auditState().emergency;
  assert.equal(recovery.pending, false);
  assert.match(t.dom.innerHTML, /Payment could not be saved/);
  assert.equal(
    wallet.importWalletBackup(recovery.text).journal.payments[0].rawTx,
    f.rawTx,
  );
  t.event("disconnect");
  await t.settle();
  assert.equal(t.app.auditState().account, null);
  assert.equal(t.app.auditState().emergency, recovery);
  assert.equal(t.c.rows.get(owner).payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  let prevented = 0;
  t.c.handlers.get("beforeunload")({
    preventDefault() {
      prevented++;
    },
    returnValue: undefined,
  });
  assert.equal(prevented, 1);
});

test("REGRESSION E3: settled signed write with failed read-back retains a warning and cannot claim success", async () => {
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
  assert.equal(t.c.rows.get(owner).payments[0].rawTx, f.rawTx);
  assert.equal(wallet.reservedOutpoints(t.c.rows.get(owner)).size, 2);
  assert.equal(t.app.auditState().emergency.pending, false);
  assert.equal(
    wallet.importWalletBackup(t.app.auditState().emergency.text).journal
      .payments[0].rawTx,
    f.rawTx,
  );
  assert.match(t.dom.innerHTML, /Payment could not be saved/);
  assert.doesNotMatch(t.dom.innerHTML, /Saving payment/);
  assert.doesNotMatch(
    t.app.auditState().notification,
    /exact signed bytes saved/,
  );
  assert.equal(t.c.endpoint.acknowledgements(), 0);
});
