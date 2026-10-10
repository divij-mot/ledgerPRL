/** Actual main.ts + SDK/wallet/fee/cache logic. Only DOM, storage, transport and
 * QR decoding boundaries are mocked. Public fixtures only; no external network. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as sdk from "../../packages/sdk/src/index.ts";
import * as wallet from "../../packages/wallet/src/index.ts";
import {
  rawTransaction,
  snapshotFixture,
} from "../../packages/wallet/test/fixtures.ts";
import { accountCache } from "../../apps/companion/src/account-cache.ts";
import {
  FEE_QUOTE_LIFETIME_MS,
  parseFeeQuote,
} from "../../apps/companion/src/fee-quotes.ts";
Error.stackTraceLimit = 3;
const directory = fileURLToPath(
  new URL("../../apps/companion/src/", import.meta.url),
);
const appended = `
export async function auditMount(s,complete=true){account=s.account;network=account.network;accountIndex=account.account;sourceMode='public';privacyConsent=true;snapshot=s;syncComplete=complete;page='send';sendStep=1;selected.clear();manualSelection=false;maxAmount=false;feeSelection='standard';Object.assign(form,{recipient:deriveAddress(account,0,7).address,amount:'0.00008000',fee:'0.00001000',changeIndex:'0'});await refreshJournal();render();}
export function auditQuotes(q){feeQuotes=q;feeQuoteNetwork=network;render();}
export function auditState(){return {network,account,snapshot,validation,verifiedReceive,activePayment,syncComplete,page,sendStep,busy,notification,feeSelection,feeQuotes,feeTime:feeTime(),feeLoading:!!feeLoad,form:{...form},maxAmount,selected:[...selected],journal};}
export function auditOptions(){return feeQuoteOptions();}
export function auditRefresh(){return refreshFeeQuotes(true);}
export function auditRender(){render();}
export function auditPage(p,step=0){page=p;sendStep=step;render();}
export function auditOwner(a){account=a;network=a.network;}
export function auditReadyDevice(){client={sessionState:'ready',async signBundle(){globalThis.hostedReview.signCalls++;throw Error('Unexpected device call');}};}
export function auditPayment(id){activePayment=id;page='send';render();}
export function auditBusy(value){busy=value;}
`;
const output = await build({
  stdin: {
    contents: readFileSync(directory + "main.ts", "utf8") + appended,
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
      name: "hosted-review-boundaries",
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(device|storage|qr-reader)\.js$/ },
          (a) => ({ path: a.path, namespace: "review" }),
        );
        b.onLoad({ filter: /.*/, namespace: "review" }, (a) => ({
          loader: "js",
          resolveDir: directory,
          contents: a.path.includes("device")
            ? `export async function connectLedger(){throw Error('No real device permitted');}`
            : a.path.includes("qr-reader")
              ? `export {parsePaymentQr} from ${JSON.stringify(directory + "qr-reader.ts")};export async function readQrImage(file,signal){return globalThis.hostedReview.qrRead(signal);}export async function scanCamera(video,signal){return globalThis.hostedReview.qrRead(signal);}`
              : `
 export class WatchStorage{constructor(){this.c=globalThis.hostedReview;}async journal(k){await this.c.hook?.('read',k);return structuredClone(this.c.rows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0});}
 async mutate(k,update){await this.c.hook?.('before-update',k);const j=structuredClone(this.c.rows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0});const v=update(j);await this.c.hook?.('before-commit',k,j);this.c.rows.set(k,structuredClone(j));await this.c.hook?.('after-commit',k,j);return v;}
 async load(k){const v=structuredClone(this.c.cache.get(k));await this.c.hook?.('load',k);return v;}async save(k,v){this.c.cache.set(k,structuredClone(v));}async removeSavedSnapshot(){this.c.cache.delete('last-snapshot');}}
 `,
        }));
      },
    },
  ],
});
const moduleUrl =
  "data:text/javascript;base64," +
  Buffer.from(output.outputFiles[0]!.text).toString("base64");
