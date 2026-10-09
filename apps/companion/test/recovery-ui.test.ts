import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  accountToJson,
  deriveAddress,
  concat,
  i32,
  u32,
  u64,
  compactSize,
  hex,
  parseTransaction,
  NETWORKS,
} from "@pearl-ledger/sdk";
import {
  importWalletBackup,
  importPublicRecovery,
  discoverAccount,
  type WalletJournal,
  type WatchSnapshot,
} from "@pearl-ledger/wallet";
import {
  publicAccount,
  blockHash,
} from "../../../packages/wallet/test/fixtures.js";

// Exercise actual main.ts import/export handlers with local public transaction
// bytes. DOM, IndexedDB, downloads, and the unused device connector are isolated
// stubs. This is not a browser-upload, hardware, or production-network test.
function coin(branch: 0 | 1, index: number) {
  const script = deriveAddress(publicAccount, branch, index).scriptPubKey;
  const raw = concat(
    i32(1),
    Uint8Array.of(1),
    new Uint8Array(32).fill(0x11),
    u32(0),
    Uint8Array.of(0),
    u32(0xffffffff),
    Uint8Array.of(1),
    u64(500000000n),
    compactSize(script.length),
    script,
    u32(0),
  );
  return {
    txid: parseTransaction(raw).txid,
    vout: 0,
    rawTransaction: hex(raw),
    branch,
    index,
    block: { height: 1, hash: blockHash(1) },
  };
}
function snapshot(coins: ReturnType<typeof coin>[]) {
  return {
    schema: 1,
    account: accountToJson(publicAccount),
    genesisHash: NETWORKS.regtest.genesisHash,
    tip: { height: 200, hash: blockHash(200) },
    coverage: {
      externalScannedThrough: 0x7fffffff,
      changeScannedThrough: 0x7fffffff,
      gapLimit: 20,
    },
    coins,
  };
}
test("actual snapshot import persists only owned paths and fresh exports preserve another tab's journal", async (t) => {
  const listeners = new Map<string, () => void>();
  const downloads: Promise<string>[] = [];
  const originals = Object.fromEntries(
    ["document", "window", "BroadcastChannel", "fetch"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  const createObjectURL = URL.createObjectURL,
    revokeObjectURL = URL.revokeObjectURL;
  t.after(() => {
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  Object.assign(globalThis, {
    document: {
      querySelector: () => ({ innerHTML: "" }),
      querySelectorAll: () => [],
      getElementById: (id: string) => ({
        addEventListener: (event: string, fn: () => void) => {
          if (event === "click") listeners.set(id, fn);
        },
      }),
      createElement: () => ({ click() {} }),
    },
    window: { addEventListener() {} },
    BroadcastChannel: class {
      postMessage() {}
    },
  });
  URL.createObjectURL = (blob) => {
    assert(blob instanceof Blob);
    downloads.push(blob.text());
    return "blob:public-test-only";
  };
  URL.revokeObjectURL = () => {};
  const built = await build({
    stdin: {
      contents:
        (await readFile(new URL("../src/main.ts", import.meta.url), "utf8")) +
        `
export { importSnapshot, syncPublic };
export function state() { return { account, journal, snapshot, busy, syncComplete }; }
export function consent() { privacyConsent = true; }
export async function otherTab(receive, change) {
  await store.mutate(accountId(account), j => { j.issuedReceiveThrough = receive; j.nextChangeIndex = change; });
}`,
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    plugins: [
      {
        name: "public-state-boundaries",
        setup(build) {
          build.onResolve(
            { filter: /^\.\/(ledger\.js|storage\.js|styles\.css)$/ },
            (args) => ({ path: args.path, namespace: "test-boundary" }),
          );
          build.onLoad(
            { filter: /.*/, namespace: "test-boundary" },
            (args) => ({
              loader: "js",
              contents: args.path.includes("ledger")
                ? 'export async function connectLedger() { throw Error("No device in this test"); }'
                : args.path.includes("storage")
                  ? `export class WatchStorage {
          constructor() { this.rows = new Map(); }
          async journal(k) { return structuredClone(this.rows.get(k) ?? { schema: 1, payments: [], nextChangeIndex: 0, issuedReceiveThrough: -1 }); }
          async mutate(k, update) { const j = await this.journal(k); const value = update(j); this.rows.set(k, structuredClone(j)); return value; }
        }`
                  : "",
            }),
          );
        },
      },
    ],
  });
  const app = (await import(
    "data:text/javascript;base64," +
      Buffer.from(built.outputFiles[0]!.text).toString("base64")
  )) as {
    importSnapshot(text: string): Promise<void>;
    state(): {
      journal: WalletJournal;
      busy: boolean;
      snapshot: WatchSnapshot;
      syncComplete: boolean;
    };
    syncPublic(): Promise<void>;
    consent(): void;
    otherTab(receive: number, change: number): Promise<void>;
  };
  const known = [coin(0, 100), coin(1, 110)];
  await app.importSnapshot(JSON.stringify(snapshot(known)));
  assert.equal(app.state().journal.issuedReceiveThrough, 100);
  assert.equal(app.state().journal.nextChangeIndex, 111);
  await app.importSnapshot(JSON.stringify(snapshot([coin(0, 1)])));
  assert.equal(app.state().journal.issuedReceiveThrough, 100);
  assert.equal(app.state().journal.nextChangeIndex, 111);
  await assert.rejects(
    app.importSnapshot(JSON.stringify(snapshot([coin(1, 0x7fffffff)]))),
    /exhausted/,
  );
  assert.equal(app.state().journal.nextChangeIndex, 111);
  const forged = snapshot([coin(0, 200)]);
  forged.coins[0]!.index = 201;
  await assert.rejects(app.importSnapshot(JSON.stringify(forged)), /not owned/);
  assert.equal(app.state().journal.issuedReceiveThrough, 100);

  // A different tab has durably updated metadata, but this tab has not received
  // its broadcast event. Both handlers must read the atomic store, not cache.
  await app.otherTab(150, 161);
  assert.equal(app.state().journal.issuedReceiveThrough, 100);
  async function download(id: string) {
    listeners.get(id)!();
    for (let i = 0; app.state().busy && i < 100; i++)
      await new Promise<void>((resolve) => setImmediate(resolve));
    assert.equal(app.state().busy, false);
    assert(downloads.length);
    return downloads.shift()!;
  }
  const full = importWalletBackup(await download("backup-export"));
  const publicRecord = importPublicRecovery(await download("export-public"));
  for (const restored of [full.journal, publicRecord]) {
    assert.equal(restored.issuedReceiveThrough, 150);
    assert.equal(restored.nextChangeIndex, 161);
  }
  const byAddress = new Map(
    known.map((c) => [
      deriveAddress(publicAccount, c.branch, c.index).address,
      c,
    ]),
  );
  const result = await discoverAccount(
    {
      network: "regtest",
      tip: async () => ({
        tip: snapshot(known).tip,
        genesisHash: NETWORKS.regtest.genesisHash,
      }),
      blockHash: async (height) => blockHash(height),
      address: async (address) => {
        const c = byAddress.get(address);
        return {
          used: !!c,
          confirmedTxCount: c ? 1 : 0,
          pendingTxCount: 0,
          txids: c ? [c.txid] : [],
          utxos: c ? [{ txid: c.txid, vout: 0, height: 1 }] : [],
        };
      },
      transaction: async (txid) => {
        const c = known.find((c) => c.txid === txid)!;
        return {
          rawTransaction: c.rawTransaction,
          block: c.block,
          confirmations: 200,
        };
      },
    },
    full.account,
    {
      minimumIndex: [
        full.journal.issuedReceiveThrough,
        full.journal.nextChangeIndex - 1,
      ],
    },
  );
  assert.equal(result.snapshot.coins.length, 2);

  // Discovery must consult the durable journal before the request and reject a
  // response whose requested range became stale while another tab was writing.
  await app.importSnapshot(JSON.stringify(snapshot(known)));
  app.consent();
  await app.otherTab(200, 211);
  let requested: { minimumIndex: [number, number] } | undefined;
  globalThis.fetch = async (_url, init) => {
    requested = JSON.parse(String(init!.body));
    throw new Error("capture-only");
  };
  await assert.rejects(app.syncPublic(), /capture-only/);
  assert.deepEqual(requested!.minimumIndex, [200, 210]);
  let release!: () => void, entered!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const started = new Promise<void>((resolve) => {
    entered = resolve;
  });
  globalThis.fetch = async (_url, init) => {
    const request = JSON.parse(String(init!.body)) as {
      minimumIndex: [number, number];
    };
    entered();
    await gate;
    return new Response(
      JSON.stringify({
        complete: true,
        history: [],
        lastUsed: [-1, -1],
        snapshot: {
          ...snapshot([]),
          coverage: {
            externalScannedThrough: request.minimumIndex[0] + 20,
            changeScannedThrough: request.minimumIndex[1] + 20,
            gapLimit: 20,
          },
        },
      }),
    );
  };
  const pending = app.syncPublic();
  await started;
  await app.otherTab(300, 311);
  release();
  await assert.rejects(pending, /Recovery bounds changed/);
  assert.equal(app.state().syncComplete, false);
  assert.equal(app.state().snapshot.coins.length, 2);
});
