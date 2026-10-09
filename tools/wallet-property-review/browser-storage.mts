/** Real disposable Chromium/IndexedDB; public fixture only. Loopback HTTP only. */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { build } from "esbuild";
import { chromium } from "playwright-core";
import * as s from "../../packages/sdk/src/index.ts";
import * as w from "../../packages/wallet/src/index.ts";
const root = process.cwd();
const seed = Number(process.env.PRL_SEED ?? "0x8d12f4a7") >>> 0;
let state = seed;
function random() { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return state >>> 0; }
const output = process.env.PRL_OUTPUT ?? `tools/wallet-property-review/browser-results-${seed.toString(16)}.json`;
const f = JSON.parse(readFileSync("fixtures/protocol-v1.json", "utf8"));
const account = s.accountFromJson(f.publicAccount);
const base = s.decodeBundle(s.fromHex(f.bundleHex));
function draft(n: number) {
  const b = structuredClone(base);
  for (let i = 0; i < b.inputs.length; i++) b.inputs[i]!.txid = BigInt(n * 16 + i + 1).toString(16).padStart(64, "0");
  const j = w.emptyJournal(); w.reservePayment(j, b, `browser-payment-${n}`, 1000); return j;
}
const sourcePaths = ["apps/companion/src/storage.ts", "apps/companion/src/backup-import.ts", "apps/companion/src/backup-import.worker.ts", "packages/wallet/src/journal.ts", "packages/wallet/src/recovery.ts", "packages/sdk/src/bundle.ts", "fixtures/protocol-v1.json"];
const hashes = () => Object.fromEntries(sourcePaths.map(p => [p, createHash("sha256").update(readFileSync(p)).digest("hex")]));
const initialHashes = hashes();
const source = `
import * as sdk from './packages/sdk/src/index.ts';
import * as wallet from './packages/wallet/src/index.ts';
import { WatchStorage } from './apps/companion/src/storage.ts';
import { importWalletBackupFile } from './apps/companion/src/backup-import.ts';
window.audit = { sdk, wallet, store: new WatchStorage(), importWalletBackupFile };
window.audit.put = async (key, value) => {
  const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('pearl-ledger-watch-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  try { await new Promise((resolve,reject)=>{const tx=db.transaction('journals','readwrite',{durability:'strict'});tx.objectStore('journals').put(value,key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);}); } finally { db.close(); }
};
window.audit.holdTransaction = async (key, replacement) => {
  const db = await new Promise((resolve,reject)=>{const r=indexedDB.open('pearl-ledger-watch-v1',1);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  const tx=db.transaction('journals','readwrite',{durability:'strict'}), store=tx.objectStore('journals');
  window.audit.held={ release:false, abort:false, started:false, complete:false };
  if(replacement!==undefined)store.put(replacement,key);
  const next=()=>{const r=store.get(key);r.onsuccess=()=>{window.audit.held.started=true;if(window.audit.held.abort)tx.abort();else if(!window.audit.held.release)next();};};next();
  tx.oncomplete=()=>{window.audit.held.complete=true;db.close();};tx.onabort=()=>{window.audit.held.complete=true;db.close();};
};
window.audit.ready=true;
`;
const [entry, worker] = await Promise.all([
  build({ stdin: { contents: source, resolveDir: root, loader: "ts" }, bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent" }),
  build({ entryPoints: ["apps/companion/src/backup-import.worker.ts"], bundle: true, format: "esm", platform: "browser", write: false, logLevel: "silent" }),
]);
const assets: Record<string, string> = {
  "/": '<!doctype html><meta charset="utf-8"><title>Local wallet storage boundary test</title><script type="module" src="/entry.js"></script>',
  "/entry.js": entry.outputFiles[0]!.text,
  "/backup-import.worker.ts": worker.outputFiles[0]!.text,
};
const server = createServer((req, res) => {
  const asset = assets[req.url ?? ""];
  res.writeHead(asset === undefined ? 404 : 200, { "content-type": req.url === "/" ? "text/html" : "text/javascript", "cache-control": "no-store", "content-security-policy": "default-src 'none'; script-src 'self'; worker-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'" });
  res.end(asset ?? "not found");
});
await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
const profile = mkdtempSync(join(tmpdir(), "prl-wallet-browser-review-"));
const results: any[] = [], unexpectedRequests: string[] = [];
let browserVersion = "", context: any, fatalError: string | undefined;
const startedAt = new Date().toISOString();
async function check(name: string, cases: number, fn: () => Promise<unknown>) {
  const start = performance.now();
  try { await fn(); results.push({ name, cases, outcome: "pass", durationMs: Math.round(performance.now() - start) }); console.log(`PASS ${name} (${cases})`); }
  catch (error) { const detail = error instanceof Error ? error.stack : String(error); results.push({ name, cases, outcome: "fail", detail, durationMs: Math.round(performance.now() - start) }); console.log(`FAIL ${name}: ${detail}`); }
}
try {
  context = await chromium.launchPersistentContext(profile, { executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage"], viewport: { width: 1000, height: 700 } });
  browserVersion = context.browser()?.version() ?? await context.newCDPSession(context.pages()[0]).then((c: any) => c.send("Browser.getVersion")).then((v: any) => v.product);
  await context.route("**/*", (route: any) => {
    if (route.request().url().startsWith(origin + "/")) return route.continue();
    unexpectedRequests.push(route.request().url()); return route.abort();
  });
  const p1 = context.pages()[0], p2 = await context.newPage();
  await Promise.all([p1.goto(origin), p2.goto(origin)]);
  await Promise.all([p1.waitForFunction(() => (window as any).audit?.ready), p2.waitForFunction(() => (window as any).audit?.ready)]);

  await check("actual cross-tab readwrite serialization permits exactly one competing reservation", 32, async () => {
    for (let c = 0; c < 32; c++) {
      const key = `race-${c}`;
      await p1.evaluate(async (key: string) => { const a = (window as any).audit; await a.put(key, a.wallet.emptyJournal()); await a.holdTransaction(key); }, key);
      await p1.waitForFunction(() => (window as any).audit.held.started);
      const reserve = (page: any, id: string) => page.evaluate(async ({ key, id, hex }: any) => {
        const a = (window as any).audit;
        try { await a.store.mutate(key, (j: any) => a.wallet.reservePayment(j, a.sdk.decodeBundle(a.sdk.fromHex(hex)), id, 1000)); return "accepted"; }
        catch (error) { return (error as Error).message; }
      }, { key, id, hex: f.bundleHex });
      const order = random() % 2;
      const pending = order ? [reserve(p1, `race-left-${c}`), reserve(p2, `race-right-${c}`)] : [reserve(p2, `race-right-${c}`), reserve(p1, `race-left-${c}`)];
      await p1.evaluate(() => { (window as any).audit.held.release = true; });
      const outcomes = await Promise.all(pending);
      assert.equal(outcomes.filter(x => x === "accepted").length, 1, JSON.stringify(outcomes));
      assert.equal(outcomes.filter(x => /reserved/.test(x)).length, 1, JSON.stringify(outcomes));
      const row = await p2.evaluate((key: string) => (window as any).audit.store.journal(key), key);
      assert.equal(row.payments.length, 1); assert.equal(row.payments[0].outpoints.length, 2);
    }
  });

  await check("real IndexedDB transaction abort contains partially mutated merge callback", 12, async () => {
    for (let c = 0; c < 12; c++) {
      const key = `merge-${c}`, existing = draft(c * 2 + 1), incoming = draft(c * 2 + 2);
      const conflict = structuredClone(existing.payments[0]!); conflict.id = `conflict-payment-${c}`; incoming.payments.push(conflict);
      const existingBackup = w.exportWalletBackup(account, existing), incomingBackup = w.exportWalletBackup(account, incoming);
      const outcome = await p1.evaluate(async ({ key, existingBackup, incomingBackup }: any) => {
        const a = (window as any).audit, existing = a.wallet.importWalletBackup(existingBackup).journal, incoming = a.wallet.importWalletBackup(incomingBackup).journal;
        await a.put(key, existing);
        let error; try { await a.store.mutate(key, (j: any) => a.wallet.mergeRestoredJournal(j, incoming)); } catch (e) { error = (e as Error).message; }
        return { before: existing, after: await a.store.journal(key), error };
      }, { key, existingBackup, incomingBackup });
      assert.match(outcome.error, /conflicts/); assert.deepEqual(outcome.after, outcome.before);
    }
  });

  await check("closing a tab mid-transaction rolls back its uncommitted replacement", 4, async () => {
    for (let c = 0; c < 4; c++) {
      const page = await context.newPage(); await page.goto(origin); await page.waitForFunction(() => (window as any).audit?.ready);
      const key = `close-${c}`, existing = draft(c + 100), replacement = draft(c + 200);
      await p1.evaluate(({ key, existing }: any) => (window as any).audit.put(key, existing), { key, existing });
      await page.evaluate(({ key, replacement }: any) => (window as any).audit.holdTransaction(key, replacement), { key, replacement });
      await page.waitForFunction(() => (window as any).audit.held.started);
      await page.close();
      const saved = await p2.evaluate((key: string) => (window as any).audit.store.journal(key), key);
      assert.deepEqual(saved, existing);
    }
  });

  await check("real same-origin module worker validates signed backup under a restrictive test CSP", 1, async () => {
    const j = w.emptyJournal(); w.reservePayment(j, base, "browser-signed-fixture", 1000);
    w.transitionPayment(j, "browser-signed-fixture", "signing"); w.transitionPayment(j, "browser-signed-fixture", "signed", { rawTx: f.rawTx, txid: f.txid });
    const value = await p1.evaluate(async (text: string) => {
      const a = (window as any).audit;
      const result = await a.importWalletBackupFile(new Blob([text], { type: "application/json" }), new AbortController().signal);
      return { state: result.journal.payments[0].state, rawTx: result.journal.payments[0].rawTx, txid: result.journal.payments[0].txid, publicKeyIsBytes: result.account.publicKey instanceof Uint8Array };
    }, w.exportWalletBackup(account, j));
    assert.deepEqual(value, { state: "signed", rawTx: f.rawTx, txid: f.txid, publicKeyIsBytes: true });
  });

  await check("real browser worker cancellations cannot mutate the separate durable journal", 32, async () => {
    const backup = w.exportWalletBackup(account, draft(300));
    for (let c = 0; c < 32; c++) {
      const delay = c % 4, key = `cancel-${c}`;
      const outcome = await p1.evaluate(async ({ backup, delay, key }: any) => {
        const a = (window as any).audit; await a.put(key, a.wallet.emptyJournal());
        const controller = new AbortController();
        if (delay === 0) controller.abort(new Error("test cancellation"));
        const pending = a.importWalletBackupFile(new Blob([backup]), controller.signal);
        if (delay === 1) controller.abort(new Error("test cancellation"));
        else if (delay > 1) setTimeout(() => controller.abort(new Error("test cancellation")), delay - 2);
        let value; try { await pending; value = "completed-before-cancel"; } catch (error) { value = (error as Error).message; }
        return { value, journal: await a.store.journal(key) };
      }, { backup, delay, key });
      assert.equal(outcome.value, "test cancellation"); assert.deepEqual(outcome.journal, w.emptyJournal());
    }
  });

  await check("real persisted corrupt signed reservation row rejects reuse", 1, async () => {
    const key = "corrupt-local-row", j = w.emptyJournal(); w.reservePayment(j, base, "corrupt-signed-fixture", 1000);
    w.transitionPayment(j, "corrupt-signed-fixture", "signing"); w.transitionPayment(j, "corrupt-signed-fixture", "signed", { rawTx: f.rawTx, txid: f.txid });
    j.payments[0]!.outpoints = [];
    const replacement = structuredClone(base), change = replacement.outputs.find(o => o.role === "change")!;
    change.index = j.nextChangeIndex; change.scriptPubKey = s.deriveAddress(account, 1, change.index).scriptPubKey;
    const outcome = await p1.evaluate(async ({ key, j, hex }: any) => {
      const a = (window as any).audit; await a.put(key, j);
      let error; try { await a.store.mutate(key, (row: any) => a.wallet.reservePayment(row, a.sdk.decodeBundle(a.sdk.fromHex(hex)), "second-signed-inputs", 1001)); } catch (e) { error = (e as Error).message; }
      return { error, row: await a.store.journal(key) };
    }, { key, j, hex: s.hex(s.encodeBundle(replacement)) });
    assert(outcome.error, "Actual IndexedDB committed a second reservation for the signed payment's inputs after a corrupt empty outpoints row");
    assert.equal(outcome.row.payments.length, 1);
  });
} catch (error) {
  fatalError = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(fatalError);
} finally {
  await context?.close(); await new Promise<void>(resolve => server.close(() => resolve()));
  rmSync(profile, { recursive: true, force: true });
  const finalHashes = hashes(), report = { startedAt, finishedAt: new Date().toISOString(), seed, seedHex: `0x${seed.toString(16)}`, browserVersion,
    initialHashes, finalHashes, sourceChangedDuringRun: sourcePaths.filter(p => initialHashes[p] !== finalHashes[p]), results, unexpectedRequests, fatalError,
    outcome: fatalError ? "blocked-before-completion" : results.some(r => r.outcome === "fail") ? "fail" : "pass",
    failures: results.filter(r => r.outcome === "fail").length,
    limitations: ["Real disposable headless Chromium, actual IndexedDB transactions and module worker on loopback only.", "Injected public malformed rows model corruption; no external corruption path established.", "Tab close is not OS power loss. No persistence guarantee for abrupt host/device power failure.", "Restrictive local test CSP is not verification of production hosting/CSP configuration.", "No physical WebHID/device, user profile, user seed, real funds, remote service or transaction broadcast."] };
  mkdirSync(output.slice(0, output.lastIndexOf("/")), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ output, outcome: report.outcome, failures: report.failures, unexpectedRequests, browserVersion, sourceChangedDuringRun: report.sourceChangedDuringRun }));
  process.exitCode = fatalError || report.failures || unexpectedRequests.length ? 1 : 0;
}