let serial = 0;
function gate() {
  let open!: (value?: any) => void;
  const promise = new Promise<any>((r) => (open = r));
  return { promise, open };
}
async function until(check: () => boolean) {
  const stop = performance.now() + 5000;
  while (!check()) {
    assert(performance.now() < stop, "Review boundary not reached");
    await new Promise((r) => setImmediate(r));
  }
}
function watch(amounts = [10_000n, 9_000n]) {
  return wallet.parseWatchSnapshot(
    JSON.stringify(
      snapshotFixture(
        amounts.map((v, i) => rawTransaction(v, i)),
        200,
        "mainnet",
      ),
    ),
  );
}
const rates = () => [
  parseFeeQuote({ result: "0.00005" }, 1, "mainnet"),
  parseFeeQuote({ result: "0.00002" }, 10, "mainnet"),
  parseFeeQuote({ result: "0.00001" }, 25, "mainnet"),
];
async function setup(
  location: { protocol?: string; pathname?: string } | null = {
    protocol: "https:",
    pathname: "/",
  },
) {
  const c: any = {
    rows: new Map(),
    cache: new Map(),
    nodes: new Map(),
    nav: [],
    requests: [],
    signCalls: 0,
    hook: undefined,
    fetchHook: undefined,
    documentListeners: new Map(),
    qrRead: async () => {
      throw Error("No QR fixture");
    },
  };
  const dom = {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value: string) {
      this._html = value;
      c.nodes.clear();
      c.nav = [];
      for (const tag of value.matchAll(/<[^>]+>/g)) {
        const text = tag[0],
          id = /\bid="([^"]+)"/.exec(text)?.[1],
          nav = /\bdata-nav="([^"]+)"/.exec(text)?.[1];
        if (!id && !nav) continue;
        const name = /^<([a-zA-Z0-9-]+)/.exec(text)?.[1],
          bodyStart = tag.index! + text.length,
          bodyEnd = value.indexOf(`</${name}>`, bodyStart),
          body = bodyEnd < 0 ? "" : value.slice(bodyStart, bodyEnd);
        const children = [...body.matchAll(/\bid="([^"]+)"/g)].map(
          (match) => match[1]!,
        );
        let nodeText = body.replace(/<[^>]*>/g, "");
        const el: any = {
          disabled: /\sdisabled(?:[\s=>])/.test(text),
          value: /\bvalue="([^"]*)"/.exec(text)?.[1] ?? "",
          checked: /\schecked(?:[\s=>])/.test(text),
          dataset: nav ? { nav } : {},
          get textContent() {
            return nodeText;
          },
          set textContent(next: string) {
            nodeText = String(next);
            // Match the real DOM: replacing parent text destroys its descendants.
            for (const child of children) c.nodes.delete(child);
          },
          addEventListener(type: string, fn: Function) {
            this[type] = fn;
          },
          setAttribute() {},
          focus() {},
          setSelectionRange() {},
        };
        if (id) c.nodes.set(id, el);
        if (nav) c.nav.push(el);
      }
    },
  };
  Object.assign(globalThis, {
    hostedReview: c,
    document: {
      visibilityState: "visible",
      addEventListener: (type: string, listener: Function) =>
        c.documentListeners.set(type, listener),
      querySelector: () => dom,
      querySelectorAll: (q: string) => (q === "[data-nav]" ? c.nav : []),
      getElementById: (id: string) => c.nodes.get(id) ?? null,
      activeElement: null,
    },
    window: {
      ...(location ? { location } : {}),
      addEventListener() {},
    },
    BroadcastChannel: class {
      postMessage() {}
    },
    fetch: async (route: string, options: any) => {
      const body = JSON.parse(options.body);
      c.requests.push({ route, body });
      if (c.fetchHook) await c.fetchHook(body, options.signal);
      assert.equal(route, "/api/indexer/read");
      let data: unknown;
      if (body.path === "/api/v2/")
        data = {
          blockbook: {
            inSync: true,
            initialSync: false,
            inSyncMempool: true,
            bestHeight: 200,
            decimals: 8,
          },
          backend: {
            chain: "mainnet",
            blocks: 200,
            bestBlockHash: "aa".repeat(32),
          },
        };
      else if (body.path.startsWith("/api/v2/block-index/"))
        data = {
          blockHash: body.path.endsWith("/0")
            ? sdk.NETWORKS.mainnet.genesisHash
            : "aa".repeat(32),
        };
      else if (/^\/api\/v1\/estimatefee\/(1|10|25)$/.test(body.path))
        data = {
          result: body.path.endsWith("/1")
            ? "0.00005"
            : body.path.endsWith("/10")
              ? "0.00002"
              : "0.00001",
        };
      else throw Error("No account lookup permitted by this fixture");
      return Response.json(data);
    },
  });
  const app: any = await import(moduleUrl + "#" + serial++);
  const event = (id: string, type = "click", value?: any) => {
    const el = c.nodes.get(id);
    assert(el, `Missing control ${id}`);
    assert(!el.disabled, `Disabled control ${id}`);
    const target = type === "input" ? { value } : value;
    el[type](target ? { target } : undefined);
  };
  const settle = async () => {
    await until(() => !app.auditState().busy);
    await new Promise((r) => setImmediate(r));
  };
  return { c, app, dom, event, settle };
}

