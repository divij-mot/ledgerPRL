import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import { decodeBundle, fromHex } from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
} from "@pearl-ledger/wallet";
import { WatchStorage } from "../src/storage.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
function signed() {
  const j = emptyJournal();
  reservePayment(
    j,
    decodeBundle(fromHex(fixture.bundleHex)),
    "stored-fixture",
    1000,
  );
  transitionPayment(j, "stored-fixture", "signing");
  transitionPayment(j, "stored-fixture", "signed", {
    rawTx: fixture.rawTx,
    txid: fixture.txid,
  });
  return j;
}
/** Production storage handlers; the IndexedDB event scheduler is explicitly modeled. */
function storage(t: TestContext, row: unknown) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB");
  let puts = 0,
    aborts = 0,
    saved = structuredClone(row),
    aborted = false;
  const tx: any = {
    abort() {
      aborted = true;
      aborts++;
      queueMicrotask(() => tx.onabort?.());
    },
    objectStore() {
      return {
        get() {
          const request: any = { result: structuredClone(saved) };
          queueMicrotask(() => {
            request.onsuccess?.();
            if (!aborted) queueMicrotask(() => tx.oncomplete?.());
          });
          return request;
        },
        put(value: unknown) {
          puts++;
          saved = structuredClone(value);
        },
      };
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const request: any = {
          result: {
            transaction() {
              return tx;
            },
          },
        };
        queueMicrotask(() => request.onsuccess?.());
        return request;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
  });
  return { store: new WatchStorage(), state: () => ({ puts, aborts, saved }) };
}

test("corrupt signed reservations abort before a mutation callback can reuse inputs", async (t) => {
  const row = signed();
  row.payments[0]!.outpoints = [];
  const { store, state } = storage(t, row);
  let called = false;
  await assert.rejects(
    store.mutate("account", () => {
      called = true;
    }),
    /Corrupt payment journal/,
  );
  assert.equal(called, false);
  assert.equal(state().puts, 0);
  assert.equal(state().aborts, 1);
  assert.deepEqual(state().saved, row);
});

test("post-update integrity checks prevent malformed local changes from being written", async (t) => {
  for (const mutation of [
    (j: any) => (j.payments[0].outpoints = []),
    (j: any) => (j.payments[0].state = "draft"),
    (j: any) => (j.nextChangeIndex = -1),
    (j: any) => (j.issuedReceiveThrough = null),
  ])
    await t.test("invalid update", async (t) => {
      const row = signed(),
        { store, state } = storage(t, row);
      await assert.rejects(
        store.mutate("account", (j) => {
          mutation(j);
        }),
        /Corrupt payment journal/,
      );
      assert.equal(state().puts, 0);
      assert.equal(state().aborts, 1);
      assert.deepEqual(state().saved, row);
    });
});

test("null persisted row rejects rather than creating empty reservations", async (t) => {
  const { store, state } = storage(t, null);
  await assert.rejects(store.journal("account"), /Corrupt payment journal/);
  assert.equal(state().puts, 0);
  assert.equal(state().aborts, 1);
});

/** Narrow delete API with a modeled transaction commit, never real persisted data. */
function snapshotStorage(
  t: TestContext,
  options: {
    deleteFailure?: Error;
    transactionFailure?: Error;
    absent?: boolean;
  } = {},
) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "indexedDB"),
    journal = signed(),
    beforeJournal = structuredClone(journal),
    cache = new Map<string, unknown>([["other-public-data", "keep"]]);
  if (!options.absent)
    cache.set("last-snapshot", { account: "public fixture" });
  const calls: { store: string; mode: string; options: unknown }[] = [],
    deletes: string[] = [],
    request: any = { error: null };
  const tx: any = {
    error: null,
    objectStore(name: string) {
      assert.equal(name, "public-cache", "journal store must never be opened");
      return {
        delete(key: string) {
          if (options.deleteFailure) throw options.deleteFailure;
          deletes.push(key);
          return request;
        },
      };
    },
  };
  Object.defineProperty(globalThis, "indexedDB", {
    configurable: true,
    value: {
      open() {
        const opening: any = {
          result: {
            transaction(
              store: string,
              mode: string,
              transactionOptions: unknown,
            ) {
              if (options.transactionFailure) throw options.transactionFailure;
              calls.push({ store, mode, options: transactionOptions });
              return tx;
            },
          },
        };
        queueMicrotask(() => opening.onsuccess?.());
        return opening;
      },
    },
  });
  t.after(() => {
    if (original) Object.defineProperty(globalThis, "indexedDB", original);
    else Reflect.deleteProperty(globalThis, "indexedDB");
    assert.deepEqual(journal, beforeJournal);
    assert.equal(cache.get("other-public-data"), "keep");
  });
  return {
    store: new WatchStorage(),
    tx,
    request,
    calls,
    deletes,
    cache,
    complete() {
      for (const key of deletes) cache.delete(key);
      tx.oncomplete?.();
    },
  };
}

test("removeSavedSnapshot deletes only its fixed optional key after transaction completion", async (t) => {
  const { store, request, calls, deletes, cache, complete } =
      snapshotStorage(t),
    removing = store.removeSavedSnapshot();
  let settled = false;
  void removing.then(() => {
    settled = true;
  });
  await setImmediate();
  assert.deepEqual(calls, [
    {
      store: "public-cache",
      mode: "readwrite",
      options: { durability: "strict" },
    },
  ]);
  assert.deepEqual(deletes, ["last-snapshot"]);
  request.onsuccess?.();
  await setImmediate();
  assert.equal(settled, false, "request success is not transaction completion");
  assert(cache.has("last-snapshot"));
  complete();
  await removing;
  assert.equal(cache.has("last-snapshot"), false);
  assert.equal(settled, true);
});

test("removeSavedSnapshot also completes when no optional snapshot exists", async (t) => {
  const { store, complete, cache } = snapshotStorage(t, { absent: true }),
    removing = store.removeSavedSnapshot();
  await setImmediate();
  complete();
  await removing;
  assert.equal(cache.has("last-snapshot"), false);
});

test("removeSavedSnapshot request, transaction and abort failures settle without claiming deletion", async (t) => {
  for (const mode of [
    "request",
    "transaction",
    "abort",
    "abort-with-error",
  ] as const)
    await t.test(mode, async (t) => {
      const { store, tx, request, cache } = snapshotStorage(t),
        failure = new DOMException("Imposed removal failure", "UnknownError"),
        removing = store.removeSavedSnapshot(),
        rejected =
          mode === "abort"
            ? assert.rejects(removing, /removal transaction aborted/)
            : assert.rejects(removing, (error) => error === failure);
      await setImmediate();
      if (mode === "request") {
        request.error = failure;
        request.onerror();
      } else if (mode === "transaction") {
        tx.error = failure;
        tx.onerror();
      } else {
        if (mode === "abort-with-error") tx.error = failure;
        tx.onabort();
      }
      await rejected;
      assert(cache.has("last-snapshot"));
    });
});

test("removeSavedSnapshot synchronous delete and transaction-open failures reject", async (t) => {
  for (const mode of ["deleteFailure", "transactionFailure"] as const)
    await t.test(mode, async (t) => {
      const failure = new DOMException(
          "Imposed delete failure",
          "InvalidStateError",
        ),
        { store, cache } = snapshotStorage(t, { [mode]: failure });
      await assert.rejects(
        store.removeSavedSnapshot(),
        (error) => error === failure,
      );
      assert(cache.has("last-snapshot"));
    });
});
