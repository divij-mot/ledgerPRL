import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { accountFromJson, decodeBundle, fromHex } from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  reservedOutpoints,
  exportWalletBackup,
} from "@pearl-ledger/wallet";
import { WatchStorage } from "../src/storage.js";

/** Actual storage class; only the IndexedDB event source is modeled.
 * This does not test browser scheduling, rollback, quota behavior or durability.
 */
function storageEvents(
  t: TestContext,
  options: { journal?: unknown; writeFailure?: Error } = {},
) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  const writes: { key: IDBValidKey; value: unknown }[] = [];
  const reads: IDBRequest<unknown>[] = [];
  const transactions: {
    name: string;
    mode: IDBTransactionMode;
    options?: IDBTransactionOptions;
  }[] = [];
  const calls = { put: 0, abort: 0 };
  const tx = {
    error: null,
    abort() {
      calls.abort++;
      queueMicrotask(() => tx.onabort?.call(tx, new Event("abort")));
    },
    objectStore(name: string) {
      assert.ok(["journals", "public-cache"].includes(name));
      return {
        get(key: IDBValidKey) {
          assert.equal(key, "account");
          const request = {
            result: structuredClone(options.journal),
          } as IDBRequest<unknown>;
          reads.push(request);
          return request;
        },
        put(value: unknown, key: IDBValidKey) {
          calls.put++;
          if (options.writeFailure) throw options.writeFailure;
          writes.push({ key, value: structuredClone(value) });
          return {};
        },
      };
    },
  } as unknown as IDBTransaction;
  const db = {
    transaction(
      name: string,
      mode: IDBTransactionMode,
      options?: IDBTransactionOptions,
    ) {
      transactions.push(options ? { name, mode, options } : { name, mode });
      return tx;
    },
  } as unknown as IDBDatabase;
  const request = { result: db } as IDBOpenDBRequest;
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        queueMicrotask(() =>
          request.onsuccess?.call(request, new Event("success")),
        );
        return request;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
  return { store: new WatchStorage(), tx, writes, reads, transactions, calls };
}

test("public cache save resolves only after transaction completion", async (t) => {
  const { store, tx, writes, transactions } = storageEvents(t);
  const saving = store.save("last-snapshot", "public fixture");
  let settled = false;
  void saving.then(() => {
    settled = true;
  });
  await setImmediate();
  assert.deepEqual(writes, [{ key: "last-snapshot", value: "public fixture" }]);
  assert.equal(settled, false);
  assert.deepEqual(transactions, [{ name: "public-cache", mode: "readwrite" }]);
  assert.equal(typeof tx.oncomplete, "function");
  tx.oncomplete!.call(tx, new Event("complete"));
  await saving;
  assert.equal(settled, true);
});

test("public cache save rejects an abort without an error event", async (t) => {
  const { store, tx } = storageEvents(t);
  const saving = store.save("last-snapshot", "public fixture");
  const rejected = assert.rejects(saving, /storage transaction aborted/i);
  await setImmediate();
  assert.equal(typeof tx.onabort, "function");
  tx.onabort!.call(tx, new Event("abort"));
  await rejected;
});

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = accountFromJson(fixture.publicAccount);
const bundle = decodeBundle(fromHex(fixture.bundleHex));

for (const state of ["signing", "signed"] as const) {
  test(`readonly journal exports ${state} records with modeled writes denied`, async (t) => {
    const original = emptyJournal();
    reservePayment(original, bundle, "storage-fixture", 1000);
    transitionPayment(original, "storage-fixture", "signing");
    if (state === "signed")
      transitionPayment(original, "storage-fixture", "signed", {
        rawTx: fixture.rawTx,
        txid: fixture.txid,
      });
    const { store, tx, reads, writes, calls, transactions } = storageEvents(t, {
      journal: original,
      writeFailure: new DOMException(
        "Imposed write failure",
        "QuotaExceededError",
      ),
    });
    const reading = store.journal("account");
    let settled = false;
    void reading.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await setImmediate();
    assert.deepEqual(transactions, [{ name: "journals", mode: "readonly" }]);
    const request = reads[0]!;
    request.onsuccess!.call(request, new Event("success"));
    await setImmediate();
    assert.equal(
      settled,
      false,
      "request success is not transaction completion",
    );
    assert.equal(calls.put, 0);
    assert.equal(writes.length, 0);
    tx.oncomplete!.call(tx, new Event("complete"));
    const loaded = await reading;
    assert.deepEqual(loaded, original);
    assert.equal(reservedOutpoints(loaded).size, 2);
    const backup = JSON.parse(exportWalletBackup(account, loaded));
    assert.deepEqual(backup.journal.payments[0], original.payments[0]);
    loaded.payments.length = 0;
    assert.equal(
      original.payments.length,
      1,
      "read results must not alias persisted data",
    );
  });
}

