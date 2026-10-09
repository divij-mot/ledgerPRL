import { test } from "node:test";
import assert from "node:assert/strict";
import { getEventListeners } from "node:events";
import { importWalletBackupFile } from "../src/backup-import.js";
import {
  emptyJournal,
  MAX_BACKUP_BYTES,
  type WalletBackup,
} from "@pearl-ledger/wallet";
import { publicAccount } from "../../../packages/wallet/test/fixtures.js";

// Worker transport is modeled here. The real worker/validator is covered by
// backup-import-worker.test.ts; no browser upload or profile is used.
class FakeWorker {
  static instances: FakeWorker[] = [];
  static failConstruct = false;
  static failPost = false;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  terminations = 0;
  input?: Blob;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    if (FakeWorker.failConstruct) throw new Error("Worker startup failed");
    FakeWorker.instances.push(this);
  }
  postMessage(file: Blob) {
    if (FakeWorker.failPost) throw new Error("Cannot clone input");
    this.input = file;
  }
  terminate() {
    this.terminations++;
  }
}
const backup: WalletBackup = {
  schema: 2,
  kind: "pearl-watch-backup",
  account: publicAccount,
  journal: emptyJournal(),
};
function send(worker: FakeWorker, data: unknown) {
  worker.onmessage?.({ data } as MessageEvent);
}

test("bounded one-shot worker preserves validation results and releases every resource", async (t) => {
  const original = Object.getOwnPropertyDescriptor(globalThis, "Worker");
  Object.assign(globalThis, { Worker: FakeWorker });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "Worker", original);
    else Reflect.deleteProperty(globalThis, "Worker");
  });
  const file = new Blob(["public backup"]);
  file.text = async () => {
    throw new Error("Main thread must not read backup bytes");
  };
  await t.test(
    "successful response, immutable Blob, fixed local module URL and listener cleanup",
    async () => {
      const controller = new AbortController();
      const pending = importWalletBackupFile(file, controller.signal);
      const worker = FakeWorker.instances.at(-1)!;
      assert.equal(worker.input, file);
      assert.equal(worker.options.type, "module");
      assert.equal(
        worker.url.pathname.endsWith("/backup-import.worker.ts"),
        true,
      );
      assert.equal(getEventListeners(controller.signal, "abort").length, 1);
      send(worker, { ok: true, backup });
      assert.deepEqual(await pending, backup);
      assert.equal(worker.terminations, 1);
      assert.equal(worker.onmessage, null);
      assert.equal(worker.onerror, null);
      assert.equal(worker.onmessageerror, null);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
      controller.abort();
      assert.equal(worker.terminations, 1);
    },
  );
  await t.test(
    "pre-abort and oversize inputs never start a worker",
    async () => {
      const count = FakeWorker.instances.length;
      const controller = new AbortController();
      controller.abort(new Error("Already cancelled"));
      await assert.rejects(
        importWalletBackupFile(file, controller.signal),
        /Already cancelled/,
      );
      await assert.rejects(
        importWalletBackupFile(
          new Blob([new Uint8Array(MAX_BACKUP_BYTES + 1)]),
          new AbortController().signal,
        ),
        /exceeds 16 MiB/,
      );
      assert.equal(FakeWorker.instances.length, count);
    },
  );
  await t.test(
    "abort terminates immediately and stale completion cannot settle another operation",
    async () => {
      const controller = new AbortController();
      const pending = importWalletBackupFile(file, controller.signal);
      const worker = FakeWorker.instances.at(-1)!;
      const late = worker.onmessage!;
      controller.abort(new Error("User cancelled"));
      await assert.rejects(pending, /User cancelled/);
      const next = importWalletBackupFile(file, new AbortController().signal);
      const nextWorker = FakeWorker.instances.at(-1)!;
      late({ data: { ok: true, backup } } as MessageEvent);
      assert.equal(worker.terminations, 1);
      assert.equal(nextWorker.terminations, 0);
      send(nextWorker, { ok: true, backup });
      assert.deepEqual(await next, backup);
      assert.equal(getEventListeners(controller.signal, "abort").length, 0);
    },
  );
  for (const kind of [
    "validation",
    "runtime",
    "message",
    "malformed",
    "post",
  ] as const) {
    await t.test(
      `${kind} failure rejects without a fallback and terminates`,
      async () => {
        FakeWorker.failPost = kind === "post";
        const controller = new AbortController();
        const pending = importWalletBackupFile(file, controller.signal);
        const worker = FakeWorker.instances.at(-1)!;
        if (kind === "validation")
          send(worker, { ok: false, error: "Invalid signature" });
        if (kind === "runtime") worker.onerror!();
        if (kind === "message") worker.onmessageerror!();
        if (kind === "malformed") send(worker, { ok: "unexpected" });
        await assert.rejects(
          pending,
          /Invalid signature|worker failed|validation result|validator response|Cannot clone/,
        );
        assert.equal(worker.terminations, 1);
        assert.equal(getEventListeners(controller.signal, "abort").length, 0);
        FakeWorker.failPost = false;
      },
    );
  }
  await t.test("worker construction error stays an error", async () => {
    FakeWorker.failConstruct = true;
    await assert.rejects(
      importWalletBackupFile(file, new AbortController().signal),
      /Worker startup failed/,
    );
    FakeWorker.failConstruct = false;
  });
});
