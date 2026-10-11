/** Independent actual-main + C-protocol adapter app-result cleanup regressions.
 * Public frozen vectors only; DOM/storage/node/transport endpoints are explicit mocks.
 * No user profile, real device, native process, network request or broadcast. */
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
const account = sdk.accountFromJson(f.publicAccount),
  bundle = sdk.bundleFromJson(f.bundle);
const owner = wallet.accountId(account),
  id = "independent-rejection-payment";
const directory = fileURLToPath(
  new URL("../../apps/companion/src/", import.meta.url),
);
const hooks = `
export async function rejectionMount(a,b,t){account=a;network=a.network;accountIndex=a.account;sourceMode='node';privacyConsent=false;snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};transport=t;client=t?new LedgerBitcoinPrlClient(t,a.network):null;await refreshJournal();activePayment=journal.payments[0]?.id??null;page='send';render();}
export function rejectionState(){return{busy,activePayment,notification,emergency:emergencySignedRecovery,client};}
export function rejectionOverview(){page='overview';render();}
export function rejectionBalances(){return balances(snapshot,reservedOutpoints(journal));}
export function pendingChangeView(amount){snapshot={...snapshot,coins:[{txid:'33'.repeat(32),vout:0,amount,branch:1,index:0,scriptPubKey:deriveAddress(account,1,0).scriptPubKey,rawTransaction:'',coinbase:false,block:null}]};page='overview';render();return snapshot;}
export function completeBeforeStage(signatures){client={sessionState:'ready',async signBundle(b){throw new VerifiedSigningResultError(finalizeTransaction(b,signatures),new Error('Complete result before UI callback staging'));}};}
export function unclassifiedFailure(){client={sessionState:'ready',async signBundle(){throw new Error('Unclassified signing error 0x6985');}};}
`;
const compiled = await build({
  stdin: {
    contents: readFileSync(directory + "main.ts", "utf8") + hooks,
    resolveDir: directory,
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "rejection-boundaries",
      setup(b) {
        b.onResolve({ filter: /^\.\/(?:device|storage)\.js$/ }, (a) => ({
          path: a.path,
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? `export async function connectLedger(){throw Error('Real device access forbidden');}`
            : `export class WatchStorage{constructor(){this.c=globalThis.rejectionFixture;}async journal(k){await this.c.beforeRead?.();return this.c.validate(structuredClone(this.c.rows.get(k)));}async mutate(k,update){this.c.mutations++;await this.c.beforeMutate?.(this.c.mutations);const j=this.c.validate(structuredClone(this.c.rows.get(k)));const value=update(j);this.c.validate(j);if(this.c.failSignedCommit&&j.payments.some(p=>p.rawTx)){this.c.failSignedCommit=false;throw Error("Fixture signed-write failure");}this.c.rows.set(k,structuredClone(j));this.c.commits++;return value;}async save(k,v){this.c.cache.set(k,structuredClone(v));}async load(k){return this.c.cache.get(k);}async removeSavedSnapshot(){}}`,
        }));
      },
    },
  ],
});
const moduleUrl =
  "data:text/javascript;base64," +
  Buffer.from(compiled.outputFiles[0]!.text).toString("base64");
