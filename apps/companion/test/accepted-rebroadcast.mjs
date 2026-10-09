// Independent recovery probe: actual UI, wallet, SDK and bridge; public frozen
// signatures; fake DOM/storage and node replies; no device, sockets or broadcast.
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url))),
  require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const sdk = await import(
  pathToFileURL(path.join(root, "packages/sdk/src/index.ts"))
);
const wallet = await import(
  pathToFileURL(path.join(root, "packages/wallet/src/index.ts"))
);
const bridge = await import(
  pathToFileURL(path.join(root, "apps/companion/src/bridge.ts"))
);
const f = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const a = sdk.accountFromJson(f.publicAccount),
  b = sdk.decodeBundle(sdk.fromHex(f.bundleHex));
Error.stackTraceLimit = 2;
const fixed = process.argv.includes("--expect-fixed");
const contents =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export async function auditSeed(a,j) {account=a;network=a.network;sourceMode='node';await store.mutate(accountId(a),saved=>Object.assign(saved,structuredClone(j)));activePayment=j.payments[0].id;page='send';await refreshJournal();render();}
export async function auditReconcile(){await reconcileNodePayments(new AbortController().signal);await refreshJournal();render();}
// Test-only explicit approval, captured before the actual async broadcast flow.
// The real checkbox/dispatch guard is exercised separately in direct-wallet-ui.mjs.
function auditApproval(){const p=getPayment();return Object.freeze({ownerId:accountId(account),paymentId:p.id,network,source:sourceMode,rawTx:p.rawTx,txid:p.txid});}
export async function auditBroadcast(){await broadcast(undefined,auditApproval());await refreshJournal();render();}
export async function auditSaved(){return store.journal(accountId(account));}
export async function auditRunBroadcast(){const approval=auditApproval();await run('Explicit retry',signal=>broadcast(signal,approval));return notification;}
export function auditCancel(){currentAbort?.abort();}
`;
const output = await build({
  stdin: {
    contents,
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
      name: "boundaries",
      setup(build) {
        build.onResolve(
          { filter: /^\.\/(ledger\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "probe" }),
        );
        build.onLoad({ filter: /.*/, namespace: "probe" }, (a) => ({
          loader: "js",
          contents: a.path.includes("ledger")
            ? 'export async function connectLedger(){throw Error("No device allowed in this probe")}'
            : a.path.includes("storage")
              ? `export class WatchStorage{constructor(){this.rows=new Map()} async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0})} async mutate(k,fn){const j=await this.journal(k);const result=fn(j);await globalThis.auditBeforeCommit?.(j);this.rows.set(k,structuredClone(j));return result}}`
              : "",
        }));
      },
    },
  ],
});
const dom = { innerHTML: "" };
globalThis.document = {
  querySelector: () => dom,
  querySelectorAll: () => [],
  getElementById: () => null,
};
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = class {
  postMessage() {}
};
const app = await import(
  "data:text/javascript;base64," +
    Buffer.from(output.outputFiles[0].text).toString("base64")
);
function accepted(archived) {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, b, "accepted-fixture", 1000);
  wallet.transitionPayment(j, "accepted-fixture", "signing");
  wallet.transitionPayment(j, "accepted-fixture", "signed", {
    rawTx: f.rawTx,
    txid: f.txid,
  });
  wallet.transitionPayment(j, "accepted-fixture", "broadcast-unknown");
  wallet.transitionPayment(j, "accepted-fixture", "accepted");
  if (archived)
    j.payments[0].archived = {
      status: "confirmed",
      block: { height: 95, hash: "95".repeat(32) },
      checkedAt: 1,
    };
  return j;
}
for (const mode of ["evicted", "reorged"]) {
  await app.auditSeed(a, accepted(mode === "reorged"));
  let broadcasts = 0;
  const rpc = async (method, params) => {
    switch (method) {
      case "getblockchaininfo":
        return { chain: "regtest" };
      case "getblockcount":
        return 100;
      case "getblockhash":
        return params[0] === 0
          ? sdk.NETWORKS.regtest.genesisHash
          : params[0] === 95
            ? "bb".repeat(32)
            : "aa".repeat(32);
      case "getrawtransaction":
        throw Error("Transaction not found after mempool eviction");
      default:
        throw Error("Unexpected RPC mutation: " + method);
    }
  };
  globalThis.fetch = async (route, options) => {
    const payload = JSON.parse(options.body);
    if (route === "/api/reconcile")
      return new Response(
        JSON.stringify(
          await bridge.checkKnownPayments(rpc, "regtest", payload),
        ),
      );
    assert.equal(route, "/api/broadcast");
    const exact = bridge.verifyBroadcastPayload("regtest", payload);
    assert.equal(exact.rawTx, f.rawTx);
    assert.equal(exact.txid, f.txid);
    broadcasts++;
    return new Response(JSON.stringify({ txid: exact.txid }));
  };
  await app.auditReconcile();
  const j = await app.auditSaved();
  assert.equal(j.payments[0].state, "accepted");
  assert.equal(j.payments[0].archived, undefined);
  assert.equal(j.payments[0].rawTx, f.rawTx);
  assert.equal(wallet.reservedOutpoints(j).size, 2);
  assert.equal(broadcasts, 0, "reconciliation must never auto-broadcast");
  const button = /id="broadcast"/.test(dom.innerHTML);
  if (!fixed) {
    assert.equal(button, false);
    await assert.rejects(
      app.auditBroadcast(),
      /No verified signed transaction/,
    );
    console.log(
      `REPRODUCED ${mode}: retained accepted record, exact bytes and two locks; no UI retry and explicit broadcast rejects before network`,
    );
  } else {
    assert(
      button,
      "accepted but unconfirmed payment needs an explicit exact-byte rebroadcast action",
    );
    await app.auditBroadcast();
    assert.equal(broadcasts, 1);
    const after = await app.auditSaved();
    assert.equal(after.payments[0].rawTx, f.rawTx);
    assert.equal(after.payments[0].txid, f.txid);
    assert.equal(after.payments.length, 1);
    assert.equal(wallet.reservedOutpoints(after).size, 2);
    console.log(
      `PASS ${mode}: reconciliation did not broadcast; explicit retry reused exact signed bytes/txid and retained both reservations`,
    );
  }
}
function return100() {
  return 100;
}

if (fixed) {
  // Current canonical archival evidence must first be reconciled, not ignored.
  await app.auditSeed(a, accepted(true));
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw Error("Unexpected endpoint request");
  };
  await assert.rejects(app.auditBroadcast());
  assert.equal(requests, 0);
  assert((await app.auditSaved()).payments[0].archived);
  console.log(
    "PASS confirmed: current archival receipt blocks duplicate explicit retry",
  );
  // Signature/serialization tampering never reaches any endpoint.
  const corrupt = accepted(false);
  corrupt.payments[0].rawTx += "00";
  await app.auditSeed(a, corrupt);
  await assert.rejects(app.auditBroadcast());
  assert.equal(requests, 0);
  assert.equal(wallet.reservedOutpoints(await app.auditSaved()).size, 2);
  console.log(
    "PASS malformed: altered signed bytes reject without endpoint traffic or released locks",
  );
  for (const failure of [
    "transport timeout; acceptance unknown",
    "node already knows this transaction",
  ]) {
    await app.auditSeed(a, accepted(false));
    let sends = 0;
    globalThis.fetch = async (route, options) => {
      assert.equal(route, "/api/broadcast");
      const exact = bridge.verifyBroadcastPayload(
        "regtest",
        JSON.parse(options.body),
      );
      assert.equal(exact.rawTx, f.rawTx);
      sends++;
      if (failure.startsWith("node "))
        return new Response(JSON.stringify({ error: failure }), {
          status: 400,
        });
      throw Error(failure);
    };
    await assert.rejects(app.auditBroadcast(), new RegExp(failure));
    const saved = await app.auditSaved();
    assert.equal(sends, 1);
    assert.equal(saved.payments[0].state, "broadcast-unknown");
    assert.equal(saved.payments[0].rawTx, f.rawTx);
    assert.equal(saved.payments[0].txid, f.txid);
    assert.equal(saved.payments.length, 1);
    assert.equal(wallet.reservedOutpoints(saved).size, 2);
    console.log(
      "PASS uncertainty: " +
        failure +
        " retains same bytes, txid and reservations without retry",
    );
  }
  await app.auditSeed(a, accepted(false));
  let release, reached;
  const gate = new Promise((r) => (release = r)),
    entry = new Promise((r) => (reached = r));
  globalThis.auditBeforeCommit = async (j) => {
    if (j.payments[0]?.state === "broadcast-unknown") {
      reached();
      await gate;
    }
  };
  let sends = 0;
  globalThis.fetch = async (_route, options) => {
    options.signal.throwIfAborted();
    sends++;
    throw Error("Unexpected post-cancel send");
  };
  const retry = app.auditRunBroadcast();
  await entry;
  app.auditCancel();
  release();
  await retry;
  delete globalThis.auditBeforeCommit;
  const saved = await app.auditSaved();
  assert.equal(sends, 0);
  assert.equal(saved.payments[0].rawTx, f.rawTx);
  assert.equal(saved.payments[0].txid, f.txid);
  assert.equal(saved.payments.length, 1);
  assert.equal(wallet.reservedOutpoints(saved).size, 2);
  console.log(
    "PASS cancelled: cancellation at retry persistence boundary sends nothing and retains exact bytes and locks",
  );
}
if (fixed) {
  for (const state of ["signed", "broadcast-unknown", "accepted"]) {
    const saved = accepted(true);
    saved.payments[0].state = state;
    await app.auditSeed(a, saved);
    assert.match(
      dom.innerHTML,
      /A confirmed receipt is archived/,
      "every archived signed state must show the archive notice",
    );
    assert.doesNotMatch(
      dom.innerHTML,
      /Signing was started/,
      "a retained confirmed receipt is not an interrupted signing claim",
    );
    assert.doesNotMatch(dom.innerHTML, /id="broadcast"/);
  }
  console.log(
    "PASS archived UI: signed, broadcast-unknown and accepted receipts show the same archive notice with no retry button",
  );
}
