/** Independent host-only regression checks. Runs actual main.ts/PSBT adapter in
 * an in-memory bundle with explicit DOM, storage and endpoint substitutes.
 * Public frozen signatures only; no browser, HID, HTTP, native code or signing keys. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as sdk from "../../packages/sdk/src/index.ts";
import * as wallet from "../../packages/wallet/src/index.ts";
import {
  createPsbtEndpoint,
  publicFixture as fixture,
  ok,
} from "../../apps/companion/test/psbt-endpoint.mjs";

Error.stackTraceLimit = 5;
const owner = sdk.accountFromJson(fixture.publicAccount);
const bundle = sdk.bundleFromJson(fixture.bundle);
const ownerId = wallet.accountId(owner);
const paymentId = "independent-session-review";
const address = sdk.deriveAddress(owner, 0, 0).address;
const resolveDir = fileURLToPath(
  new URL("../../apps/companion/src/", import.meta.url),
);
const source =
  readFileSync(resolveDir + "main.ts", "utf8") +
  `
export async function mountForReview(a,b,id,t){
 account=a;network=a.network;sourceMode='node';activePayment=id;page='receive';
 snapshot={schema:1,account:a,genesisHash:NETWORKS[a.network].genesisHash,
 tip:{height:200,hash:'aa'.repeat(32)},coverage:{externalScannedThrough:19,changeScannedThrough:19,gapLimit:20},
 coins:b.inputs.map(i=>({...i,rawTransaction:'',coinbase:false,block:{height:1,hash:'bb'.repeat(32)}}))};
 transport=t;client=new LedgerBitcoinPrlClient(t,a.network);await refreshJournal();render();
}
export function stateForReview(){return {client,verifiedReceive,busy,notification,emergencySignedRecovery};}
export function pageForReview(next){page=next;render();}
export async function signForReview(){await run('Synthetic fixture review',sign);}
export async function hostFailureForReview(){await run('Synthetic host failure',async()=>{throw Error('Synthetic host failure');});}
export function abortForReview(){currentAbort?.abort();}
`;
const result = await build({
  stdin: { contents: source, resolveDir, loader: "ts" },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "explicit-host-test-boundaries",
      setup(builder) {
        builder.onResolve({ filter: /^\.\/(storage|device)\.js$/ }, (a) => ({
          path: a.path,
          namespace: "review",
        }));
        builder.onLoad({ filter: /.*/, namespace: "review" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? `export function connectLedger(){throw Error('No hardware access in review');}`
            : `
export class WatchStorage {
 constructor(){this.context=globalThis.sessionReview;}
 async journal(id){await this.context.beforeRead?.(id);return structuredClone(this.context.rows.get(id)??{schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1});}
 async mutate(id,fn){const value=await this.journal(id);const result=fn(value);await this.context.beforeCommit?.(value);this.context.rows.set(id,structuredClone(value));return result;}
}`,
        }));
      },
    },
  ],
});
const moduleUrl =
  "data:text/javascript;base64," +
  Buffer.from(result.outputFiles[0]!.text).toString("base64");
