import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import {
  accountFromJson,
  decodeBundle,
  fromHex,
  type AccountPublicKey,
} from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  exportWalletBackup,
  importWalletBackup,
  type WalletJournal,
} from "@pearl-ledger/wallet";

// Actual main.ts event handler and worker wrapper, with controlled worker/DOM/
// storage/device boundaries. No browser, upload, hardware or broadcast is used.
function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}
async function until(condition: () => boolean) {
  for (let i = 0; i < 5000 && !condition(); i++)
    await new Promise((resolve) => setTimeout(resolve, 1));
  assert(condition(), "expected UI boundary was not reached");
}

test("actual backup handler cancels safely, rejects stale work and atomically merges current storage", async (t) => {
  const originals = Object.fromEntries(
    [
      "document",
      "window",
      "BroadcastChannel",
      "Worker",
      "backupStorageGate",
    ].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  t.after(() => {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  });
  const listeners = new Map<string, (event?: unknown) => void>();
  const notifications: string[] = [];
  class FakeWorker {
    static instances: FakeWorker[] = [];
    onmessage: ((event: MessageEvent) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminations = 0;
    constructor() {
      FakeWorker.instances.push(this);
    }
    postMessage() {}
    terminate() {
      this.terminations++;
    }
  }
  Object.assign(globalThis, {
    document: {
      querySelector: () => ({ innerHTML: "" }),
      querySelectorAll: () => [],
      getElementById: (id: string) => ({
        addEventListener: (event: string, callback: () => void) =>
          listeners.set(`${id}:${event}`, callback),
      }),
    },
    window: { addEventListener() {} },
    Worker: FakeWorker,
    BroadcastChannel: class {
      postMessage(value: string) {
        notifications.push(value);
      }
    },
  });
  const source =
    (await readFile(new URL("../src/main.ts", import.meta.url), "utf8")) +
    `
export function testState() { return { account, busy, notification, page, journal, client, transport }; }
export function testOwner(a) { account = a; network = a?.network ?? 'regtest'; }
export function testTransport(t) { transport = t; client = {}; }
export async function testSeed(a,j) { await store.mutate(accountId(a), current => Object.assign(current, structuredClone(j))); }
export function testSaved(a) { return store.journal(accountId(a)); }
`;
  const built = await build({
    stdin: {
      contents: source,
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
    // A data-URL test module has no relative URL base; production uses Vite's
    // real module URL, independently checked by the serving-policy regression.
    define: {
      "import.meta.url": JSON.stringify(
        new URL("../src/main.ts", import.meta.url).href,
      ),
    },
    plugins: [
      {
        name: "backup-ui-boundaries",
        setup(build) {
          build.onResolve(
            { filter: /^\.\/(ledger\.js|storage\.js)$/ },
            (args) => ({ path: args.path, namespace: "backup-test" }),
          );
          build.onLoad({ filter: /.*/, namespace: "backup-test" }, (args) => ({
            loader: "js",
            contents: args.path.includes("ledger")
              ? 'export async function connectLedger() { throw Error("No device in this test"); }'
              : `export class WatchStorage {
            constructor() { this.rows = new Map(); }
            async journal(k) { return structuredClone(this.rows.get(k) ?? {schema:1,payments:[],nextChangeIndex:0,issuedReceiveThrough:-1}); }
            async mutate(k, update) {
              await globalThis.backupStorageGate?.('before-read');
              const j = await this.journal(k);
              await globalThis.backupStorageGate?.('before-update');
              const result = update(j); this.rows.set(k, structuredClone(j));
              await globalThis.backupStorageGate?.('after-commit'); return result;
            }
          }`,
          }));
        },
      },
    ],
  });
  const app = (await import(
    "data:text/javascript;base64," +
      Buffer.from(built.outputFiles[0]!.text).toString("base64")
  )) as {
    testState(): {
      account: AccountPublicKey | null;
      busy: boolean;
      notification: string;
      page: string;
      client: unknown;
      transport: unknown;
    };
    testOwner(a: AccountPublicKey | null): void;
    testSeed(a: AccountPublicKey, j: WalletJournal): Promise<void>;
    testSaved(a: AccountPublicKey): Promise<WalletJournal>;
    testTransport(t: { close(): Promise<void> }): void;
  };
  const vector = JSON.parse(
    await readFile(
      new URL("../../../fixtures/protocol-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const account = accountFromJson(vector.publicAccount);
  const alternate = { ...account, account: account.account + 1 };
  const journal = emptyJournal();
  reservePayment(
    journal,
    decodeBundle(fromHex(vector.bundleHex)),
    "payment-fixture",
    1000,
  );
  transitionPayment(journal, "payment-fixture", "signing");
  transitionPayment(journal, "payment-fixture", "signed", {
    rawTx: vector.rawTx,
    txid: vector.txid,
  });
  const backup = importWalletBackup(exportWalletBackup(account, journal));
  const file = new Blob(["worker input"]);
  function start() {
    listeners.get("backup-file:change")!({ target: { files: [file] } });
    assert.equal(app.testState().busy, true);
    return FakeWorker.instances.at(-1)!;
  }
  function success(worker: FakeWorker) {
    worker.onmessage?.({ data: { ok: true, backup } } as MessageEvent);
  }
  function cancel() {
    listeners.get("cancel-device:click")!();
  }
  async function idle() {
    await until(() => !app.testState().busy);
  }
  function setGate(fn?: (phase: string) => Promise<void>) {
    Object.assign(globalThis, { backupStorageGate: fn });
  }

  await t.test(
    "busy prevents repeat imports; cancellation terminates and ignores late replies after an account switch",
    async () => {
      app.testOwner(alternate);
      const worker = start(),
        late = worker.onmessage!;
      const count = FakeWorker.instances.length;
      start();
      assert.equal(FakeWorker.instances.length, count);
      cancel();
      await idle();
      assert.equal(worker.terminations, 1);
      app.testOwner(null);
      late({ data: { ok: true, backup } } as MessageEvent);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(app.testState().account, null);
      assert.deepEqual(await app.testSaved(account), emptyJournal());
    },
  );
  await t.test(
    "account changes during validation reject before any merge",
    async () => {
      app.testOwner(alternate);
      const worker = start();
      app.testOwner(null);
      success(worker);
      await idle();
      assert.match(app.testState().notification, /Account changed/);
      assert.deepEqual(await app.testSaved(account), emptyJournal());
    },
  );
  await t.test(
    "cancel while storage is queued prevents its atomic update",
    async () => {
      app.testOwner(alternate);
      const paused = gate();
      let entered = false;
      setGate(async (phase) => {
        if (phase === "before-update") {
          entered = true;
          await paused.promise;
        }
      });
      const worker = start();
      success(worker);
      await until(() => entered);
      cancel();
      paused.release();
      await idle();
      setGate();
      assert.deepEqual(await app.testSaved(account), emptyJournal());
      assert.equal(app.testState().account, alternate);
    },
  );
  await t.test(
    "an interleaved latest journal is merged without downgrading state or losing bounds",
    async () => {
      app.testOwner(alternate);
      const paused = gate();
      let entered = false;
      setGate(async (phase) => {
        if (phase === "before-read" && !entered) {
          entered = true;
          await paused.promise;
        }
      });
      const worker = start();
      success(worker);
      await until(() => entered);
      const newer = structuredClone(journal);
      newer.payments[0]!.state = "broadcast-unknown";
      newer.issuedReceiveThrough = 25;
      newer.nextChangeIndex = 26;
      await app.testSeed(account, newer);
      paused.release();
      await idle();
      setGate();
      const saved = await app.testSaved(account);
      assert.equal(saved.payments[0]!.state, "broadcast-unknown");
      assert.equal(saved.payments[0]!.rawTx, vector.rawTx);
      assert.equal(saved.issuedReceiveThrough, 25);
      assert.equal(saved.nextChangeIndex, 26);
      assert.equal(app.testState().page, "activity");
      assert.deepEqual(app.testState().account, account);
    },
  );
  await t.test(
    "conflicting payment leaves the atomic journal and current account unchanged",
    async () => {
      app.testOwner(alternate);
      const conflicting = structuredClone(journal);
      conflicting.payments[0]!.id = "conflict-payment";
      await app.testSeed(account, conflicting);
      const worker = start();
      success(worker);
      await idle();
      assert.match(
        app.testState().notification,
        /conflicts with an existing reservation/,
      );
      assert.deepEqual(await app.testSaved(account), conflicting);
      assert.equal(app.testState().account, alternate);
    },
  );
  await t.test(
    "cancel after durable merge reports saved reservations and does not switch accounts",
    async () => {
      await app.testSeed(account, emptyJournal());
      app.testOwner(alternate);
      const paused = gate();
      let entered = false;
      setGate(async (phase) => {
        if (phase === "after-commit") {
          entered = true;
          await paused.promise;
        }
      });
      const worker = start();
      success(worker);
      await until(() => entered);
      cancel();
      paused.release();
      await idle();
      setGate();
      assert.match(
        app.testState().notification,
        /Backup merged;.*cancelled.*remain saved/,
      );
      assert.equal(
        (await app.testSaved(account)).payments[0]!.rawTx,
        vector.rawTx,
      );
      assert.equal(app.testState().account, alternate);
    },
  );
  await t.test(
    "cancel during device closure cannot apply a stale account completion",
    async () => {
      app.testOwner(alternate);
      const paused = gate();
      let entered = false;
      app.testTransport({
        close: async () => {
          entered = true;
          await paused.promise;
        },
      });
      const worker = start();
      success(worker);
      await until(() => entered);
      cancel();
      paused.release();
      await idle();
      assert.equal(app.testState().account, alternate);
      assert.equal(app.testState().client, null);
      assert.equal(app.testState().transport, null);
      assert.match(app.testState().notification, /Backup merged;.*cancelled/);
    },
  );
  assert(
    notifications.includes("journal"),
    "committed merges notify other tabs",
  );
});