let serial = 0;
function journal(recovery = false) {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle, id, 1000);
  if (recovery) wallet.transitionPayment(j, id, "signing");
  return j;
}
async function setup(
  initial = journal(),
  options: {
    failure?:
      | "review"
      | "transport"
      | "before-first"
      | "partial"
      | "partial-cancel"
      | "ack"
      | "late-final-race"
      | "none";
    failSignedCommit?: boolean;
    beforeMutate?: (n: number, c: any) => void;
    beforeRead?: (c: any) => void;
  } = {},
) {
  const c: any = {
    rows: new Map([[owner, structuredClone(initial)]]),
    cache: new Map(),
    nodes: new Map(),
    requests: [],
    mutations: 0,
    commits: 0,
    signatureResponses: [],
    failSignedCommit: options.failSignedCommit,
    validate: wallet.validateStoredJournal,
  };
  c.beforeMutate = (n: number) => options.beforeMutate?.(n, c);
  c.beforeRead = () => options.beforeRead?.(c);
  const failure = options.failure ?? "review";
  const endpoint = createPsbtEndpoint({
    onStage: async (stage: string, index?: number) => {
      if (stage === "review" && failure === "review") {
        c.deniedAtReview = true;
        return Uint8Array.of(0x69, 0x85);
      }
      if (stage === "review" && failure === "transport")
        throw Error("Transport returned uncertain 0x6985");
      if (
        stage === "signature" &&
        ((index === 0 && failure === "before-first") ||
          (index === 1 && failure === "partial"))
      )
        throw Error("Fixture transport loss before complete result");
      if (
        stage === "signature" &&
        index === 1 &&
        failure === "partial-cancel"
      ) {
        c.nodes.get("cancel-device").click();
        throw Error("Fixture cancelled partial result");
      }
      if (stage === "ack" && failure === "ack")
        throw Error("Fixture final ACK lost");
    },
  });
  const exchange = endpoint.transport.exchange.bind(endpoint.transport);
  endpoint.transport.exchange = (apdu: Uint8Array, signal?: AbortSignal) =>
    new Promise((resolve, reject) => {
      exchange(apdu, signal).then((response) => {
        if (response[0] === 0x10) c.signatureResponses.push(response[1]);
        resolve(response);
        if (
          failure === "late-final-race" &&
          response[0] === 0x10 &&
          response[1] === bundle.inputs.length - 1
        ) {
          // Resolve the response race first, then abort before its continuation processes the yield.
          queueMicrotask(() => {
            c.nodes.get("cancel-device").click();
            c.finalCancellationObserved = signal?.aborted;
          });
        }
      }, reject);
    });
  const dom = {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value: string) {
      this._html = value;
      c.nodes.clear();
      for (const tag of value.matchAll(/<[^>]+\bid="([^"]+)"[^>]*>/g)) {
        const text = tag[0];
        c.nodes.set(tag[1], {
          disabled: /\sdisabled(?:[\s=>])/.test(text),
          checked: false,
          addEventListener(kind: string, fn: Function) {
            (this as any)[kind] = fn;
          },
        });
      }
    },
  };
  Object.assign(globalThis, {
    rejectionFixture: c,
    document: {
      querySelector: () => dom,
      querySelectorAll: () => [],
      getElementById: (id: string) => c.nodes.get(id) ?? null,
    },
    window: { addEventListener() {} },
    BroadcastChannel: class {
      postMessage() {}
    },
    fetch: async (route: string, options: any) => {
      assert.equal(
        route,
        "/api/check",
        "Only fixture input-preflight is permitted; never broadcast",
      );
      c.requests.push(route);
      return Response.json({
        network: account.network,
        genesisHash: sdk.NETWORKS[account.network].genesisHash,
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
      });
    },
  });
  const app: any = await import(moduleUrl + "#" + serial++);
  await app.rejectionMount(account, bundle, endpoint.transport);
  const saved = () => structuredClone(c.rows.get(owner));
  async function event(control: string) {
    const node = c.nodes.get(control);
    assert(node, `Missing ${control}`);
    assert.equal(node.disabled, false);
    node.click();
    const deadline = performance.now() + 5000;
    while (app.rejectionState().busy) {
      assert(performance.now() < deadline, "UI did not settle");
      await new Promise((r) => setImmediate(r));
    }
  }
  return { c, endpoint, dom, app, event, saved };
}