let serial = 0;
async function setup(onStage?: (stage: string, index?: number) => unknown) {
  const journal = wallet.emptyJournal();
  wallet.reservePayment(journal, bundle, paymentId, 1000);
  const context: any = {
    initialRange: journal.issuedReceiveThrough,
    rows: new Map([[ownerId, journal]]),
    nodes: new Map(),
    requests: [],
    beforeCommit: undefined,
    frames: [],
  };
  let module: any;
  const endpoint = createPsbtEndpoint({
    onStage: (stage: string, index?: number) => onStage?.(stage, index),
  });
  const dom = {
    _html: "",
    get innerHTML() {
      return this._html;
    },
    set innerHTML(value: string) {
      this._html = value;
      context.nodes.clear();
      for (const match of value.matchAll(/<[^>]+\sid="([^"]+)"[^>]*>/g)) {
        const tag = match[0];
        context.nodes.set(match[1], {
          disabled: /\sdisabled(?:\s|>)/.test(tag),
          addEventListener(event: string, handler: Function) {
            this[event] = handler;
          },
        });
      }
      context.frames.push({
        html: value,
        state: module?.stateForReview(),
        deviceState: module?.stateForReview().client?.sessionState,
      });
    },
  };
  Object.assign(globalThis, {
    sessionReview: context,
    document: {
      querySelector: () => dom,
      querySelectorAll: () => [],
      getElementById: (id: string) => context.nodes.get(id) ?? null,
    },
    window: { addEventListener() {} },
    BroadcastChannel: class {
      postMessage() {}
    },
    fetch: async (route: string, options: any) => {
      context.requests.push(route);
      assert.equal(
        route,
        "/api/check",
        "Only modeled input validation is allowed",
      );
      const body = JSON.parse(options.body);
      assert.deepEqual(body.account, sdk.accountToJson(owner));
      return new Response(
        JSON.stringify({
          network: owner.network,
          genesisHash: sdk.NETWORKS[owner.network].genesisHash,
          tip: { height: 200, hash: "aa".repeat(32) },
          checkedAt: Date.now(),
          coins: bundle.inputs.map((input) => ({
            outpoint: wallet.outpoint(input),
            state: "unspent",
            grains: String(input.amount),
            scriptPubKey: sdk.hex(input.scriptPubKey),
            coinbase: false,
            block: { height: 1, hash: "bb".repeat(32) },
            confirmations: 200,
          })),
        }),
      );
    },
  });
  module = await import(moduleUrl + "#" + serial++);
  await module.mountForReview(owner, bundle, paymentId, endpoint.transport);
  context.nodes.get("verify-receive").click();
  const until = Date.now() + 3000;
  while (module.stateForReview().busy) {
    assert(Date.now() < until, "receive did not complete");
    await new Promise((r) => setImmediate(r));
  }
  await new Promise((r) => setImmediate(r));
  assert.equal(module.stateForReview().verifiedReceive, address);
  assert.equal(context.nodes.get("copy-address").disabled, false);
  return { module, context, endpoint, dom };
}
function assertReserved(context: any) {
  const journal = context.rows.get(ownerId);
  assert.deepEqual(
    [...wallet.reservedOutpoints(journal)].sort(),
    bundle.inputs.map(wallet.outpoint).sort(),
  );
  assert.equal(
    journal.issuedReceiveThrough,
    context.initialRange,
    "Saved receive recovery range must stay retained",
  );
  assert.deepEqual(
    journal.payments[0].outpoints,
    bundle.inputs.map(wallet.outpoint),
  );
  assert.equal(
    context.requests.some((route: string) => route.includes("broadcast")),
    false,
  );
  return journal.payments[0];
}
async function assertTerminal(t: any) {
  const { module, context, endpoint, dom } = t,
    state = module.stateForReview();
  assert.equal(state.client.sessionState, "failed");
  assert.equal(state.verifiedReceive, null);
  module.pageForReview("receive");
  assert.match(
    dom.innerHTML,
    />Verify the address on your Ledger before using it\.</,
  );
  assert.doesNotMatch(dom.innerHTML, />Address verified on your Ledger\.</);
  assert.equal(context.nodes.get("copy-address").disabled, true);
  assert.equal(context.nodes.get("verify-receive").disabled, true);
  assert.match(dom.innerHTML, />Connect Ledger</);
  assert.doesNotMatch(dom.innerHTML, />Reconnect Ledger</);
  module.pageForReview("overview");
  assert.match(dom.innerHTML, />Connect Ledger</);
  assert.doesNotMatch(dom.innerHTML, />Reconnect Ledger</);
  const before = endpoint.commands.length;
  await assert.rejects(state.client.verifyAddress(owner, 0, 0), /failed/);
  await assert.rejects(state.client.signBundle(bundle, owner), /failed/);
  assert.equal(
    endpoint.commands.length,
    before,
    "A failed session must never send another APDU",
  );
  assert.equal(endpoint.closes(), 1);
  for (const frame of context.frames) {
    if (frame.deviceState === "failed") {
      assert.doesNotMatch(frame.html, />Address verified on your Ledger\.</);
      assert.doesNotMatch(frame.html, />Reconnect Ledger</);
    }
  }
}