test("standalone and Discover entry routes default to mainnet without starting wallet operations", async () => {
  const cases: [{ protocol?: string; pathname?: string } | null, string][] = [
    ...["http:", "https:"].flatMap((protocol) =>
      ["/", "/index.html", "/live.html"].map(
        (pathname) =>
          [{ protocol, pathname }, "mainnet"] as [
            { protocol: string; pathname: string },
            string,
          ],
      ),
    ),
    [{ protocol: "http:", pathname: "/development" }, "regtest"],
    [{ protocol: "https:", pathname: "/development" }, "mainnet"],
    [{ protocol: "http:" }, "regtest"],
    [null, "regtest"],
  ];
  for (const [location, expected] of cases) {
    const t = await setup(location),
      state = t.app.auditState();
    assert.equal(state.network, expected, JSON.stringify(location));
    assert.equal(state.account, null);
    assert.equal(state.validation, null);
    assert.equal(state.syncComplete, false);
    assert.equal(t.c.signCalls, 0);
    assert.equal(t.c.requests.length, 0);
  }
});

test("a nonzero local mainnet account is labeled as public network health", async () => {
  const t = await setup({ protocol: "http:", pathname: "/index.html" });
  assert.match(t.dom.innerHTML, /Local blockchain sync/);
  t.app.auditOwner({ ...watch().account, account: 1 });
  t.app.auditRender();
  assert.match(t.dom.innerHTML, /Pearl public network:/);
  assert.match(t.dom.innerHTML, /Public network: not verified/);
  assert.doesNotMatch(t.dom.innerHTML, /Local blockchain sync/);
  assert.equal(t.c.requests.length, 0);
  assert.equal(t.c.signCalls, 0);
});

test("default applies live Medium, exposes Fast/Slow with automatic inputs, and labels fallback honestly", async () => {
  const t = await setup();
  await t.app.auditMount(watch());
  assert.equal(t.app.auditState().form.fee, "0.00000154");
  assert.equal(t.app.auditState().feeTime, "Unavailable");
  t.app.auditQuotes(rates());
  assert.equal(t.app.auditState().form.fee, "0.00000308");
  assert.equal(t.app.auditState().feeTime, "≈32 min");
  assert(t.app.auditOptions().every((q: any) => !q.disabled));
  assert.deepEqual(t.app.auditState().selected, []);
  t.event("fee-target-1");
  assert.equal(t.app.auditState().form.fee, "0.00000770");
  t.event("fee-target-25");
  assert.equal(t.app.auditState().form.fee, "0.00000154");
  assert.equal(t.app.auditState().form.amount, "0.00008000");
  assert.equal(t.c.rows.size, 0);
});

