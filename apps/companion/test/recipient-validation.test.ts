/** Actual recipient/prepare handlers; public fixtures and synthetic browser/storage only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { bech32, bech32m } from "@scure/base";
import * as sdk from "@pearl-ledger/sdk";
import * as wallet from "@pearl-ledger/wallet";
import {
  snapshotFixture,
  rawTransaction,
} from "../../../packages/wallet/test/fixtures.ts";
import { parsePaymentQr } from "../src/qr-reader.js";

Error.stackTraceLimit = 3;
const directory = fileURLToPath(new URL("../src/", import.meta.url));
const hooks = `
export async function recipientMount(s){account=s.account;network=account.network;snapshot=s;sourceMode='node';page='send';sendStep=0;feeSelection='custom';manualSelection=true;selected.clear();for(const coin of s.coins)selected.add(outpoint(coin));Object.assign(form,{recipient:'',amount:'0.00008',fee:'0.00001',changeIndex:'0'});await refreshJournal();render();}
export function recipientValue(value){form.recipient=value;}
export function recipientState(){return{sendStep,busy,notification,activePayment,recipient:form.recipient};}
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
      name: "recipient-boundaries",
      setup(b) {
        b.onResolve({ filter: /^\.\/(device|storage)\.js$/ }, (a) => ({
          path: a.path,
          namespace: "fixture",
        }));
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? `export async function connectLedger(){throw Error('Device access forbidden');}`
            : `export class WatchStorage{constructor(){this.c=globalThis.recipientFixture;}async journal(){return structuredClone(this.c.journal);}async mutate(id,fn){const j=structuredClone(this.c.journal);const r=fn(j);this.c.journal=j;this.c.commits++;return r;}async load(){return undefined;}}`,
        }));
      },
    },
  ],
});
const moduleUrl =
  "data:text/javascript;base64," +
  Buffer.from(compiled.outputFiles[0]!.text).toString("base64");
let serial = 0;
async function setup() {
  const c: any = {
    journal: wallet.emptyJournal(),
    commits: 0,
    requests: 0,
    nodes: new Map(),
  };
  const appElement = { innerHTML: "" };
  for (const id of ["recipient-continue", "prepare"]) {
    const el: any = {
      addEventListener(type: string, handler: unknown) {
        this[type] = handler;
      },
    };
    c.nodes.set(id, el);
  }
  Object.assign(globalThis, {
    recipientFixture: c,
    document: {
      querySelector: () => appElement,
      getElementById: (id: string) => c.nodes.get(id) ?? null,
      querySelectorAll: () => [],
      addEventListener() {},
      visibilityState: "hidden",
      activeElement: null,
    },
    window: {
      location: { protocol: "http:", pathname: "/test" },
      addEventListener() {},
    },
    BroadcastChannel: class {
      postMessage() {}
    },
    fetch: async () => {
      c.requests++;
      throw Error("Network access forbidden");
    },
  });
  const app: any = await import(moduleUrl + "#" + serial++);
  const snapshot = wallet.parseWatchSnapshot(
    JSON.stringify(
      snapshotFixture([rawTransaction(10_000n, 0)], 200, "regtest"),
    ),
  );
  await app.recipientMount(snapshot);
  return {
    c,
    app,
    appElement,
    snapshot,
    click: (id: string) => c.nodes.get(id).click(),
    async settle() {
      for (let i = 0; i < 100 && app.recipientState().busy; i++)
        await new Promise((r) => setImmediate(r));
      assert.equal(app.recipientState().busy, false);
    },
  };
}
function addresses(name: sdk.NetworkName) {
  const hrp = sdk.NETWORKS[name].hrp;
  // Version 2 permits any 32-byte Merkle root; no elliptic-curve assumption.
  const words = bech32m.toWords(new Uint8Array(32).fill(3));
  const valid = bech32m.encode(hrp, [2, ...words]);
  const invalid: Record<string, string> = {
    empty: "",
    truncated: valid.slice(0, -1),
    appended: valid + "q",
    overlong: "q".repeat(91),
    checksum: valid.slice(0, -1) + (valid.endsWith("q") ? "p" : "q"),
    mixedCase: valid[0]!.toUpperCase() + valid.slice(1),
    internalSpace: valid.slice(0, 8) + " " + valid.slice(8),
    wrongNetwork: bech32m.encode(hrp === "prl" ? "tprl" : "prl", [2, ...words]),
    wrongChecksumVariant: bech32.encode(hrp, [2, ...words]),
    unsupportedVersion: bech32m.encode(hrp, [3, ...words]),
    shortProgram: bech32m.encode(hrp, [
      2,
      ...bech32m.toWords(new Uint8Array(31)),
    ]),
    longProgram: bech32m.encode(hrp, [
      2,
      ...bech32m.toWords(new Uint8Array(33)),
    ]),
    badPadding: bech32m.encode(hrp, [
      2,
      ...words.slice(0, -1),
      words.at(-1)! | 1,
    ]),
    invalidTaprootPoint: bech32m.encode(hrp, [
      1,
      ...bech32m.toWords(new Uint8Array(32).fill(255)),
    ]),
    foreignUri: `bitcoin:${valid}`,
  };
  return { valid, invalid };
}
test("canonical decoder and QR reject malformed network, length, checksum, witness and padding across all networks", () => {
  for (const network of ["mainnet", "testnet2", "regtest"] as const) {
    const { valid, invalid } = addresses(network);
    for (const [reason, value] of Object.entries(invalid)) {
      assert.throws(() => sdk.addressToScript(value, network), reason);
      assert.throws(() => parsePaymentQr(value, network), reason);
      assert.throws(
        () => parsePaymentQr(`pearl:${value}?amount=0.00008`, network),
        reason,
      );
    }
    assert.equal(sdk.addressToScript(valid, network).length, 34);
    assert.equal(
      parsePaymentQr(`pearl:${valid.toUpperCase()}?amount=0.00008`, network)
        .address,
      valid.toUpperCase(),
    );
  }
});
test("actual manual Continue rejects bad addresses before amount entry and bypassed Prepare reserves nothing", async () => {
  const t = await setup();
  for (const [reason, value] of Object.entries(addresses("regtest").invalid)) {
    t.app.recipientValue(value);
    t.click("recipient-continue");
    assert.equal(t.app.recipientState().sendStep, 0, reason);
    assert(t.app.recipientState().notification, reason);
    assert.match(t.appElement.innerHTML, /role="status"/, reason);
    // Simulate a stale/injected prepare event: builder must independently reject.
    t.click("prepare");
    await t.settle();
    assert.equal(t.c.commits, 0, reason);
    assert.equal(t.c.journal.payments.length, 0, reason);
    assert.equal(t.app.recipientState().activePayment, null, reason);
  }
  assert.equal(t.c.requests, 0);
});
test("manual input accepts normalized surrounding whitespace and valid uppercase P2TR/P2MR with exact recipient scripts", async () => {
  for (const recipient of [
    addresses("regtest").valid,
    sdk.deriveAddress((await setup()).snapshot.account, 0, 7).address,
  ]) {
    const t = await setup();
    t.app.recipientValue("  " + recipient.toUpperCase() + "\n");
    t.click("recipient-continue");
    assert.equal(t.app.recipientState().sendStep, 1);
    assert.equal(t.app.recipientState().recipient, recipient.toUpperCase());
    t.click("prepare");
    await t.settle();
    assert.equal(t.c.commits, 1);
    const bundle = wallet.paymentBundle(t.c.journal.payments[0]);
    const output = bundle.outputs.find((o) => o.role === "recipient")!;
    assert.deepEqual(
      output.scriptPubKey,
      sdk.addressToScript(recipient, "regtest"),
    );
    assert.equal(output.amount, 8000n);
    assert.equal(t.c.requests, 0);
  }
});