test("Successful signing preserves same-session receive verification and exact durable payment", async () => {
  const t = await setup();
  await t.module.signForReview();
  const state = t.module.stateForReview();
  assert.equal(state.client.sessionState, "ready");
  assert.equal(state.verifiedReceive, address);
  assert.equal(t.context.nodes.get("copy-address").disabled, false);
  assert.equal(t.context.nodes.get("verify-receive").disabled, false);
  assert.match(t.dom.innerHTML, />Address verified on your Ledger\.</);
  assert.match(t.dom.innerHTML, />Reconnect Ledger</);
  const saved = assertReserved(t.context);
  assert.equal(saved.state, "signed");
  assert.equal(saved.rawTx, fixture.rawTx);
  assert.equal(saved.txid, fixture.txid);
  assert.equal(state.emergencySignedRecovery, null);
  assert.equal(t.endpoint.closes(), 0);
  assert.equal(t.endpoint.acknowledgements(), 1);
  t.module.pageForReview("overview");
  assert.match(t.dom.innerHTML, />Reconnect Ledger</);
});
for (const fault of [
  "lost",
  "rejected",
  "unexpected-payload",
  "cancelled",
] as const) {
  test(`Terminal final ACK ${fault} clears verification while retaining exact signed bytes/reservations`, async () => {
    let module: any;
    const t = await setup((stage) => {
      if (stage !== "ack") return;
      if (fault === "lost") throw Error("Synthetic lost acknowledgement");
      if (fault === "rejected") return Uint8Array.of(0x69, 0x85);
      if (fault === "unexpected-payload") return ok(Uint8Array.of(1));
      module.abortForReview();
      return ok();
    });
    module = t.module;
    await module.signForReview();
    await assertTerminal(t);
    assert.match(
      module.stateForReview().notification,
      /acknowledgement was not confirmed/,
    );
    const saved = assertReserved(t.context);
    assert.equal(saved.state, "signed");
    assert.equal(saved.rawTx, fixture.rawTx);
    assert.equal(saved.txid, fixture.txid);
    assert.equal(module.stateForReview().emergencySignedRecovery, null);
    assert.equal(t.endpoint.acknowledgements(), 1);
  });
}
test("Device rejection before signature leaves ambiguous signing reservation and clears old verification", async () => {
  const t = await setup((stage) =>
    stage === "review" ? Uint8Array.of(0x69, 0x85) : undefined,
  );
  await t.module.signForReview();
  await assertTerminal(t);
  const saved = assertReserved(t.context);
  assert.equal(saved.state, "signing");
  assert.equal(saved.rawTx, undefined);
  assert.equal(saved.txid, undefined);
  assert.equal(t.endpoint.yields(), 0);
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.equal(t.module.stateForReview().emergencySignedRecovery, null);
});
test("Signed storage failure preserves exact emergency recovery and locks, clearing old verification", async () => {
  const t = await setup();
  t.context.beforeCommit = (j: any) => {
    if (j.payments[0]?.state === "signed")
      throw Error("Synthetic storage failure");
  };
  await t.module.signForReview();
  await assertTerminal(t);
  const saved = assertReserved(t.context);
  assert.equal(saved.state, "signing");
  assert.equal(saved.rawTx, undefined);
  const emergency = t.module.stateForReview().emergencySignedRecovery;
  assert(emergency);
  assert.equal(emergency.pending, false);
  const backup = JSON.parse(emergency.text);
  assert.equal(backup.journal.payments[0].rawTx, fixture.rawTx);
  assert.equal(backup.journal.payments[0].txid, fixture.txid);
  assert.deepEqual(
    backup.journal.payments[0].outpoints,
    bundle.inputs.map(wallet.outpoint),
  );
  assert.equal(t.endpoint.yields(), bundle.inputs.length);
  assert.equal(t.endpoint.acknowledgements(), 0);
  assert.equal(
    t.context.frames.filter(
      (frame: any) =>
        frame.deviceState === "failed" &&
        />Address verified on your Ledger\.</.test(frame.html),
    ).length,
    0,
    "No render may retain the verified label after the session fails, even before a storage await",
  );
});
test("Unrelated host error does not discard valid ready-session verification", async () => {
  const t = await setup(),
    before = t.endpoint.commands.length;
  await t.module.hostFailureForReview();
  assert.equal(t.module.stateForReview().client.sessionState, "ready");
  assert.equal(t.module.stateForReview().verifiedReceive, address);
  assert.equal(t.context.nodes.get("copy-address").disabled, false);
  assert.equal(t.endpoint.commands.length, before);
  assert.equal(t.endpoint.closes(), 0);
  assert.equal(assertReserved(t.context).state, "draft");
});

