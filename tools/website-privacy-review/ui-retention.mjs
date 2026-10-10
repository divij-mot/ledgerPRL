/** Modelled DOM/storage test of real UI source. All data is a public fixture. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const original = await fs.readFile(
  new URL("../../apps/companion/src/main.ts", import.meta.url),
  "utf8",
);
const source =
  original +
  `
export async function reviewOpen(text){await importSnapshot(text);page='overview';render();}
export function reviewForm(recipient,amount,fee){form.recipient=recipient;form.amount=amount;form.fee=fee;page='send';render();}
export function reviewOverview(){page='overview';render();}
export function reviewSend(){page='send';render();}
export function reviewState(){return {busy, account:!!account,form:{...form},receiveIndex,html:app.innerHTML};}
export function reviewReceiveIndex(value){receiveIndex=value;}
`;
const built = await build({
  stdin: {
    contents: source,
    resolveDir: fileURLToPath(
      new URL("../../apps/companion/src/", import.meta.url),
    ),
    loader: "ts",
  },
  bundle: true,
  write: false,
  platform: "node",
  format: "esm",
  logLevel: "silent",
  plugins: [
    {
      name: "read-only-ui-boundaries",
      setup(b) {
        b.onResolve({ filter: /^\.\/(?:ledger|storage)\.js$/ }, (a) => ({
          path: a.path,
          namespace: "privacy-mock",
        }));
        b.onLoad({ filter: /.*/, namespace: "privacy-mock" }, (a) => ({
          loader: "js",
          contents: a.path.includes("device")
            ? 'export async function connectLedger(){throw Error("Device access forbidden in privacy test");}'
            : `export class WatchStorage{
    async journal(k){return structuredClone(globalThis.reviewRows.get(k)??{schema:1,issuedReceiveThrough:-1,nextChangeIndex:0,payments:[]});}
    async mutate(k,fn){const j=await this.journal(k);const result=fn(j);globalThis.reviewRows.set(k,structuredClone(j));return result;}
    async save(k,v){globalThis.reviewCache.set(k,v);}
    async load(k){return globalThis.reviewCache.get(k);}
    async removeSavedSnapshot(){globalThis.reviewCache.delete('last-snapshot');}
  }`,
        }));
      },
    },
  ],
});
const nodes = new Map();
const dom = {
  _html: "",
  get innerHTML() {
    return this._html;
  },
  set innerHTML(value) {
    this._html = value;
    nodes.clear();
    for (const [, id] of value.matchAll(/\bid="([^"]+)"/g))
      nodes.set(id, {
        disabled: false,
        addEventListener(type, fn) {
          this[type] = fn;
        },
      });
  },
};
globalThis.reviewRows = new Map();
globalThis.reviewCache = new Map();
globalThis.document = {
  querySelector: () => dom,
  querySelectorAll: () => [],
  getElementById: (id) => nodes.get(id) ?? null,
};
globalThis.window = {
  location: { protocol: "https:" },
  isSecureContext: true,
  addEventListener() {},
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {},
});
globalThis.BroadcastChannel = class {
  postMessage() {}
};
globalThis.fetch = async () => {
  throw Error("Network access forbidden in privacy test");
};
const app = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
const snapshot = await fs.readFile(
  new URL("../../apps/companion/public/example-watch.json", import.meta.url),
  "utf8",
);
await app.reviewOpen(snapshot);
const recipient = "PUBLIC-RECIPIENT-CANARY";
app.reviewForm(recipient, "12.34567890", "0.00200000");
app.reviewOverview();
assert(nodes.has("disconnect"));
nodes.get("disconnect").click();
for (let i = 0; app.reviewState().busy && i < 100; i++)
  await new Promise((r) => setTimeout(r, 1));
assert.equal(app.reviewState().busy, false);
assert.equal(app.reviewState().account, false);
const retainedAfterClose = app.reviewState().form;
assert.deepEqual(retainedAfterClose, {
  recipient: "",
  amount: "",
  fee: "0.00001000",
  changeIndex: "0",
});
assert.equal(app.reviewState().receiveIndex, 0);
await app.reviewOpen(snapshot);
app.reviewSend();
const displayedAfterReopen = app.reviewState().html.includes(recipient);
assert.equal(displayedAfterReopen, false);
const other = JSON.parse(snapshot);
other.account.account += 1;
app.reviewForm(recipient, "98.7", "0.00002000");
app.reviewReceiveIndex(17);
await app.reviewOpen(JSON.stringify(other));
assert.equal(app.reviewState().form.recipient, "");
assert.equal(app.reviewState().form.amount, "");
assert.equal(app.reviewState().form.fee, "0.00001000");
assert.equal(app.reviewState().receiveIndex, 0);
app.reviewForm(recipient, "65.4", "0.00003000");
app.reviewReceiveIndex(19);
app.reviewOverview();
const publicFile = new Blob([JSON.stringify(JSON.parse(snapshot).account)], {
  type: "application/json",
});
nodes.get("public-file").change({ target: { files: [publicFile] } });
for (let i = 0; app.reviewState().busy && i < 100; i++)
  await new Promise((r) => setTimeout(r, 1));
assert.equal(app.reviewState().busy, false);
assert.equal(app.reviewState().form.recipient, "");
assert.equal(app.reviewState().form.amount, "");
assert.equal(app.reviewState().form.fee, "0.00001000");
assert.equal(app.reviewState().receiveIndex, 0);
await app.reviewOpen(snapshot);
app.reviewForm(recipient, "43.2", "0.00004000");
app.reviewOverview();
nodes.get("network").change({ target: { value: "testnet2" } });
assert.equal(app.reviewState().form.recipient, "");
assert.equal(app.reviewState().form.amount, "");
assert.equal(app.reviewState().form.fee, "0.00001000");
const rowsBefore = JSON.stringify([...globalThis.reviewRows]);
globalThis.reviewCache.set("last-snapshot", snapshot);
app.reviewOverview();
assert(nodes.has("clear-cache"), "Expected root-added optional cache removal");
nodes.get("clear-cache").click();
for (let i = 0; app.reviewState().busy && i < 100; i++)
  await new Promise((r) => setTimeout(r, 1));
assert.equal(globalThis.reviewCache.size, 0);
assert.equal(JSON.stringify([...globalThis.reviewRows]), rowsBefore);
const result = {
  scope:
    "Actual main.ts handlers with modelled DOM/storage; no browser or device",
  closeAccountClearsAccount: true,
  retainedAfterClose,
  displayedAfterReopen,
  differentSnapshotResetsForm: true,
  publicAccountImportResetsForm: true,
  networkChangeResetsForm: true,
  optionalClearLeavesJournalUntouched: true,
  note: "Original low-severity form-retention finding is resolved in this source. Closing or changing account clears active form values without deleting journals. JavaScript assignment is not a secure-memory-erasure guarantee.",
};
await fs.writeFile(
  new URL("./ui-retention.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