test("initial review denial without a complete app result releases only its owning attempt across reload", async () => {
  const t = await setup(),
    before = t.saved();
  await t.event("sign");
  assert(t.endpoint.stages.some((s: any) => s.name === "review"));
  assert.equal(t.endpoint.yields(), 0);
  assert.equal(t.endpoint.acknowledgements(), 0);
  const after = t.saved();
  assert.equal(after.payments.length, 0);
  assert.equal(wallet.reservedOutpoints(after).size, 0);
  assert.equal(after.nextChangeIndex, before.nextChangeIndex);
  assert.equal(after.issuedReceiveThrough, before.issuedReceiveThrough);
  assert.equal(t.app.rejectionState().activePayment, null);
  assert.equal(t.app.rejectionState().emergency, null);
  assert.deepEqual(t.c.requests, ["/api/check"]);
  const reload = await setup(after);
  assert.equal(reload.saved().payments.length, 0);
  assert.equal(wallet.reservedOutpoints(reload.saved()).size, 0);
  assert.equal(reload.saved().nextChangeIndex, before.nextChangeIndex);
});

test("no-result rejection of a recovery attempt retains the old ambiguity and every reservation", async () => {
  const t = await setup(journal(true));
  await t.event("recover-signing");
  const p = t.saved().payments[0];
  assert.equal(p.state, "signing");
  assert.equal(p.rawTx, undefined);
  assert.equal(p.txid, undefined);
  assert.equal(wallet.reservedOutpoints(t.saved()).size, bundle.inputs.length);
  assert.equal(p.signingAttempt.recovery, true);
  assert(t.endpoint.stages.some((s: any) => s.name === "export"));
  assert(t.endpoint.stages.some((s: any) => s.name === "review"));
  assert.equal(t.endpoint.yields(), 0);
  assert.equal(t.app.rejectionState().activePayment, id);
});

for (const change of [
  "signed",
  "replaced-attempt",
  "restored-ambiguity",
  "record-updated",
] as const)
  test(`queued initial denial retains a concurrently ${change} payment`, async () => {
    let concurrent: any;
    const t = await setup(journal(), {
      beforeMutate(_n, c) {
        if (!c.deniedAtReview || concurrent) return;
        const j = structuredClone(c.rows.get(owner)),
          p = j.payments[0];
        if (change === "signed")
          wallet.transitionPayment(j, id, "signed", {
            rawTx: f.rawTx,
            txid: f.txid,
          });
        if (change === "replaced-attempt")
          p.signingAttempt = {
            id: "11111111-1111-4111-8111-111111111111",
            recovery: false,
          };
        if (change === "restored-ambiguity") delete p.signingAttempt;
        if (change === "record-updated")
          p.lastError = "Another tab updated the record";
        wallet.validateStoredJournal(j);
        c.rows.set(owner, structuredClone(j));
        concurrent = structuredClone(j);
      },
    });
    await t.event("sign");
    assert(concurrent, "Rejection never reached the atomic journal boundary");
    assert.deepEqual(t.saved(), concurrent);
    assert.equal(
      wallet.reservedOutpoints(t.saved()).size,
      bundle.inputs.length,
    );
    assert.equal(t.endpoint.yields(), 0);
    assert.equal(t.app.rejectionState().activePayment, id);
    assert.deepEqual(t.c.requests, ["/api/check"]);
  });

for (const failure of [
  "transport",
  "before-first",
  "partial",
  "partial-cancel",
] as const)
  test(`${failure} without a complete verified app result releases a fresh initial attempt`, async () => {
    const t = await setup(journal(), { failure }),
      before = t.saved();
    await t.event("sign");
    assert.equal(t.saved().payments.length, 0);
    assert.equal(wallet.reservedOutpoints(t.saved()).size, 0);
    assert.equal(t.saved().nextChangeIndex, before.nextChangeIndex);
    assert.equal(t.saved().issuedReceiveThrough, before.issuedReceiveThrough);
    assert.equal(t.app.rejectionState().emergency, null);
    assert.equal(t.app.rejectionState().activePayment, null);
    assert.deepEqual(t.c.requests, ["/api/check"]);
    assert.equal(t.endpoint.acknowledgements(), 0);
    assert.deepEqual(
      t.c.signatureResponses,
      ["partial", "partial-cancel"].includes(failure) ? [0] : [],
    );
    const reload = await setup(t.saved());
    assert.equal(reload.saved().payments.length, 0);
    assert.equal(wallet.reservedOutpoints(reload.saved()).size, 0);
    assert.equal(reload.saved().nextChangeIndex, before.nextChangeIndex);
    assert.equal(
      reload.saved().issuedReceiveThrough,
      before.issuedReceiveThrough,
    );
  });