test("Max reprices recipient for a higher live rate and an exact custom total", async () => {
  const t = await setup();
  await t.app.auditMount(watch());
  t.app.auditQuotes(rates());
  t.event("send-max");
  await t.settle();
  const start = t.app.auditState();
  assert.equal(start.form.fee, "0.00000338");
  assert.equal(start.form.amount, "0.00018662");
  t.event("fee-target-1");
  assert.equal(t.app.auditState().form.fee, "0.00000845");
  assert.equal(t.app.auditState().form.amount, "0.00018155");
  t.event("fee-custom");
  t.event("fee", "input", "0.00001000");
  assert.equal(t.app.auditState().form.amount, "0.00018000");
  assert.equal(t.app.auditState().form.fee, "0.00001000");
  t.event("prepare");
  await t.settle();
  const saved = t.app.auditState().journal.payments[0];
  assert(saved, t.app.auditState().notification);
  const b = wallet.paymentBundle(saved);
  assert.equal(b.outputs.length, 1);
  assert.equal(b.outputs[0]!.amount, 18_000n);
  assert.equal(sdk.validateBundle(b).fee, 1000n);
});

test("new reservation and dust cannot silently reprice or reserve a draft", async () => {
  const t = await setup(),
    s = watch([10_000n, 5000n, 4000n]);
  await t.app.auditMount(s);
  const entered = gate(),
    release = gate();
  t.c.hook = async (phase: string) => {
    if (phase === "before-update") {
      entered.open();
      await release.promise;
    }
  };
  t.event("prepare");
  await entered.promise;
  const existing = wallet.emptyJournal(),
    b = wallet.preparePayment(s, {
      selected: [wallet.outpoint(s.coins[0]!)],
      recipient: sdk.deriveAddress(s.account, 0, 8).address,
      amountPrl: "0.00009",
      feePrl: "0.00001",
      changeIndex: 0,
    });
  wallet.reservePayment(existing, b, "other-tab-draft");
  t.c.rows.set(wallet.accountId(s.account), existing);
  release.open();
  await t.settle();
  assert.equal(t.app.auditState().journal.payments.length, 1);
  assert.equal(t.app.auditState().journal.payments[0].id, "other-tab-draft");
  assert.match(t.app.auditState().notification, /Fee changed/);
  const u = await setup();
  await u.app.auditMount(watch([10_000n]));
  u.event("fee-custom");
  u.event("amount", "input", "0.00009");
  u.event("fee", "input", "0.000009");
  u.event("prepare");
  await u.settle();
  assert.equal(u.app.auditState().journal.payments.length, 0);
  assert.match(u.app.auditState().notification, /change is too small/);
});

test("explicit quote expiring while the journal queues cannot create a draft", async () => {
  const t = await setup();
  await t.app.auditMount(watch());
  const now = Date.now(),
    quotes = rates();
  t.app.auditQuotes(quotes);
  t.event("fee-target-1");
  const entered = gate(),
    release = gate();
  t.c.hook = async (phase: string) => {
    if (phase === "before-update") {
      entered.open();
      await release.promise;
    }
  };
  t.event("prepare");
  await entered.promise;
  const old = Date.now;
  Date.now = () => now + FEE_QUOTE_LIFETIME_MS + 100;
  try {
    release.open();
    await t.settle();
    assert.equal(t.app.auditState().journal.payments.length, 0);
    assert.match(t.app.auditState().notification, /expired|changed/i);
  } finally {
    Date.now = old;
  }
});

