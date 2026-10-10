/** Actual UI, wallet and SDK; public frozen signatures only. DOM, atomic storage,
 * source responses and APDU endpoint are mocks. No signing keys, hardware or network. */
import fs from "node:fs";
import { createPsbtEndpoint, P, interrupted } from "./psbt-endpoint.mjs";
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
const f = JSON.parse(
  fs.readFileSync(path.join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = sdk.accountFromJson(f.publicAccount),
  bundle = sdk.decodeBundle(sdk.fromHex(f.bundleHex));
// Frozen alternate public-vector-one signatures, independently accepted by the
// pinned Pearl oracle. Different witnesses are valid for this identical txid.
const alternateFixture = JSON.parse(
  fs.readFileSync(
    new URL("./fixtures/signing-recovery-alternate.json", import.meta.url),
    "utf8",
  ),
);
const alternate = sdk.finalizeTransaction(
  bundle,
  alternateFixture.signatures.map(sdk.fromHex),
);
assert.equal(alternate.txid, f.txid);
assert.notEqual(alternate.rawTx, f.rawTx);
const id = "recovery-fixture",
  ownerId = wallet.accountId(account),
  rows = new Map();
globalThis.recoveryRows = rows;
const tip = { height: 200, hash: "aa".repeat(32) },
  block = { height: 1, hash: "bb".repeat(32) };
const snapshot = {
  schema: 1,
  account,
  genesisHash: sdk.NETWORKS.regtest.genesisHash,
  tip,
  coverage: {
    externalScannedThrough: 19,
    changeScannedThrough: 19,
    gapLimit: 20,
  },
  coins: bundle.inputs.map((i) => ({
    ...i,
    rawTransaction: "",
    coinbase: false,
    block,
  })),
};
const contents =
  fs.readFileSync(path.join(root, "apps/companion/src/main.ts"), "utf8") +
  `
export async function mountRecovery(a,s,d) {account=a;network=a.network;snapshot=s;client=new LedgerBitcoinPrlClient(d,'regtest');activePayment='recovery-fixture';page='send';await refreshJournal();render();}
export async function startRecovery(recovery=true) {await run('Explicit identical-payment recovery',signal=>sign(signal,recovery));return notification;}
export function cancelRecovery(){currentAbort?.abort();}
export function recoveryState(){return {notification,journal};}
`;
const built = await build({
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
      name: "recovery-boundaries",
      setup(build) {
        build.onResolve(
          { filter: /^\.\/(device\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "recovery" }),
        );
        build.onLoad({ filter: /.*/, namespace: "recovery" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? 'export async function connectLedger(){throw Error("No physical connection in this test");}'
            : a.path.includes("storage")
              ? `export class WatchStorage {
 async journal(k){const j=structuredClone(globalThis.recoveryRows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0});await globalThis.recoveryAfterRead?.(j);return j;}
 async mutate(k,fn){await globalThis.recoveryBeforeMutation?.();const j=structuredClone(globalThis.recoveryRows.get(k)??{schema:1,payments:[],issuedReceiveThrough:-1,nextChangeIndex:0});const result=fn(j);globalThis.recoveryRows.set(k,structuredClone(j));await globalThis.recoveryAfterMutation?.(j);return result;}
}`
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
let serial = 0,
  calls = 0,
  sourceState = "unspent",
  sourceHook;
globalThis.fetch = async (route) => {
  calls++;
  assert.equal(route, "/api/check", "recovery must never broadcast");
  await sourceHook?.();
  return new Response(
    JSON.stringify({
      network: "regtest",
      genesisHash: snapshot.genesisHash,
      tip,
      checkedAt: Date.now(),
      coins: bundle.inputs.map((i) =>
        sourceState === "unspent"
          ? {
              outpoint: wallet.outpoint(i),
              state: "unspent",
              grains: i.amount.toString(),
              scriptPubKey: sdk.hex(i.scriptPubKey),
              block,
              coinbase: false,
              confirmations: 200,
            }
          : { outpoint: wallet.outpoint(i), state: sourceState },
      ),
    }),
  );
};
function gate() {
  let release;
  const promise = new Promise((r) => (release = r));
  return { promise, release };
}
function seed(state = "signing") {
  rows.clear();
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle, id, 1000);
  if (state === "signing") wallet.transitionPayment(j, id, "signing");
  rows.set(ownerId, j);
  calls = 0;
  sourceState = "unspent";
  sourceHook = undefined;
  globalThis.recoveryBeforeMutation = undefined;
  globalThis.recoveryAfterMutation = undefined;
  globalThis.recoveryAfterRead = undefined;
  return structuredClone(j);
}
function saved() {
  return rows.get(ownerId);
}
function unchangedPayment(before) {
  const current = saved();
  assert.equal(current.payments.length, 1);
  assert.equal(current.payments[0].bundleHex, before.payments[0].bundleHex);
  assert.deepEqual(current.payments[0].outpoints, before.payments[0].outpoints);
  assert.equal(current.nextChangeIndex, before.nextChangeIndex);
  assert.equal(current.issuedReceiveThrough, before.issuedReceiveThrough);
  assert.equal(wallet.reservedOutpoints(current).size, 2);
}
function device(options = {}) {
  return createPsbtEndpoint(options);
}
async function mount(d) {
  const app = await import(
    "data:text/javascript;base64," +
      Buffer.from(built.outputFiles[0].text).toString("base64") +
      "#" +
      serial++
  );
  await app.mountRecovery(account, structuredClone(snapshot), d.transport);
  return app;
}
{
  const before = seed(),
    d = device(),
    app = await mount(d);
  assert.match(dom.innerHTML, /id="recover-signing"/);
  assert.equal(calls, 0);
  assert.equal(d.commands.length, 0);
  await app.startRecovery();
  assert.equal(saved().payments[0].state, "signed");
  assert.equal(saved().payments[0].rawTx, f.rawTx);
  assert.equal(saved().payments[0].signingAttempt, undefined);
  assert(
    d.commands.indexOf(P.GET_EXTENDED_PUBKEY) < d.commands.indexOf(P.SIGN_PSBT),
  );
  assert.equal(calls, 1);
  unchangedPayment(before);
  console.log(
    "PASS: explicit recovery requires fresh approved matching identity and saves one identical verified payment without broadcasting",
  );
}
for (const failure of [
  "review-rejection",
  "timeout",
  "invalid-signature",
  "wrong-key",
  "cancel-export",
  "cancel-signature",
]) {
  const before = seed();
  let app;
  const d = device({
    account:
      failure === "wrong-key"
        ? { ...account, chainCode: new Uint8Array(32).fill(3) }
        : account,
    onCommand: async (ins) => {
      if (failure === "review-rejection" && ins === P.SIGN_PSBT)
        return Uint8Array.of(0x69, 0x85);
      if (failure === "timeout" && ins === P.SIGN_PSBT)
        throw Error("Transport timeout");
      if (failure === "cancel-export" && ins === P.GET_EXTENDED_PUBKEY)
        app.cancelRecovery();
    },
    onStage: async (stage, index) => {
      if (stage !== "signature") return;
      if (failure === "cancel-signature") app.cancelRecovery();
      if (failure === "invalid-signature")
        return interrupted(
          sdk.concat(
            Uint8Array.of(0x10, index, 32),
            bundle.inputs[index].scriptPubKey.slice(2),
            new Uint8Array(64),
          ),
        );
    },
  });
  app = await mount(d);
  await app.startRecovery();
  assert.equal(saved().payments[0].state, "signing");
  assert.equal(saved().payments[0].rawTx, undefined);
  assert(saved().payments[0].signingAttempt.recovery);
  if (failure === "wrong-key" || failure === "cancel-export")
    assert(!d.commands.includes(P.SIGN_PSBT));
  assert.throws(() => wallet.discardDraft(saved(), id));
  unchangedPayment(before);
  console.log(
    "PASS: recovery " +
      failure +
      " retains prior ambiguity and every reservation",
  );
}
for (const state of ["spent-or-unknown", "reorged"]) {
  const before = seed(),
    d = device(),
    app = await mount(d);
  sourceState = state;
  await app.startRecovery();
  assert.equal(d.commands.length, 0);
  assert.deepEqual(saved(), before);
  console.log("PASS: " + state + " inputs block recovery before any APDU");
}
{
  const before = seed(),
    d = device(),
    app = await mount(d);
  sourceHook = () => {
    const p = saved().payments[0];
    p.createdAt++;
  };
  await app.startRecovery();
  assert.equal(d.commands.length, 0);
  assert.equal(saved().payments[0].state, "signing");
  unchangedPayment(before);
  console.log(
    "PASS: concurrent canonical record change blocks recovery before APDUs",
  );
}
{
  const before = seed();
  // Save the other tab's bytes once, while this SDK is still retrieving signatures.
  let once = false;
  const other = device({
    onStage: async (stage) => {
      if (stage === "signature" && !once) {
        once = true;
        wallet.transitionPayment(saved(), id, "signed", {
          rawTx: alternate.rawTx,
          txid: alternate.txid,
        });
      }
    },
  });
  const actual = await mount(other);
  await actual.startRecovery();
  assert.equal(saved().payments[0].rawTx, alternate.rawTx);
  assert.equal(saved().payments[0].txid, f.txid);
  assert.match(actual.recoveryState().notification, /Another tab/);
  unchangedPayment(before);
  console.log(
    "PASS: another tab's different valid witness is preserved unchanged for the identical txid",
  );
}
{
  const before = seed("draft"),
    review = gate(),
    entered = gate(),
    exportGate = gate(),
    exportEntered = gate();
  const first = device({
    onCommand: async (ins) => {
      if (ins === P.SIGN_PSBT) {
        entered.release();
        await review.promise;
        return Uint8Array.of(0x69, 0x85);
      }
    },
  });
  const a = await mount(first),
    running = a.startRecovery(false);
  await entered.promise;
  const second = device({
    onCommand: async (ins) => {
      if (ins === P.GET_EXTENDED_PUBKEY) {
        exportEntered.release();
        await exportGate.promise;
        return Uint8Array.of(0x69, 0x85);
      }
    },
  });
  const b = await mount(second),
    recovering = b.startRecovery();
  await exportEntered.promise;
  review.release();
  await running;
  assert.equal(saved().payments[0].state, "signing");
  exportGate.release();
  await recovering;
  assert.equal(saved().payments[0].state, "signing");
  assert.throws(() => wallet.discardDraft(saved(), id));
  unchangedPayment(before);
  console.log(
    "PASS: initial SIGN_PSBT rejection cannot reset an atomically claimed recovery attempt",
  );
}
{
  const before = seed("draft"),
    review = gate(),
    entered = gate();
  const first = device({
      onCommand: async (ins) => {
        if (ins === P.SIGN_PSBT) {
          entered.release();
          await review.promise;
          return Uint8Array.of(0x69, 0x85);
        }
      },
    }),
    a = await mount(first),
    running = a.startRecovery(false);
  await entered.promise;
  const second = device(),
    b = await mount(second),
    checkGate = gate(),
    checked = gate();
  sourceHook = async () => {
    checked.release();
    await checkGate.promise;
  };
  const recovering = b.startRecovery();
  await checked.promise;
  review.release();
  await running;
  assert.equal(saved().payments[0].state, "signing");
  checkGate.release();
  await recovering;
  assert.equal(second.commands.filter((ins) => ins === P.SIGN_PSBT).length, 1);
  assert.equal(saved().payments[0].state, "signed");
  assert.equal(saved().payments[0].rawTx, f.rawTx);
  unchangedPayment(before);
  console.log(
    "PASS: initial generic rejection retains ambiguity until explicit matching recovery saves exact verified bytes",
  );
}
{
  const before = seed("draft"),
    review = gate(),
    entered = gate(),
    d = device({
      onCommand: async (ins) => {
        if (ins === P.SIGN_PSBT) {
          entered.release();
          await review.promise;
          return Uint8Array.of(0x69, 0x85);
        }
      },
    }),
    app = await mount(d),
    running = app.startRecovery(false);
  await entered.promise;
  const restored = wallet.importWalletBackup(
    wallet.exportWalletBackup(account, saved()),
  ).journal;
  wallet.mergeRestoredJournal(saved(), restored);
  assert.equal(saved().payments[0].signingAttempt, undefined);
  review.release();
  await running;
  assert.equal(saved().payments[0].state, "signing");
  unchangedPayment(before);
  console.log(
    "PASS: merging an ambiguous backup revokes the old initial callback rollback authority",
  );
}
{
  const before = seed(),
    review = gate(),
    entered = gate(),
    first = device({
      onCommand: async (ins) => {
        if (ins === P.SIGN_PSBT) {
          entered.release();
          await review.promise;
        }
      },
    }),
    a = await mount(first),
    running = a.startRecovery();
  await entered.promise;
  const second = device({ signatures: alternate.signatures }),
    b = await mount(second);
  await b.startRecovery();
  assert.equal(saved().payments[0].rawTx, alternate.rawTx);
  review.release();
  await running;
  assert.equal(saved().payments[0].rawTx, alternate.rawTx);
  unchangedPayment(before);
  console.log(
    "PASS: two simultaneous recovery attempts preserve the first complete verified bytes",
  );
}
{
  const before = seed(),
    originalNow = Date.now;
  let app;
  const d = device({
    onCommand: async (ins) => {
      if (ins === P.GET_EXTENDED_PUBKEY)
        Date.now = () => originalNow() + 60_001;
    },
  });
  app = await mount(d);
  try {
    await app.startRecovery();
  } finally {
    Date.now = originalNow;
  }
  assert.equal(saved().payments[0].state, "signed");
  assert(d.commands.includes(P.SIGN_PSBT));
  assert.equal(calls, 2);
  unchangedPayment(before);
  console.log(
    "PASS: slow account approval requires one fresh second source check before signing",
  );
}
{
  const before = seed(),
    d = device(),
    app = await mount(d);
  globalThis.recoveryAfterMutation = async (j) => {
    if (j.payments[0]?.signingAttempt?.recovery) app.cancelRecovery();
  };
  await app.startRecovery();
  globalThis.recoveryAfterMutation = undefined;
  assert.equal(d.commands.length, 0);
  assert.equal(saved().payments[0].state, "signing");
  unchangedPayment(before);
  console.log(
    "PASS: cancellation after durable attempt ownership prevents every recovery APDU",
  );
}
{
  const before = seed(),
    originalNow = Date.now;
  const d = device({
      onCommand: async (ins) => {
        if (ins === P.GET_EXTENDED_PUBKEY) {
          Date.now = () => originalNow() + 60_001;
          sourceState = "spent-or-unknown";
        }
      },
    }),
    app = await mount(d);
  try {
    await app.startRecovery();
  } finally {
    Date.now = originalNow;
  }
  assert.equal(saved().payments[0].state, "signing");
  assert.equal(calls, 2);
  assert(!d.commands.includes(P.SIGN_PSBT));
  unchangedPayment(before);
  console.log(
    "PASS: the bounded second check must still prove every original input unspent",
  );
}
