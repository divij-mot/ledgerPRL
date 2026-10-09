/** Actual WatchStorage over an explicit FIFO IndexedDB event model. This checks
 * host invariants conditional on serialization/rollback, not browser durability. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { WatchStorage } from "../../apps/companion/src/storage.ts";
import * as sdk from "../../packages/sdk/src/index.ts";
import * as wallet from "../../packages/wallet/src/index.ts";
const f = JSON.parse(
  readFileSync(
    new URL("../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const bundle = sdk.bundleFromJson(f.bundle);
function model() {
  const rows = new Map<string, unknown>(),
    queue: any[] = [],
    transactions: any[] = [];
  let running = false;
  function pump() {
    queueMicrotask(async () => {
      if (running || !queue.length) return;
      running = true;
      const tx = queue[0];
      try {
        for (const { key, request } of tx.gets) {
          request.result = structuredClone(rows.get(key));
          request.onsuccess?.();
          if (tx.aborted) break;
        }
        await new Promise((r) => setImmediate(r));
        if (!tx.aborted) {
          for (const [key, value] of tx.pending)
            rows.set(key, structuredClone(value));
          tx.oncomplete?.();
        } else tx.onabort?.();
      } catch (error) {
        tx.error = error;
        tx.onabort?.();
      } finally {
        queue.shift();
        running = false;
        pump();
      }
    });
  }
  const db = {
    transaction(name: string, mode: string, options?: unknown) {
      assert.equal(name, "journals");
      transactions.push({ name, mode, options });
      const tx: any = {
        gets: [],
        pending: new Map(),
        aborted: false,
        error: null,
        abort() {
          this.aborted = true;
        },
        objectStore() {
          return {
            get(key: string) {
              const request: any = {};
              tx.gets.push({ key, request });
              return request;
            },
            put(value: unknown, key: string) {
              assert.equal(mode, "readwrite");
              tx.pending.set(key, structuredClone(value));
              return {};
            },
          };
        },
      };
      queue.push(tx);
      pump();
      return tx;
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request: any = { result: db };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
  return { rows, transactions };
}
test("modeled two-tab ordering: only one competing reservation commits; both request strict durability", async () => {
  const m = model(),
    a = new WatchStorage(),
    b = new WatchStorage();
  const results = await Promise.allSettled([
    a.mutate("owner", (j) =>
      wallet.reservePayment(j, bundle, "first-tab", 1000),
    ),
    b.mutate("owner", (j) =>
      wallet.reservePayment(j, bundle, "other-tab", 1000),
    ),
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  const saved = await b.journal("owner");
  assert.equal(saved.payments.length, 1);
  assert.equal(saved.payments[0].id, "first-tab");
  assert.equal(wallet.reservedOutpoints(saved).size, 2);
  assert.deepEqual(
    m.transactions.filter((t) => t.mode === "readwrite").map((t) => t.options),
    [{ durability: "strict" }, { durability: "strict" }],
  );
});
test("modeled two-tab ordering: range import and receive issuance preserve both monotonic high-water marks", async () => {
  model();
  const a = new WatchStorage(),
    b = new WatchStorage();
  await Promise.all([
    a.mutate("owner", (j) => {
      j.issuedReceiveThrough = 8;
      j.nextChangeIndex = 12;
    }),
    b.mutate("owner", (j) => wallet.recordVerifiedReceive(j, 9)),
  ]);
  const saved = await a.journal("owner");
  assert.equal(saved.issuedReceiveThrough, 9);
  assert.equal(saved.nextChangeIndex, 12);
});
test("modeled atomic rollback: a cancelled update never publishes its partial journal or blocks later writers", async () => {
  model();
  const a = new WatchStorage(),
    b = new WatchStorage();
  await assert.rejects(
    a.mutate("owner", (j) => {
      wallet.reservePayment(j, bundle, "abort-tab", 1000);
      throw new DOMException("Cancelled", "AbortError");
    }),
    /Cancelled/,
  );
  await b.mutate("owner", (j) =>
    wallet.reservePayment(j, bundle, "saved-tab", 1000),
  );
  const saved = await a.journal("owner");
  assert.equal(saved.payments.length, 1);
  assert.equal(saved.payments[0].id, "saved-tab");
  assert.equal(wallet.reservedOutpoints(saved).size, 2);
});