test("late quotes leave a prepared payment and its signed authorization fields unchanged", async () => {
  const t = await setup();
  await t.app.auditMount(watch());
  // An explicit custom total may be prepared while anonymous quotes load.
  t.event("fee-custom");
  const entered = gate(),
    release = gate();
  t.c.fetchHook = async () => {
    entered.open();
    await release.promise;
  };
  const refreshing = t.app.auditRefresh();
  await entered.promise;
  t.event("prepare");
  await t.settle();
  const original = JSON.stringify(t.app.auditState().journal),
    id = t.app.auditState().activePayment;
  assert(id);
  release.open();
  await refreshing;
  assert.equal(JSON.stringify(t.app.auditState().journal), original);
  assert.equal(t.app.auditState().activePayment, id);
  assert.equal(t.c.signCalls, 0);
});

test("late fee response for a replaced account cannot install rates or rewrite form", async () => {
  const t = await setup(),
    s = watch();
  await t.app.auditMount(s);
  const entered = gate(),
    release = gate();
  t.c.fetchHook = async () => {
    entered.open();
    await release.promise;
  };
  const refreshing = t.app.auditRefresh();
  await entered.promise;
  const foreign = { ...s.account, chainCode: new Uint8Array(32).fill(9) };
  t.app.auditOwner(foreign);
  const before = t.app.auditState().form;
  release.open();
  await refreshing;
  assert.deepEqual(t.app.auditState().feeQuotes, []);
  assert.deepEqual(t.app.auditState().form, before);
  assert.equal(t.c.rows.size, 0);
});

test("QR amount supersedes earlier Max and never prepares or signs", async () => {
  const t = await setup(),
    s = watch();
  await t.app.auditMount(s);
  t.event("send-max");
  await t.settle();
  assert(t.app.auditState().maxAmount);
  t.app.auditPage("send", 0);
  const address = sdk.deriveAddress(s.account, 0, 9).address;
  t.c.qrRead = async () => `pearl:${address}?amount=0.00002`;
  t.event("recipient-qr-file", "change", { files: [{}] });
  await t.settle();
  assert.equal(t.app.auditState().form.recipient, address);
  assert.equal(t.app.auditState().form.amount, "0.00002");
  assert.equal(t.app.auditState().maxAmount, false);
  assert.equal(t.app.auditState().sendStep, 0);
  assert.equal(t.c.rows.size, 0);
  assert.equal(t.c.signCalls, 0);
});

test("cancelled late QR result cannot replace recipient or create a payment", async () => {
  const t = await setup(),
    s = watch();
  await t.app.auditMount(s);
  t.app.auditPage("send", 0);
  const before = t.app.auditState().form,
    entered = gate(),
    release = gate();
  t.c.qrRead = async () => {
    entered.open();
    return release.promise;
  };
  t.event("recipient-qr-file", "change", { files: [{}] });
  await entered.promise;
  t.event("cancel-device");
  release.open(sdk.deriveAddress(s.account, 0, 9).address);
  await t.settle();
  assert.deepEqual(t.app.auditState().form, before);
  assert.equal(t.c.rows.size, 0);
  assert.equal(t.c.signCalls, 0);
});

test("hosted cached view restores no validation or device approval and cannot sign without a fresh source", async () => {
  const t = await setup(),
    s = watch(),
    owner = wallet.accountId(s.account);
  t.c.cache.set("last-public-account", {
    account: sdk.accountToJson(s.account),
    consent: false,
  });
  t.c.cache.set(`account-view:${owner}`, accountCache(s, []));
  await t.app.restoreSavedAccount();
  assert.equal(t.app.auditState().syncComplete, false);
  assert.equal(t.app.auditState().validation, null);
  assert.equal(t.app.auditState().verifiedReceive, null);
  assert.match(t.dom.innerHTML, /Last synced balance/);
  assert.equal(
    t.c.nav.find((e: any) => e.dataset.nav === "send").disabled,
    true,
  );
  const j = wallet.emptyJournal(),
    b = wallet.preparePayment(s, {
      selected: [wallet.outpoint(s.coins[0]!)],
      recipient: sdk.deriveAddress(s.account, 0, 7).address,
      amountPrl: "0.00008",
      feePrl: "0.00001",
      changeIndex: 0,
    });
  wallet.reservePayment(j, b, "cached-draft");
  t.c.rows.set(owner, j);
  await t.app.auditMount(s, false);
  t.app.auditPayment("cached-draft");
  t.app.auditReadyDevice();
  t.app.auditRender();
  t.c.fetchHook = async () => {
    throw Error("Fresh source unavailable");
  };
  t.event("sign");
  await t.settle();
  assert.equal(t.c.signCalls, 0);
  assert.equal(t.app.auditState().journal.payments[0].state, "draft");
  assert.equal(wallet.reservedOutpoints(t.app.auditState().journal).size, 1);
});

