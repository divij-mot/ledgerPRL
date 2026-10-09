import { test } from "node:test";
import assert from "node:assert/strict";
import { Worker } from "node:worker_threads";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "esbuild";
import { accountFromJson, decodeBundle, fromHex } from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  exportWalletBackup,
  importWalletBackup,
  MAX_BACKUP_BYTES,
} from "@pearl-ledger/wallet";
import type { BackupImportResponse } from "../src/backup-import.js";

// A Node worker_threads shim runs the actual browser worker entry and unchanged
// wallet validator. This establishes independent-thread validation and message
// semantics, not browser CSP, browser scheduling or real IndexedDB behavior.
test("actual worker validates exact signed bytes and rejects the same malformed backups", async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "prl-backup-worker-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const entry = fileURLToPath(
    new URL("../src/backup-import.worker.ts", import.meta.url),
  );
  const built = await build({
    stdin: {
      contents: `import { parentPort } from "node:worker_threads";
        globalThis.self = { onmessage: null, postMessage: message => parentPort.postMessage(message), close: () => parentPort.close() };
        parentPort.on("message", data => globalThis.self.onmessage?.({data}));
        await import(${JSON.stringify(entry)});`,
      resolveDir: fileURLToPath(new URL("../src/", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    logLevel: "silent",
  });
  const workerPath = join(directory, "worker.mjs");
  await writeFile(workerPath, built.outputFiles[0]!.text);
  async function validate(input: unknown): Promise<BackupImportResponse> {
    const worker = new Worker(workerPath);
    try {
      const result = new Promise<BackupImportResponse>((resolve, reject) => {
        worker.once("message", resolve);
        worker.once("error", reject);
        worker.once("exit", (code) => {
          if (code) reject(new Error(`Worker exited ${code}`));
        });
      });
      const exited = new Promise<number>((resolve) =>
        worker.once("exit", resolve),
      );
      worker.postMessage(input);
      const response = await result;
      assert.equal(await exited, 0, "the one-shot worker must close itself");
      return response;
    } finally {
      await worker.terminate();
    }
  }
  const vector = JSON.parse(
    await readFile(
      new URL("../../../fixtures/protocol-v1.json", import.meta.url),
      "utf8",
    ),
  );
  const account = accountFromJson(vector.publicAccount);
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
  const text = exportWalletBackup(account, journal);
  const success = await validate(new Blob([text]));
  assert.equal(success.ok, true);
  assert.deepEqual(success.backup, importWalletBackup(text));
  assert(success.backup.account.publicKey instanceof Uint8Array);
  assert.equal(success.backup.journal.payments[0]!.rawTx, vector.rawTx);
  for (const mutate of [
    (v: any) =>
      (v.journal.payments[0].rawTx = v.journal.payments[0].rawTx.replace(
        "0baf38",
        "0baf39",
      )),
    (v: any) => (v.journal.payments[0].outpoints = []),
    (v: any) => (v.account.account = 1),
    (v: any) => (v.journal.payments[0].state = "draft"),
    (v: any) => (v.journal.nextChangeIndex = 0),
  ]) {
    const changed = JSON.parse(text);
    mutate(changed);
    const invalid = JSON.stringify(changed);
    let expected = "";
    assert.throws(
      () => importWalletBackup(invalid),
      (error: Error) => {
        expected = error.message;
        return true;
      },
    );
    const response = await validate(new Blob([invalid]));
    assert.deepEqual(response, { ok: false, error: expected });
  }
  for (const input of [
    "not a Blob",
    new Blob(["{"]),
    new Blob([new Uint8Array(MAX_BACKUP_BYTES + 1)]),
  ]) {
    assert.equal((await validate(input)).ok, false);
  }
  // The Blob byte cap alone is insufficient: decoding invalid UTF-8 can expand
  // replacement characters. The existing validator's second UTF-8 cap remains.
  const expanded = await validate(
    new Blob([new Uint8Array(MAX_BACKUP_BYTES / 2).fill(0xff)]),
  );
  assert.deepEqual(expanded, { ok: false, error: "Backup exceeds 16 MiB" });
});
