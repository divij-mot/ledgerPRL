/**
 * Offline Node-only replay of the actual backup worker and its client wrapper.
 * Uses an external PUBLIC deterministic journal, never a user wallet or seed.
 * The Worker API below is a Node adapter: this is not browser/CSP qualification.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Worker as NodeWorker } from "node:worker_threads";

const root = path.resolve(process.env.PRL_ROOT ?? process.cwd());
const journalArgument = process.env.PRL_REVIEW_JOURNAL;
assert(
  journalArgument,
  "Set PRL_REVIEW_JOURNAL to the generated public journal JSON",
);
const journalPath = path.resolve(journalArgument);
const output = path.resolve(
  process.env.PRL_REVIEW_OUTPUT ??
    path.join(os.tmpdir(), "prl-import-worker-replay"),
);
function integer(name, fallback, min, max) {
  const value = Number(process.env[name] ?? fallback);
  assert(
    Number.isSafeInteger(value) && value >= min && value <= max,
    `Invalid ${name}`,
  );
  return value;
}
const expectedRecords = integer("PRL_EXPECTED_RECORDS", 2000, 1, 2000);
const expectedSignatures = integer(
  "PRL_EXPECTED_SIGNATURES",
  expectedRecords * 16,
  1,
  32000,
);
const cancelDelayMs = integer("PRL_CANCEL_DELAY_MS", 150, 0, 60000);
const timeoutMs = integer("PRL_WORKER_TIMEOUT_MS", 900000, 1000, 3600000);
const intervalMs = 25;
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shaFile = async (filename) => hash(await fs.readFile(filename));
const sourcePaths = [
  "package-lock.json",
  "apps/companion/index.html",
  "apps/companion/vite.config.ts",
  "apps/companion/src/backup-import.ts",
  "apps/companion/src/backup-import.worker.ts",
  "apps/companion/src/main.ts",
  "apps/companion/src/storage.ts",
];
for (const directory of ["packages/sdk/src", "packages/wallet/src"])
  for (const name of (await fs.readdir(path.join(root, directory))).sort())
    if (name.endsWith(".ts")) sourcePaths.push(`${directory}/${name}`);
const sourceHashes = Object.fromEntries(
  await Promise.all(
    sourcePaths
      .sort()
      .map(async (name) => [name, await shaFile(path.join(root, name))]),
  ),
);
const input = await fs.readFile(journalPath);
assert(
  input.length <= 16 * 1024 * 1024,
  "Input exceeds 16 MiB before worker startup",
);
const inputSha256 = hash(input);
if (process.env.PRL_EXPECTED_JOURNAL_SHA256)
  assert.equal(
    inputSha256,
    process.env.PRL_EXPECTED_JOURNAL_SHA256,
    "Public fixture SHA-256 mismatch",
  );
const blob = new Blob([input]);
const require = createRequire(path.join(root, "package.json"));
const { build } = require("esbuild");
const temporary = await fs.mkdtemp(
  path.join(os.tmpdir(), "prl-import-worker-"),
);
const workers = [];
let started = () => {};
let timer;
let watchdog;
const originalWorker = Object.getOwnPropertyDescriptor(globalThis, "Worker");
try {
  const workerEntry = path.join(
    root,
    "apps/companion/src/backup-import.worker.ts",
  );
  const alias = {
    "@pearl-ledger/sdk": path.join(root, "packages/sdk/src/index.ts"),
    "@pearl-ledger/wallet": path.join(root, "packages/wallet/src/index.ts"),
  };
  async function bundle(filename, contents) {
    const result = await build({
      stdin: { contents, resolveDir: root, loader: "ts" },
      alias,
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      logLevel: "silent",
    });
    await fs.writeFile(filename, result.outputFiles[0].text);
  }
  const workerPath = path.join(temporary, "worker.mjs");
  await bundle(
    workerPath,
    `
    import { parentPort } from "node:worker_threads";
    globalThis.self = {
      onmessage: null,
      postMessage: message => parentPort.postMessage(message),
      close: () => parentPort.close(),
    };
    parentPort.on("message", data => {
      parentPort.postMessage({ replayStarted: true });
      globalThis.self.onmessage?.({ data });
    });
    await import(${JSON.stringify(workerEntry)});
  `,
  );
  const clientPath = path.join(temporary, "client.mjs");
  await bundle(
    clientPath,
    `
    export { importWalletBackupFile } from ${JSON.stringify(path.join(root, "apps/companion/src/backup-import.ts"))};
    export { emptyJournal, mergeRestoredJournal, reservedOutpoints } from "@pearl-ledger/wallet";
  `,
  );
  const {
    importWalletBackupFile,
    emptyJournal,
    mergeRestoredJournal,
    reservedOutpoints,
  } = await import(pathToFileURL(clientPath));
  class BrowserWorkerAdapter {
    onmessage = null;
    onerror = null;
    onmessageerror = null;
    terminations = 0;
    constructor(url, options) {
      assert(url.pathname.endsWith("/backup-import.worker.ts"));
      assert.equal(options.type, "module");
      this.inner = new NodeWorker(workerPath);
      this.exited = new Promise((resolve) => this.inner.once("exit", resolve));
      this.inner.on("message", (data) => {
        if (data.replayStarted === true) started();
        else this.onmessage?.({ data });
      });
      this.inner.on("error", (error) => this.onerror?.(error));
      this.inner.on("messageerror", (error) => this.onmessageerror?.(error));
      workers.push(this);
    }
    postMessage(value) {
      this.inner.postMessage(value);
    }
    terminate() {
      this.terminations++;
      void this.inner.terminate();
    }
  }
  Object.defineProperty(globalThis, "Worker", {
    configurable: true,
    writable: true,
    value: BrowserWorkerAdapter,
  });
  const controller = new AbortController();
  const startup = new Promise((resolve) => {
    started = resolve;
  });
  let settled = false;
  const cancelled = importWalletBackupFile(blob, controller.signal);
  void cancelled.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  watchdog = setTimeout(
    () => controller.abort(new Error("Cancellation replay deadline exceeded")),
    timeoutMs,
  );
  await Promise.race([startup, cancelled]);
  await new Promise((resolve) => setTimeout(resolve, cancelDelayMs));
  assert(
    !settled,
    "Import completed before cancellation; shorten PRL_CANCEL_DELAY_MS for smoke inputs",
  );
  const cancelAt = performance.now();
  controller.abort(new Error("Replay cancellation"));
  await assert.rejects(cancelled, /Replay cancellation/);
  const cancelResponseMs = performance.now() - cancelAt;
  clearTimeout(watchdog);
  assert.equal(workers[0].terminations, 1);
  await workers[0].exited;
  const cancelWorkerExitMs = performance.now() - cancelAt;

  const complete = new AbortController();
  watchdog = setTimeout(
    () => complete.abort(new Error("Full validation replay deadline exceeded")),
    timeoutMs,
  );
  let ticks = 0;
  const start = performance.now();
  let last = start,
    maximumObservedTickGapMs = 0;
  timer = setInterval(() => {
    const now = performance.now();
    maximumObservedTickGapMs = Math.max(maximumObservedTickGapMs, now - last);
    last = now;
    ticks++;
  }, intervalMs);
  const restored = await importWalletBackupFile(blob, complete.signal);
  const finish = performance.now();
  clearInterval(timer);
  clearTimeout(watchdog);
  const resultTailGapMs = finish - last;
  assert.equal(restored.journal.payments.length, expectedRecords);
  assert.equal(reservedOutpoints(restored.journal).size, expectedSignatures);
  assert.equal(restored.journal.nextChangeIndex, expectedRecords);
  assert(
    restored.journal.payments.every(
      (payment) => payment.rawTx && payment.txid && !payment.archived,
    ),
  );
  assert(
    ticks > 0,
    "No main-thread heartbeat observed during the worker import",
  );
  assert.equal(workers[1].terminations, 1);
  await workers[1].exited;
  const merged = emptyJournal();
  const mergeStart = performance.now();
  mergeRestoredJournal(merged, restored.journal);
  const mergeMs = performance.now() - mergeStart;
  assert.deepEqual(merged, restored.journal);
  const result = {
    schema: 1,
    verifiedAtUtc: new Date().toISOString(),
    node: process.version,
    boundary:
      "Actual worker entry and client wrapper; unchanged SDK/wallet validation in Node worker_threads. Browser Worker API adapter only; no actual browser, upload, CSP execution, IndexedDB, device or network.",
    input: { bytes: input.length, sha256: inputSha256 },
    records: expectedRecords,
    signatures: expectedSignatures,
    importMs: finish - start,
    mainThread25msTicks: ticks,
    maximumObservedTickGapMs,
    resultTailGapMs,
    cancellation: {
      delayAfterWorkerRequestMs: cancelDelayMs,
      responseMs: cancelResponseMs,
      workerExitMs: cancelWorkerExitMs,
      workerTerminations: workers[0].terminations,
    },
    completionWorkerTerminations: workers[1].terminations,
    synchronousMergeMs: mergeMs,
    heartbeatScope:
      "Worker validation plus startup; resultTailGapMs separately bounds the final interval to promise resolution. Merge is timed separately and stays synchronous.",
    sourceHashes,
  };
  await fs.mkdir(output, { recursive: true });
  const resultFile = path.join(output, "worker-replay.json");
  // Never quietly replace prior evidence or present an old result as a new run.
  await fs.writeFile(resultFile, JSON.stringify(result, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(JSON.stringify({ resultFile, ...result }, null, 2));
} finally {
  clearInterval(timer);
  clearTimeout(watchdog);
  for (const worker of workers) {
    await worker.inner.terminate();
    await worker.exited;
  }
  if (originalWorker)
    Object.defineProperty(globalThis, "Worker", originalWorker);
  else Reflect.deleteProperty(globalThis, "Worker");
  await fs.rm(temporary, { recursive: true, force: true });
}