test("a delayed cached view cannot reopen an account after its actual Close handler completes", async () => {
  const t = await setup(),
    s = watch(),
    owner = wallet.accountId(s.account),
    entered = gate(),
    release = gate();
  t.c.cache.set("last-public-account", {
    account: sdk.accountToJson(s.account),
    consent: false,
  });
  t.c.cache.set(`account-view:${owner}`, accountCache(s, []));
  t.c.hook = async (phase: string, key: string) => {
    if (phase === "load" && key.startsWith("account-view:")) {
      entered.open();
      await release.promise;
    }
  };
  const restore = t.app.restoreSavedAccount();
  await entered.promise;
  t.app.auditRender();
  t.event("disconnect");
  await t.settle();
  assert.equal(t.app.auditState().account, null);
  release.open();
  await restore;
  assert.equal(t.app.auditState().account, null);
  assert.equal(t.app.auditState().snapshot, null);
  assert.equal(t.c.cache.get("last-public-account"), null);
});

function controlledClock(t: any) {
  let now = Date.now(),
    serial = 0;
  const oldNow = Date.now,
    oldSet = globalThis.setTimeout,
    oldClear = globalThis.clearTimeout;
  const timers = new Map<
    any,
    { due: number; callback: Function; args: unknown[]; unref: boolean }
  >();
  Date.now = () => now;
  globalThis.setTimeout = ((
    callback: Function,
    delay = 0,
    ...args: unknown[]
  ) => {
    const id = {
      serial: ++serial,
      unref() {
        const timer = timers.get(id);
        if (timer) timer.unref = true;
      },
    };
    timers.set(id, {
      due: now + Math.max(0, Number(delay)),
      callback,
      args,
      unref: false,
    });
    return id;
  }) as unknown as typeof setTimeout;
  globalThis.clearTimeout = ((id: any) => {
    if (!timers.delete(id)) oldClear(id);
  }) as typeof clearTimeout;
  t.after(() => {
    timers.clear();
    Date.now = oldNow;
    globalThis.setTimeout = oldSet;
    globalThis.clearTimeout = oldClear;
  });
  return {
    remaining: () => [...timers.values()].map((timer) => timer.due - now),
    unreferenced: () => [...timers.values()].every((timer) => timer.unref),
    async advance(ms: number) {
      const target = now + ms;
      let steps = 0;
      for (;;) {
        const next = [...timers]
          .filter(([, timer]) => timer.due <= target)
          .sort((a, b) => a[1].due - b[1].due)[0];
        if (!next) break;
        assert(++steps < 100, "Fee scheduler exceeded bounded callback budget");
        now = next[1].due;
        timers.delete(next[0]);
        next[1].callback(...next[1].args);
        await new Promise((resolve) => setImmediate(resolve));
      }
      now = target;
      await new Promise((resolve) => setImmediate(resolve));
    },
  };
}

function visibility(
  t: Awaited<ReturnType<typeof setup>>,
  value: "hidden" | "visible",
) {
  Object.defineProperty(document, "visibilityState", {
    value,
    configurable: true,
  });
  t.c.documentListeners.get("visibilitychange")?.();
}

