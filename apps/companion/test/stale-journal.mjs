/** Actual UI code with isolated DOM and deferred-storage fixtures. No browser, upload, device, or network access. */
import fs from "node:fs/promises";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { publicAccount } from "../../../packages/wallet/test/fixtures.js";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const handlers = /* @__PURE__ */ new Map();
const container = { innerHTML: "" };
Object.assign(globalThis, {
  document: {
    querySelector: () => container,
    querySelectorAll: () => [],
    getElementById: (id) => ({
      addEventListener: (type, fn) => {
        if (type === "click") handlers.set(id, fn);
      },
    }),
  },
  window: { addEventListener() {} },
  BroadcastChannel: class {
    postMessage() {}
  },
});
const source = await fs.readFile(root + "/apps/companion/src/main.ts", "utf8");
const built = await build({
  stdin: {
    contents:
      source +
      `
export { refreshJournal };
export function switchFixture(a) { account=a; network=a.network; journal=emptyJournal(); page='activity'; render(); }
export function state() { return {account,journal,busy,form}; }
`,
    resolveDir: root + "/apps/companion/src",
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "local-fixtures",
      setup(b) {
        b.onResolve(
          { filter: /^\.\/(ledger\.js|storage\.js|styles\.css)$/ },
          (a) => ({ path: a.path, namespace: "fixture" }),
        );
        b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
          loader: "js",
          contents: a.path.includes("ledger")
            ? 'export async function connectLedger(){throw Error("No device")}'
            : a.path.includes("storage")
              ? 'export class WatchStorage { async journal(k){ const q=globalThis.journalQueue.shift(); if (!q) throw Error("Missing fixture journal"); return q; } }'
              : "",
        }));
      },
    },
  ],
});
const url =
  "data:text/javascript;base64," +
  Buffer.from(built.outputFiles[0].text).toString("base64");
function gate() {
  let release = () => {};
  const promise = new Promise((r) => (release = r));
  return { promise, release };
}
function journal(nextChangeIndex) {
  return { schema: 1, nextChangeIndex, issuedReceiveThrough: -1, payments: [] };
}
let serial = 0;
async function fresh() {
  globalThis.journalQueue = [];
  const app = await import(url + "#" + serial++);
  app.switchFixture(publicAccount);
  return app;
}
function next(g) {
  globalThis.journalQueue.push(g.promise);
}
const results = [];
{
  const app = await fresh(),
    pending = gate();
  next(pending);
  const p = app.refreshJournal();
  handlers.get("disconnect")();
  for (let i = 0; i < 20 && app.state().busy; i++)
    await new Promise((r) => setImmediate(r));
  assert.equal(app.state().account, null);
  pending.release(journal(10));
  await p;
  assert.equal(app.state().journal.nextChangeIndex, 0);
  results.push("Late refresh after actual Close account ignored");
}
for (const kind of ["different-account", "same-account-reopened"]) {
  const app = await fresh(),
    pending = gate();
  next(pending);
  const p = app.refreshJournal();
  app.switchFixture(
    kind === "different-account"
      ? { ...publicAccount, account: 1 }
      : structuredClone(publicAccount),
  );
  pending.release(journal(10));
  await p;
  assert.equal(app.state().journal.nextChangeIndex, 0);
  results.push(kind + " ignores previous object session response");
}
{
  const app = await fresh(),
    older = gate(),
    newer = gate();
  next(older);
  const p = app.refreshJournal();
  next(newer);
  const q = app.refreshJournal();
  newer.release(journal(20));
  await q;
  assert.equal(app.state().journal.nextChangeIndex, 20);
  older.release(journal(10));
  await p;
  assert.equal(app.state().journal.nextChangeIndex, 20);
  assert.equal(app.state().form.changeIndex, "20");
  results.push(
    "Out-of-order same-account refresh retains newer result and change index",
  );
}
for (const result of results) console.log("PASS: " + result);
