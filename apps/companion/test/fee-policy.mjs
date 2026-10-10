/** Actual UI/wallet policy with public-only fixtures. DOM, storage, node replies
 * and the device-call boundary are mocks. No signatures, keys, network or device. */
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const sdk = await import(
  pathToFileURL(path.join(root, "packages/sdk/src/index.ts"))
);
const wallet = await import(
  pathToFileURL(path.join(root, "packages/wallet/src/index.ts"))
);
const fixtures = await import(
  pathToFileURL(path.join(root, "packages/wallet/test/fixtures.ts"))
);
const makeSnapshot = (n) =>
  wallet.parseWatchSnapshot(
    JSON.stringify(
      fixtures.snapshotFixture(
        Array.from({ length: n }, (_, i) =>
          fixtures.rawTransaction(500000000n, i, false),
        ),
      ),
    ),
  );
const snapshot = makeSnapshot(16);
const source =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
import { importWalletBackup } from "@pearl-ledger/wallet";
export async function auditInputs(s) {
 account=s.account; network=s.account.network; snapshot=s; page='send'; activePayment=null;
 manualSelection=true; selected.clear(); for(const c of s.coins) selected.add(outpoint(c));
 form.recipient=deriveAddress(account,0,18).address;form.amount='1';form.fee='0.00001000';form.changeIndex='20';
 await store.mutate(accountId(account), j=>Object.assign(j,emptyJournal())); await refreshJournal(); render();
}
export async function auditPublicInputs(s) {await auditInputs(s);sourceMode='public';render();}
export function auditFeeMode(mode) {sourceMode=mode;render();}
export function auditSelection(ids) {manualSelection=true;selected.clear();for(const id of ids)selected.add(id);render();}
export function auditState() {return {form:{...form},hint:feePolicyHint(),journal,notification,busy,selected:[...selected],feeQuoteStatus,feeOptions:feeQuoteOptions()};}
export async function auditRestore(s,bundle) {
 await auditInputs(s);const j=emptyJournal();reservePayment(j,bundle,'policy-draft',1000);
 const restored=importWalletBackup(exportWalletBackup(account,j));
 await store.mutate(accountId(account), saved=>Object.assign(saved,restored.journal));
 activePayment='policy-draft'; client={sessionState:'ready',async signBundle(){globalThis.deviceCalls++;throw new Error('STOP_BEFORE_DEVICE');}};
 await refreshJournal();
}
export async function auditSign(){await run('Policy preflight',sign);}
`;
const built = await build({
  stdin: {
    contents: source,
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
      name: "policy-boundaries",
      setup(build) {
        build.onResolve(
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "test" }),
        );
        build.onLoad({ filter: /.*/, namespace: "test" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? 'export async function connectLedger(){throw Error("No device in this test");}'
            : a.path.includes("storage")
              ? `export class WatchStorage {
        constructor(){this.rows=new Map();}
        async journal(k){return structuredClone(this.rows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0});}
        async mutate(k,fn){const j=await this.journal(k);const value=fn(j);this.rows.set(k,structuredClone(j));return value;}
      }`
              : "",
        }));
      },
    },
  ],
});
const listeners = new Map(),
  elements = new Map(),
  dom = { innerHTML: "" };
globalThis.document = {
  querySelector: () => dom,
  querySelectorAll: () => [],
  getElementById(id) {
    if (!elements.has(id))
      elements.set(id, {
        textContent: "",
        addEventListener(event, fn) {
          listeners.set(`${id}:${event}`, fn);
        },
      });
    return elements.get(id);
  },
};
globalThis.window = { addEventListener() {} };
globalThis.BroadcastChannel = class {
  postMessage() {}
};
const app = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
await app.auditInputs(snapshot);
const originalForm = app.auditState().form;
assert.match(app.auditState().hint, /Minimum fee: 0\.00001017 PRL/);
assert.match(dom.innerHTML, /id="fee-policy"/);
assert.equal(app.auditState().form.fee, "0.00001000");
app.auditSelection([wallet.outpoint(snapshot.coins[0])]);
assert.match(app.auditState().hint, /Minimum fee: 0\.00000154 PRL/);
assert.deepEqual(app.auditState().form, originalForm);
listeners.get("amount:input")({ target: { value: "4.99999000" } });
assert.match(
  elements.get("fee-policy").textContent,
  /Minimum fee: 0\.00000111 PRL/,
);
assert.equal(app.auditState().form.fee, "0.00001000");
listeners.get("fee:input")({ target: { value: "0.00000100" } });
assert.match(
  elements.get("fee-policy").textContent,
  /Fee too low.*0\.00000154 PRL/,
);
assert.equal(app.auditState().form.amount, "4.99999000");
assert.equal(app.auditState().form.fee, "0.00000100");
console.log(
  "PASS: live fee hint recomputes16-to1 inputs and no-change/change shapes without changing authorized amount or fee",
);
function bundleFor(s, fee) {
  return wallet.preparePayment(s, {
    selected: s.coins.map(wallet.outpoint),
    recipient: sdk.deriveAddress(s.account, 0, 18).address,
    amountPrl: "1",
    feePrl: sdk.formatPrl(fee),
    changeIndex: 20,
  });
}
for (const kind of [
  "one-grain",
  "zero-fee",
  "dust-recipient",
  "dust-change",
  "16-input-default-fee",
]) {
  const s = makeSnapshot(kind === "16-input-default-fee" ? 16 : 1);
  const bundle = bundleFor(s, kind === "16-input-default-fee" ? 1017n : 1000n);
  if (kind === "one-grain") bundle.outputs[1].amount += 999n;
  if (kind === "zero-fee") bundle.outputs[1].amount += 1000n;
  if (kind === "16-input-default-fee") bundle.outputs[1].amount += 17n;
  if (kind === "dust-recipient") {
    bundle.outputs[1].amount += bundle.outputs[0].amount - 332n;
    bundle.outputs[0].amount = 332n;
  }
  if (kind === "dust-change") {
    bundle.outputs[0].amount += bundle.outputs[1].amount - 332n;
    bundle.outputs[1].amount = 332n;
  }
  await app.auditRestore(s, bundle);
  const before = JSON.stringify(app.auditState().journal);
  globalThis.deviceCalls = 0;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    throw new Error("No node request permitted before failed policy");
  };
  await app.auditSign();
  assert.equal(globalThis.deviceCalls, 0);
  assert.equal(requests, 0);
  assert.equal(JSON.stringify(app.auditState().journal), before);
  assert.equal(app.auditState().journal.payments[0].state, "draft");
  assert.equal(
    wallet.reservedOutpoints(app.auditState().journal).size,
    s.coins.length,
  );
  assert.match(app.auditState().notification, /relay policy|dust/);
  console.log(
    `PASS: restored ${kind} draft remains readable/reserved and is blocked before node work or device review`,
  );
}
{
  const s = makeSnapshot(1),
    bundle = bundleFor(s, 154n);
  await app.auditRestore(s, bundle);
  globalThis.deviceCalls = 0;
  globalThis.fetch = async (route) => {
    assert.equal(route, "/api/check");
    return new Response(
      JSON.stringify({
        network: s.account.network,
        genesisHash: s.genesisHash,
        tip: s.tip,
        checkedAt: Date.now(),
        coins: s.coins.map((c) => ({
          outpoint: wallet.outpoint(c),
          state: "unspent",
          grains: c.amount.toString(),
          scriptPubKey: sdk.hex(c.scriptPubKey),
          block: c.block,
          coinbase: c.coinbase,
          confirmations: 200,
        })),
      }),
    );
  };
  await app.auditSign();
  assert.equal(globalThis.deviceCalls, 1);
  assert.equal(app.auditState().journal.payments[0].state, "signing");
  assert.match(app.auditState().notification, /STOP_BEFORE_DEVICE/);
  console.log(
    "PASS: a restored exact-floor draft passes policy/fresh-input gates and reaches only the mocked device boundary",
  );
}

async function clickAndSettle(id) {
  listeners.get(`${id}:click`)();
  for (let attempt = 0; attempt < 200 && app.auditState().busy; attempt++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(app.auditState().busy, false, `Operation did not settle: ${id}`);
}
await app.auditInputs(snapshot);
await clickAndSettle("send-max");
assert.equal(app.auditState().form.amount, "79.99999000");
assert.equal(app.auditState().form.fee, "0.00001000");
assert.equal(app.auditState().selected.length, 16);
assert.equal(app.auditState().journal.payments.length, 0);
console.log(
  "PASS: actual Max handler keeps the exact fee and selected inputs without allocating a reservation",
);

const publicSnapshot = wallet.parseWatchSnapshot(
  JSON.stringify(
    fixtures.snapshotFixture(
      [fixtures.rawTransaction(500_000_000n, 0, false)],
      200,
      "mainnet",
    ),
  ),
);
await app.auditPublicInputs(publicSnapshot);
const beforeQuotes = { ...app.auditState().form };
const quotePaths = [];
globalThis.fetch = async (route, options) => {
  assert.equal(route, "/api/indexer/read");
  const body = JSON.parse(options.body);
  quotePaths.push(body.path);
  assert.equal(body.network, "mainnet");
  let value;
  if (body.path === "/api/v2/")
    value = {
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
        bestBlockHash: publicSnapshot.tip.hash,
      },
    };
  else if (body.path.startsWith("/api/v2/block-index/"))
    value = {
      blockHash: body.path.endsWith("/0")
        ? sdk.NETWORKS.mainnet.genesisHash
        : publicSnapshot.tip.hash,
    };
  else {
    assert.match(body.path, /^\/api\/v1\/estimatefee\/(1|10|25)$/);
    value = { result: "0.00001000" };
  }
  return new Response(JSON.stringify(value));
};
await clickAndSettle("refresh-fees");
assert.deepEqual(app.auditState().form, beforeQuotes);
assert.equal(app.auditState().feeOptions.length, 3);
assert.equal(quotePaths.length, 6);
assert.match(dom.innerHTML, /1-block target.*0.00000154 PRL/);
await clickAndSettle("fee-target-1");
assert.equal(app.auditState().form.fee, "0.00000154");
assert.equal(app.auditState().form.amount, beforeQuotes.amount);
const afterChoice = { ...app.auditState().form };
globalThis.fetch = async () => {
  throw new Error("Indexer unavailable");
};
await clickAndSettle("refresh-fees");
assert.deepEqual(app.auditState().form, afterChoice);
assert.equal(app.auditState().feeOptions.length, 0);
assert.match(app.auditState().feeQuoteStatus, /unavailable/);
assert.equal(app.auditState().journal.payments.length, 0);
let privateRequests = 0;
globalThis.fetch = async () => {
  privateRequests++;
  throw new Error("Private mode must not query public fees");
};
app.auditFeeMode("node");
await clickAndSettle("refresh-fees");
assert.equal(privateRequests, 0);
assert.deepEqual(app.auditState().form, afterChoice);
console.log(
  "PASS: quote loading/failure leaves authorization unchanged; explicit choice sets only fee and private mode stays manual",
);