test("fresh ETAs remain on equal-rate Medium/Slow choices; expired ETAs become Unavailable", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  const quotes = rates();
  quotes[2]!.grainsPerKvB = quotes[1]!.grainsPerKvB;
  c.app.auditQuotes(quotes);
  const choices = c.app.auditOptions();
  assert.deepEqual(
    choices.map((q: any) => q.blocks),
    [1, 10, 25],
  );
  assert.equal(choices[1].feePrl, choices[2].feePrl);
  assert.deepEqual(
    choices.map((q: any) => q.time),
    ["≈3 min", "≈32 min", "≈1 h 21 min"],
  );
  assert.equal(c.app.auditState().feeTime, "≈32 min");
  c.event("fee-target-25");
  assert.equal(c.app.auditState().feeTime, "≈1 h 21 min");
  await clock.advance(FEE_QUOTE_LIFETIME_MS + 1);
  c.app.auditRender();
  assert.equal(c.app.auditState().feeTime, "Unavailable");
  assert(
    c.app.auditOptions().every((q: any) => q.disabled && q.time === undefined),
  );
  assert.equal(c.c.requests.length, 0);
});

test("visible amount screen refreshes one anonymous batch at 105 seconds with an unreferenced timer", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  await c.app.auditRefresh();
  assert.equal(c.c.requests.length, 6);
  assert.deepEqual(clock.remaining(), [105_000]);
  assert(clock.unreferenced());
  await clock.advance(104_999);
  assert.equal(c.c.requests.length, 6);
  await clock.advance(1);
  await until(() => !c.app.auditState().feeLoading);
  assert.equal(c.c.requests.length, 12);
  assert.deepEqual(clock.remaining(), [105_000]);
  assert(clock.unreferenced());
  assert(
    c.c.requests.every((r: any) =>
      /^\/api\/(?:v2\/(?:|block-index\/[0-9]+)|v1\/estimatefee\/(?:1|10|25))$/.test(
        r.body.path,
      ),
    ),
  );
  assert.equal(c.c.rows.size, 0);
  assert.equal(c.c.signCalls, 0);
});

test("amount input cannot postpone the already scheduled pre-expiry refresh", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  await c.app.auditRefresh();
  await clock.advance(104_000);
  c.event("amount", "input", "0.00008100");
  await clock.advance(6000);
  c.event("amount", "input", "0.00008200");
  await clock.advance(10_000);
  await until(() => !c.app.auditState().feeLoading);
  assert.equal(
    c.c.requests.length,
    12,
    "Input activity postponed refresh beyond quote expiry",
  );
  assert.equal(c.c.rows.size, 0);
});

test("hidden amount screen stops its polling and visibility return makes one cache-aware refresh", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  await c.app.auditRefresh();
  visibility(c, "hidden");
  await clock.advance(400_000);
  assert.equal(c.c.requests.length, 6);
  assert.deepEqual(clock.remaining(), []);
  visibility(c, "visible");
  await until(() => !c.app.auditState().feeLoading);
  assert.equal(c.c.requests.length, 12);
  visibility(c, "visible");
  await new Promise((r) => setImmediate(r));
  assert.equal(c.c.requests.length, 12);
});

for (const [page, step] of [
  ["overview", 0],
  ["receive", 0],
  ["send", 0],
] as const)
  test(`fee scheduler stops outside the amount screen: ${page}/${step}`, async (t) => {
    const c = await setup(),
      clock = controlledClock(t);
    await c.app.auditMount(watch());
    await c.app.auditRefresh();
    c.app.auditPage(page, step);
    const before = c.app.auditState().form;
    await clock.advance(400_000);
    assert.equal(c.c.requests.length, 6);
    assert.deepEqual(clock.remaining(), []);
    assert.deepEqual(c.app.auditState().form, before);
    assert.equal(c.c.rows.size, 0);
  });