test("an unclassified UI-boundary failure has no adapter result proof and cannot unlock", async () => {
  const t = await setup();
  t.app.unclassifiedFailure();
  await t.event("sign");
  assert.equal(t.saved().payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(t.saved()).size, bundle.inputs.length);
});

for (const failure of ["partial", "partial-cancel"] as const)
  test(`${failure} during historical recovery retains every old reservation`, async () => {
    const t = await setup(journal(true), { failure });
    await t.event("recover-signing");
    assert.equal(t.saved().payments[0].state, "signing");
    assert.equal(
      wallet.reservedOutpoints(t.saved()).size,
      bundle.inputs.length,
    );
    assert.equal(t.saved().payments[0].signingAttempt.recovery, true);
    assert.equal(t.saved().payments[0].rawTx, undefined);
  });

test("complete verified result with failed durable callback remains recoverable and reserved", async () => {
  const t = await setup(journal(), { failure: "none", failSignedCommit: true });
  await t.event("sign");
  assert.equal(t.saved().payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(t.saved()).size, bundle.inputs.length);
  const recovery = t.app.rejectionState().emergency;
  assert(recovery && !recovery.pending);
  assert.equal(
    wallet.importWalletBackup(recovery.text).journal.payments[0].rawTx,
    f.rawTx,
  );
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.deepEqual(t.c.requests, ["/api/check"]);
});

test("complete result carried by the adapter before UI staging is preserved before any cleanup", async () => {
  const t = await setup();
  t.app.completeBeforeStage(
    f.signatures.map((value: string) => sdk.fromHex(value)),
  );
  await t.event("sign");
  assert.equal(t.saved().payments[0].state, "signing");
  assert.equal(wallet.reservedOutpoints(t.saved()).size, bundle.inputs.length);
  const recovery = t.app.rejectionState().emergency;
  assert(recovery && !recovery.pending);
  assert.equal(
    wallet.importWalletBackup(recovery.text).journal.payments[0].rawTx,
    f.rawTx,
  );
  assert.deepEqual(t.c.requests, ["/api/check"]);
});

for (const failure of ["ack", "late-final-race"] as const)
  test(`${failure}: complete verified bytes survive and are never released or broadcast`, async () => {
    const t = await setup(journal(), { failure });
    await t.event("sign");
    const saved = t.saved().payments[0];
    assert.equal(saved.state, "signed");
    assert.equal(saved.rawTx, f.rawTx);
    assert.equal(saved.txid, f.txid);
    assert.equal(
      wallet.reservedOutpoints(t.saved()).size,
      bundle.inputs.length,
    );
    assert.deepEqual(t.c.requests, ["/api/check"]);
    if (failure === "late-final-race") {
      assert.equal(t.c.finalCancellationObserved, true);
      assert.equal(t.endpoint.acknowledgements(), 0);
    }
  });

function portfolioHeadline(html: string) {
  const match = /<div class="balance">([^<]+)<small>PRL<\/small>/.exec(html);
  assert(match, "Portfolio headline missing");
  return match[1];
}
test("portfolio total stays unchanged by an unsigned reservation and never calls it network pending", async () => {
  const t = await setup();
  t.app.rejectionOverview();
  const expected = sdk.formatPrl(
    bundle.inputs.reduce((total, input) => total + input.amount, 0n),
  );
  assert.equal(portfolioHeadline(t.dom.innerHTML), expected);
  assert.match(t.dom.innerHTML, />Balance<\/p>/);
  assert.doesNotMatch(
    t.dom.innerHTML,
    /in pending payments|reserved for payment/,
  );
  assert.equal(t.app.rejectionBalances().available, 0n);
  assert.equal(wallet.reservedOutpoints(t.saved()).size, bundle.inputs.length);
  const released = t.saved();
  wallet.discardDraft(released, id);
  const withoutReservation = await setup(released);
  withoutReservation.app.rejectionOverview();
  assert.equal(portfolioHeadline(withoutReservation.dom.innerHTML), expected);
  assert.equal(
    withoutReservation.app.rejectionBalances().available,
    bundle.inputs.reduce((total, input) => total + input.amount, 0n),
  );
  assert.equal(t.c.requests.length, 0);
  assert.equal(withoutReservation.c.requests.length, 0);
});