test("readonly journal rejects an abort after successful get", async (t) => {
  const { store, tx, reads } = storageEvents(t, { journal: emptyJournal() });
  const reading = store.journal("account");
  const rejected = assert.rejects(reading, /storage transaction aborted/i);
  await setImmediate();
  reads[0]!.onsuccess!.call(reads[0]!, new Event("success"));
  tx.onabort!.call(tx, new Event("abort"));
  await rejected;
});

test("readonly journal rejects request and transaction errors", async (t) => {
  for (const target of ["request", "transaction"] as const) {
    await t.test(target, async (t) => {
      const { store, tx, reads } = storageEvents(t);
      const failure = new DOMException("Imposed read failure", "UnknownError");
      const reading = store.journal("account");
      const rejected = assert.rejects(reading, (error) => error === failure);
      await setImmediate();
      if (target === "request") {
        Object.defineProperty(reads[0]!, "error", { value: failure });
        reads[0]!.onerror!.call(reads[0]!, new Event("error"));
      } else {
        Object.defineProperty(tx, "error", { value: failure });
        tx.onerror!.call(tx, new Event("error"));
      }
      await rejected;
    });
  }
});

test("readonly journal retains legacy default without creating a write", async (t) => {
  const legacy = { schema: 1, payments: [], nextChangeIndex: 0 };
  const { store, tx, reads, calls } = storageEvents(t, { journal: legacy });
  const reading = store.journal("account");
  await setImmediate();
  reads[0]!.onsuccess!.call(reads[0]!, new Event("success"));
  tx.oncomplete!.call(tx, new Event("complete"));
  assert.deepEqual(await reading, emptyJournal());
  assert.equal(calls.put, 0);
  assert.equal(Object.hasOwn(legacy, "issuedReceiveThrough"), false);
});

test("missing readonly journal returns an empty journal without a write", async (t) => {
  const { store, tx, reads, calls } = storageEvents(t);
  const reading = store.journal("account");
  await setImmediate();
  reads[0]!.onsuccess!.call(reads[0]!, new Event("success"));
  tx.oncomplete!.call(tx, new Event("complete"));
  assert.deepEqual(await reading, emptyJournal());
  assert.equal(calls.put, 0);
});

test("readonly journal aborts corrupt-row validation", async (t) => {
  const { store, reads, calls } = storageEvents(t, { journal: { schema: 7 } });
  const reading = store.journal("account");
  const rejected = assert.rejects(reading, /Corrupt payment journal/);
  await setImmediate();
  reads[0]!.onsuccess!.call(reads[0]!, new Event("success"));
  await rejected;
  assert.equal(calls.abort, 1);
  assert.equal(calls.put, 0);
});

test("journal mutation still uses a strict readwrite transaction", async (t) => {
  const { store, tx, reads, writes, transactions } = storageEvents(t, {
    journal: emptyJournal(),
  });
  const mutating = store.mutate("account", (j) => {
    j.nextChangeIndex = 1;
  });
  await setImmediate();
  assert.deepEqual(transactions, [
    { name: "journals", mode: "readwrite", options: { durability: "strict" } },
  ]);
  reads[0]!.onsuccess!.call(reads[0]!, new Event("success"));
  assert.equal(writes.length, 1);
  tx.oncomplete!.call(tx, new Event("complete"));
  await mutating;
});

test("public cache save preserves the transaction error on abort", async (t) => {
  const { store, tx } = storageEvents(t);
  const failure = new DOMException("Synthetic storage failure", "UnknownError");
  Object.defineProperty(tx, "error", { value: failure });
  const saving = store.save("last-snapshot", "public fixture");
  const rejected = assert.rejects(saving, (error) => error === failure);
  await setImmediate();
  assert.equal(typeof tx.onabort, "function");
  tx.onabort!.call(tx, new Event("abort"));
  await rejected;
});