test("fee timer never refreshes or reprices a prepared review", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  await c.app.auditRefresh();
  c.event("prepare");
  await c.settle();
  const before = JSON.stringify(c.app.auditState().journal),
    id = c.app.auditState().activePayment;
  assert(id);
  await clock.advance(400_000);
  assert.equal(c.c.requests.length, 6);
  assert.deepEqual(clock.remaining(), []);
  assert.equal(JSON.stringify(c.app.auditState().journal), before);
  assert.equal(c.app.auditState().activePayment, id);
  assert.equal(c.c.signCalls, 0);
});

test("busy device scope defers fee requests with a bounded retry rather than interrupting context", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  await c.app.auditRefresh();
  const before = c.app.auditState().form;
  c.app.auditBusy(true);
  await clock.advance(105_000);
  assert.equal(c.c.requests.length, 6);
  assert.deepEqual(clock.remaining(), [15_000]);
  await clock.advance(15_000);
  assert.equal(c.c.requests.length, 6);
  assert.deepEqual(clock.remaining(), [15_000]);
  assert.deepEqual(c.app.auditState().form, before);
  c.app.auditBusy(false);
  await clock.advance(15_000);
  await until(() => !c.app.auditState().feeLoading);
  assert.equal(c.c.requests.length, 12);
  assert.equal(c.c.rows.size, 0);
});

test("automatic Continue waits for an in-flight estimate and handler also rejects forced activation", async () => {
  const c = await setup();
  await c.app.auditMount(watch());
  const entered = gate(),
    release = gate();
  c.c.fetchHook = async () => {
    entered.open();
    await release.promise;
  };
  const pending = c.app.auditRefresh();
  await entered.promise;
  assert.equal(c.c.nodes.get("prepare").disabled, true);
  c.c.nodes.get("prepare").click();
  await c.settle();
  assert.equal(c.app.auditState().journal.payments.length, 0);
  assert.match(c.app.auditState().notification, /Wait for the fee/);
  release.open();
  await pending;
  assert.equal(c.c.nodes.get("prepare").disabled, false);
  assert.equal(c.c.signCalls, 0);
});

test("scheduled live fees cannot overwrite an exact custom fee or amount", async (t) => {
  const c = await setup(),
    clock = controlledClock(t);
  await c.app.auditMount(watch());
  c.event("fee-custom");
  c.event("fee", "input", "0.00000500");
  const before = c.app.auditState().form;
  await c.app.auditRefresh();
  assert.equal(c.c.nodes.get("prepare").disabled, false);
  await clock.advance(105_000);
  await until(() => !c.app.auditState().feeLoading);
  assert.deepEqual(c.app.auditState().form, before);
  assert.equal(c.app.auditState().feeTime, "");
  assert.equal(c.c.requests.length, 12);
  assert.equal(c.c.rows.size, 0);
});

test("amount edits update option prices without destroying their ETA children", async (t) => {
  const c = await setup();
  controlledClock(t);
  await c.app.auditMount(watch());
  await c.app.auditRefresh();
  assert.equal(c.c.nodes.get("fee-target-time-1").textContent, "≈3 min");
  assert.match(
    c.c.nodes.get("fee-target-label-1").textContent,
    /0\.00000770 PRL/,
  );
  c.event("amount", "input", "0.00015000");
  assert.match(
    c.c.nodes.get("fee-target-label-1")?.textContent ?? "",
    /0\.00001060 PRL/,
  );
  assert.equal(c.c.nodes.get("fee-target-time-1")?.textContent, "≈3 min");
  assert.equal(c.c.nodes.get("fee-target-time-10")?.textContent, "≈32 min");
  assert.equal(c.c.nodes.get("fee-target-time-25")?.textContent, "≈1 h 21 min");
  assert.equal(c.c.nodes.get("fee-target-1").disabled, false);
  assert.equal(c.c.requests.length, 6);
  assert.equal(c.c.rows.size, 0);
});