test("portfolio includes source-reported unconfirmed own change while Send still rejects it", async () => {
  const t = await setup(wallet.emptyJournal());
  const snapshot = t.app.pendingChangeView(50_000n);
  assert.equal(portfolioHeadline(t.dom.innerHTML), "0.00050000");
  assert.match(t.dom.innerHTML, /0\.00050000 PRL unconfirmed/);
  assert.equal(t.app.rejectionBalances().total, 50_000n);
  assert.equal(t.app.rejectionBalances().available, 0n);
  assert.throws(
    () =>
      wallet.preparePayment(snapshot, {
        selected: [wallet.outpoint(snapshot.coins[0])],
        recipient: sdk.deriveAddress(account, 0, 1).address,
        amountPrl: "0.00010000",
        feePrl: "0.00000154",
        changeIndex: 1,
      }),
    /unconfirmed or immature/,
  );
  assert.equal(t.c.requests.length, 0);
  assert.equal(t.endpoint.commands.length, 0);
});

for (const recovery of [false, true])
  for (const failure of ["abort", "read-failure"] as const)
    test(`post-commit ${failure} before adapter invocation ${recovery ? "retains recovery" : "releases initial attempt"}`, async () => {
      const start = journal(recovery);
      const t = await setup(start, {
        beforeRead(c) {
          if (c.commits !== 1 || c.gapInjected) return;
          c.gapInjected = true;
          assert.equal(c.rows.get(owner).payments[0].state, "signing");
          if (failure === "abort") c.nodes.get("cancel-device").click();
          else
            throw Error("Fixture journal refresh failed after signing commit");
        },
      });
      await t.event(recovery ? "recover-signing" : "sign");
      assert.equal(t.c.gapInjected, true);
      assert.equal(
        t.endpoint.commands.length,
        0,
        "A device APDU occurred before the tested gap",
      );
      const saved = t.saved();
      assert.equal(saved.nextChangeIndex, start.nextChangeIndex);
      assert.equal(saved.issuedReceiveThrough, start.issuedReceiveThrough);
      if (recovery) {
        assert.equal(saved.payments[0].state, "signing");
        assert.equal(saved.payments[0].signingAttempt.recovery, true);
        assert.equal(
          wallet.reservedOutpoints(saved).size,
          bundle.inputs.length,
        );
      } else {
        assert.equal(saved.payments.length, 0);
        assert.equal(wallet.reservedOutpoints(saved).size, 0);
        assert.equal(t.app.rejectionState().activePayment, null);
      }
      assert.deepEqual(t.c.requests, ["/api/check"]);
    });

test("post-commit pre-adapter cancellation cannot erase a concurrent record update", async () => {
  let concurrent: any;
  const t = await setup(journal(), {
    beforeRead(c) {
      if (c.commits !== 1 || c.gapInjected) return;
      c.gapInjected = true;
      const j = structuredClone(c.rows.get(owner));
      j.payments[0].lastError = "Another tab changed the signing record";
      wallet.validateStoredJournal(j);
      c.rows.set(owner, structuredClone(j));
      concurrent = structuredClone(j);
      c.nodes.get("cancel-device").click();
    },
  });
  await t.event("sign");
  assert(concurrent);
  assert.deepEqual(t.saved(), concurrent);
  assert.equal(t.endpoint.commands.length, 0);
  assert.equal(wallet.reservedOutpoints(t.saved()).size, bundle.inputs.length);
});
