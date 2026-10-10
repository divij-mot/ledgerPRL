/** Real main.ts handler + discovery/local/public source implementations, fixture I/O only. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { transform } from "esbuild";
import * as sdk from "../../packages/sdk/src/index.ts";
import * as wallet from "../../packages/wallet/src/index.ts";
import { LOCAL_SOURCE_COMMIT } from "../../apps/companion/src/local-source.ts";
const root = resolve(import.meta.dirname, "../..");
let harness = await readFile(
  resolve(root, "tools/hosted-wallet-review/ui.test.ts"),
  "utf8",
);
harness = harness.slice(0, harness.indexOf("\ntest("));
const extra = `
export async function auditReconcileMount(s,mode,oldHistory){account=s.account;network=account.network;accountIndex=account.account;sourceMode=mode;privacyConsent=true;snapshot=s;syncComplete=true;history=oldHistory;historyTip={...s.tip};page='activity';activePayment=null;await refreshJournal();render();}
export function auditReconcileState(){return {snapshot,history,historyTip,sourceMode,syncComplete,journal,notification};}
export function auditChangeActive(id){activePayment=id;}
export function auditAbort(){currentAbort?.abort();}
export function auditPollPending(){return pendingMonitor.poll();}
export function auditPendingView(){return pendingView();}
export function auditStopPending(){pendingMonitor.stop();}
export function auditPendingPage(value){page=value;render();}
`;
harness =
  harness.replace("const appended = `", "const appended = `" + extra) +
  "\nexport {setup};\n";
const generated = resolve(root, ".tools/pending-status-review/harness.mjs");
await mkdir(resolve(root, ".tools/pending-status-review"), { recursive: true });
await writeFile(
  generated,
  (await transform(harness, { loader: "ts", format: "esm", target: "node24" }))
    .code,
);
const { setup } = await import(pathToFileURL(generated).href);
const fixture = JSON.parse(
  await readFile(resolve(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = sdk.accountFromJson({
  ...fixture.publicAccount,
  network: "mainnet",
});
const bundle = sdk.bundleFromJson({ ...fixture.bundle, network: "mainnet" });
const parsed = sdk.parseTransaction(fixture.rawTx);
const blockHash = (n: number) => n.toString(16).padStart(64, "0");
const tip = { height: 210, hash: blockHash(210) },
  block = { height: 205, hash: blockHash(205) };
const owned = new Map<
  string,
  { vout: number; branch: 0 | 1; index: number }[]
>();
for (const branch of [0, 1] as const)
  for (let index = 0; index < 41; index++) {
    const address = sdk.deriveAddress(account, branch, index);
    parsed.outputs.forEach((output, vout) => {
      if (sdk.hex(output.scriptPubKey) === sdk.hex(address.scriptPubKey)) {
        const rows = owned.get(address.address) ?? [];
        rows.push({ vout, branch, index });
        owned.set(address.address, rows);
      }
    });
  }
assert(owned.size > 0);
const baseSnapshot = () =>
  wallet.parseWatchSnapshot(
    JSON.stringify({
      schema: 1,
      account: sdk.accountToJson(account),
      genesisHash: sdk.NETWORKS.mainnet.genesisHash,
      tip: { height: 200, hash: blockHash(200) },
      coverage: {
        externalScannedThrough: 40,
        changeScannedThrough: 40,
        gapLimit: 20,
      },
      coins: [],
    }),
  );
const record = () => {
  const j = wallet.emptyJournal();
  wallet.reservePayment(j, bundle, "refresh-payment", Date.now() - 60_000);
  wallet.transitionPayment(j, "refresh-payment", "signing");
  wallet.transitionPayment(j, "refresh-payment", "signed", {
    rawTx: fixture.rawTx,
    txid: fixture.txid,
  });
  wallet.transitionPayment(j, "refresh-payment", "broadcast-unknown");
  wallet.transitionPayment(j, "refresh-payment", "accepted");
  return wallet.validateStoredJournal(j);
};
const previousHistory = [
  {
    txid: fixture.txid,
    received: 0n,
    spent: 1n,
    state: "confirmed",
    block: { height: 190, hash: blockHash(190) },
  },
];
function gate() {
  let open!: () => void;
  const promise = new Promise<void>((r) => (open = r));
  return { open, promise };
}
async function environment(
  mode: "public" | "local",
  options: {
    confirmations?: number;
    missing?: boolean;
    unavailable?: boolean;
    wait?: ReturnType<typeof gate>;
  } = {},
) {
  const t = await setup({
    protocol: mode === "public" ? "https:" : "http:",
    pathname: "/live.html",
  });
  const owner = wallet.accountId(account),
    j = record();
  t.c.rows.set(owner, structuredClone(j));
  await t.app.auditReconcileMount(
    baseSnapshot(),
    mode,
    structuredClone(previousHistory),
  );
  let waited = false;
  globalThis.fetch = async (route: any, init: any) => {
    const body = JSON.parse(init.body);
    t.c.requests.push({ route, body });
    if (options.wait && !waited) {
      waited = true;
      await options.wait.promise;
    }
    if (options.unavailable)
      return Response.json({ error: "fixture unavailable" }, { status: 503 });
    const visible = !options.missing;
    if (route === "/api/local/snapshot")
      return Response.json({
        schema: 1,
        sourceCommit: LOCAL_SOURCE_COMMIT,
        watchOnly: true,
        network: "mainnet",
        account: 0,
        publicAccount: sdk.accountToJson(account),
        genesisHash: sdk.NETWORKS.mainnet.genesisHash,
        tip,
        headerHeight: 210,
        filterHeight: 210,
        bestPeerHeight: 210,
        connections: 2,
        walletSynced: true,
        synced: true,
        ready: true,
        registeredThrough: [40, 40],
        lastUsed: visible ? [-1, 0] : [-1, -1],
        needsRegistration: false,
        restartRequired: false,
        coverage: {
          externalScannedThrough: 40,
          changeScannedThrough: 40,
          gapLimit: 20,
          scanComplete: true,
        },
        complete: true,
        transactions: visible
          ? [{ txid: fixture.txid, rawTransaction: fixture.rawTx, block }]
          : [],
        unspent: visible
          ? [...owned.values()]
              .flat()
              .map((o) => ({ txid: fixture.txid, vout: o.vout }))
          : [],
      });
    if (route === "/api/local/blockHash")
      return Response.json({
        height: body.height,
        hash: blockHash(body.height),
        tip,
      });
    assert.equal(route, "/api/indexer/read");
    const path = body.path;
    if (path === "/api/v2/")
      return Response.json({
        blockbook: {
          decimals: 8,
          inSync: true,
          initialSync: false,
          inSyncMempool: true,
          bestHeight: 210,
        },
        backend: { chain: "mainnet", blocks: 210, bestBlockHash: tip.hash },
      });
    if (path.startsWith("/api/v2/block-index/")) {
      const n = Number(path.split("/").at(-1));
      return Response.json({
        blockHash: n === 0 ? sdk.NETWORKS.mainnet.genesisHash : blockHash(n),
      });
    }
    if (path.startsWith("/api/v2/address/")) {
      const address = path.split("/").at(-1).split("?")[0],
        seen = visible && owned.has(address);
      return Response.json({
        address,
        txs: seen ? 1 : 0,
        unconfirmedTxs: 0,
        txids: seen ? [fixture.txid] : [],
        page: 1,
        totalPages: 1,
        itemsOnPage: 1000,
      });
    }
    if (path.startsWith("/api/v2/utxo/")) {
      const address = path.split("/").at(-1);
      return Response.json(
        (owned.get(address) ?? []).map((o) => ({
          txid: fixture.txid,
          vout: o.vout,
          height: 205,
        })),
      );
    }
    if (path === `/api/v2/tx/${fixture.txid}`)
      return Response.json({
        txid: fixture.txid,
        hex: fixture.rawTx,
        confirmations: options.confirmations ?? 6,
        blockHeight: 205,
        blockHash: block.hash,
      });
    assert.fail("Unexpected source request");
  };
  return { ...t, owner, initial: JSON.stringify(j) };
}
for (const mode of ["public", "local"] as const) {
  test(`${mode} refresh reads advancing chain and updates balance/history before archival`, async () => {
    const t = await environment(mode);
    t.event("reconcile");
    await t.settle();
    const state = t.app.auditReconcileState();
    assert(t.c.requests.length > 0);
    assert.equal(state.snapshot.tip.height, 210, state.notification);
    assert(state.snapshot.coins.length > 0);
    assert.equal(state.history[0].block.height, 205);
    assert.equal(state.historyTip.height, 210);
    assert.equal(state.sourceMode, mode);
    assert.equal(state.syncComplete, true);
    const saved = t.c.rows.get(t.owner);
    assert.equal(saved.payments[0].archived.block.height, 205);
    assert.equal(saved.payments[0].rawTx, fixture.rawTx);
    assert.equal(wallet.reservedOutpoints(saved).size, bundle.inputs.length);
  });
  for (const unavailable of [false, true])
    test(`${mode} ${unavailable ? "unavailable" : "missing transaction"} source does not release signed reservations`, async () => {
      const t = await environment(mode, { unavailable, missing: !unavailable });
      t.event("reconcile");
      await t.settle();
      const state = t.app.auditReconcileState(),
        saved = t.c.rows.get(t.owner);
      assert(t.c.requests.length > 0);
      assert.equal(saved.payments[0].rawTx, fixture.rawTx);
      assert.equal(saved.payments[0].state, "accepted");
      assert.equal(saved.payments[0].archived, undefined);
      assert.equal(wallet.reservedOutpoints(saved).size, bundle.inputs.length);
      if (unavailable) {
        assert.equal(state.snapshot.tip.height, 200);
        assert.equal(state.syncComplete, false);
      } else {
        assert.equal(state.snapshot.tip.height, 210);
        assert.equal(state.history[0].state, "detached");
      }
    });
}
for (const change of ["owner", "active payment", "abort"] as const)
  test(`${change} change during fresh read cannot apply or archive another view`, async () => {
    const wait = gate(),
      t = await environment("public", { wait });
    t.event("reconcile");
    while (t.c.requests.length === 0) await new Promise((r) => setImmediate(r));
    if (change === "owner") t.app.auditOwner({ ...account, account: 1 });
    else if (change === "active payment")
      t.app.auditChangeActive("another-payment");
    else t.app.auditAbort();
    wait.open();
    await t.settle();
    assert.equal(t.app.auditReconcileState().snapshot.tip.height, 200);
    assert.equal(t.c.rows.get(t.owner).payments[0].archived, undefined);
    assert.equal(t.c.rows.get(t.owner).payments[0].rawTx, fixture.rawTx);
  });

test("public pending monitor scans once on confirmation and updates the actual account", async (context) => {
  const t = await environment("public");
  context.after(() => t.app.auditStopPending());
  await t.app.auditReconcileMount(baseSnapshot(), "public", [
    { ...previousHistory[0], state: "pending", block: null },
  ]);
  await t.app.auditPollPending();
  const state = t.app.auditReconcileState();
  assert.equal(t.c.requests[0].body.path, `/api/v2/tx/${fixture.txid}`);
  assert.equal(
    t.c.requests.filter((r: any) => r.body.path === "/api/v2/").length,
    2,
  );
  assert.equal(state.snapshot.tip.height, 210);
  assert(state.snapshot.coins.length > 0);
  assert.equal(state.history[0].state, "confirmed");
  assert.equal(t.c.rows.get(t.owner).payments[0].archived.block.height, 205);
  assert.equal(t.app.auditPendingView().transactions.length, 0);
});

test("pending source failure keeps the real view and all signed reservations", async (context) => {
  const t = await environment("public", { unavailable: true });
  context.after(() => t.app.auditStopPending());
  await t.app.auditReconcileMount(baseSnapshot(), "public", [
    { ...previousHistory[0], state: "pending", block: null },
  ]);
  await t.app.auditPollPending();
  assert.equal(t.c.requests.length, 1);
  assert.equal(t.app.auditReconcileState().snapshot.tip.height, 200);
  assert.equal(t.c.rows.get(t.owner).payments[0].rawTx, fixture.rawTx);
  assert.equal(
    wallet.reservedOutpoints(t.c.rows.get(t.owner)).size,
    bundle.inputs.length,
  );
});

test("actual monitor eligibility excludes local, unsigned review and address display", async (context) => {
  const t = await environment("local");
  context.after(() => t.app.auditStopPending());
  assert.equal(t.app.auditPendingView(), null);
  await t.app.auditReconcileMount(baseSnapshot(), "public", [
    { ...previousHistory[0], state: "pending", block: null },
  ]);
  assert.equal(t.app.auditPendingView().transactions.length, 1);
  t.app.auditPendingPage("send");
  assert.equal(t.app.auditPendingView(), null);
  t.app.auditPendingPage("receive");
  assert.equal(t.app.auditPendingView(), null);
});

test("owned payment confirmations two through five stay cheap; sixth scans, archives, and stops", async (context) => {
  const options = { confirmations: 2 };
  const t = await environment("public", options);
  context.after(() => t.app.auditStopPending());
  const secondBlock = {
    ...baseSnapshot(),
    tip: { height: 206, hash: blockHash(206) },
  };
  await t.app.auditReconcileMount(secondBlock, "public", [
    { ...previousHistory[0], block },
  ]);
  for (const confirmations of [2, 3, 4, 5]) {
    options.confirmations = confirmations;
    await t.app.auditPollPending();
  }
  assert.equal(t.c.requests.length, 4);
  assert(
    t.c.requests.every(
      (r: any) => r.body.path === `/api/v2/tx/${fixture.txid}`,
    ),
  );
  assert.equal(t.c.rows.get(t.owner).payments[0].archived, undefined);
  options.confirmations = 6;
  await t.app.auditPollPending();
  assert.equal(
    t.c.requests.filter((r: any) => r.body.path === "/api/v2/").length,
    2,
  );
  assert.equal(t.c.rows.get(t.owner).payments[0].archived.block.height, 205);
  assert.equal(t.app.auditPendingView().transactions.length, 0);
  const requests = t.c.requests.length;
  await t.app.auditPollPending();
  assert.equal(t.c.requests.length, requests);
});

test("manual recheck detaches an archived payment after reorg without releasing signed inputs", async () => {
  const t = await environment("public", { missing: true });
  const j = t.c.rows.get(t.owner);
  wallet.reconcileConfirmed(j, previousHistory as any, baseSnapshot().tip);
  assert(j.payments[0].archived);
  t.c.rows.set(t.owner, j);
  t.event("reconcile");
  await t.settle();
  const saved = t.c.rows.get(t.owner);
  assert.equal(saved.payments[0].archived, undefined);
  assert.equal(saved.payments[0].rawTx, fixture.rawTx);
  assert.equal(wallet.reservedOutpoints(saved).size, bundle.inputs.length);
  assert.equal(t.app.auditReconcileState().history[0].state, "detached");
});

test("restored mature history still reconciles an unarchived submitted journal record", async (context) => {
  const t = await environment("public");
  context.after(() => t.app.auditStopPending());
  await t.app.auditReconcileMount({ ...baseSnapshot(), tip }, "public", [
    { ...previousHistory[0], block },
  ]);
  assert.equal(t.app.auditPendingView().transactions.length, 1);
  assert.equal(t.c.rows.get(t.owner).payments[0].archived, undefined);
  await t.app.auditPollPending();
  assert.equal(t.c.rows.get(t.owner).payments[0].archived.block.height, 205);
  assert.equal(t.app.auditPendingView().transactions.length, 0);
});