test("Storage failure followed by stalled journal refresh never renders stale device verification", async () => {
  const t = await setup();
  let failed = false,
    blocked = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  t.context.beforeCommit = (j: any) => {
    if (j.payments[0]?.state === "signed") {
      failed = true;
      throw Error("Synthetic signed-storage failure before stalled refresh");
    }
  };
  t.context.beforeRead = async () => {
    if (failed) {
      blocked = true;
      await gate;
    }
  };
  const operation = t.module.signForReview();
  try {
    const deadline = Date.now() + 3000;
    while (!blocked) {
      assert(Date.now() < deadline, "Expected failed-storage refresh boundary");
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(t.module.stateForReview().client.sessionState, "failed");
    assert.equal(t.module.stateForReview().verifiedReceive, null);
    assert.match(
      t.dom.innerHTML,
      />Verify the address on your Ledger before using it\.</,
    );
    assert.doesNotMatch(t.dom.innerHTML, />Address verified on your Ledger\.</);
    assert.equal(t.context.nodes.get("copy-address").disabled, true);
    assert.equal(t.context.nodes.get("verify-receive").disabled, true);
    const emergency = t.module.stateForReview().emergencySignedRecovery;
    assert(emergency);
    assert.equal(emergency.pending, false);
    assert.equal(
      JSON.parse(emergency.text).journal.payments[0].rawTx,
      fixture.rawTx,
    );
    assert.equal(assertReserved(t.context).state, "signing");
  } finally {
    release();
    await operation;
  }
  await assertTerminal(t);
});

test("Lost final ACK followed by stalled journal refresh removes the displayed verified label", async () => {
  let ackFailed = false,
    blocked = false,
    release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const t = await setup((stage) => {
    if (stage === "ack") {
      ackFailed = true;
      throw Error("Synthetic lost final ACK before stalled refresh");
    }
  });
  t.context.beforeRead = async () => {
    if (ackFailed) {
      blocked = true;
      await gate;
    }
  };
  const operation = t.module.signForReview();
  try {
    const deadline = Date.now() + 3000;
    while (!blocked) {
      assert(
        Date.now() < deadline,
        "Expected final ACK failure refresh boundary",
      );
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(t.module.stateForReview().client.sessionState, "failed");
    assert.equal(t.module.stateForReview().verifiedReceive, null);
    assert.match(
      t.dom.innerHTML,
      />Verify the address on your Ledger before using it\.</,
      "Displayed label must clear before any finalizer storage await",
    );
    assert.doesNotMatch(t.dom.innerHTML, />Address verified on your Ledger\.</);
    assert.equal(t.context.nodes.get("copy-address").disabled, true);
    const saved = assertReserved(t.context);
    assert.equal(saved.state, "signed");
    assert.equal(saved.rawTx, fixture.rawTx);
  } finally {
    release();
    await operation;
  }
  await assertTerminal(t);
});
