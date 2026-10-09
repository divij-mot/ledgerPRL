import { assert } from "@pearl-ledger/sdk";
import { emptyJournal, type WalletJournal } from "@pearl-ledger/wallet";
const DB = "pearl-ledger-watch-v1";
export class WatchStorage {
  private db: Promise<IDBDatabase>;
  constructor() {
    this.db = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("journals");
        request.result.createObjectStore("public-cache");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () =>
        reject(
          new Error(
            "Persistent browser storage is unavailable; payment preparation is disabled",
          ),
        );
    });
  }
  async journal(account: string): Promise<WalletJournal> {
    return this.mutate(account, (j) => structuredClone(j));
  }
  async mutate<T>(
    account: string,
    update: (journal: WalletJournal) => T,
  ): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("journals", "readwrite", {
          durability: "strict",
        }),
        store = tx.objectStore("journals");
      let result: T;
      const request = store.get(account);
      request.onsuccess = () => {
        try {
          const journal = (request.result ?? emptyJournal()) as WalletJournal;
          if (journal.issuedReceiveThrough === undefined)
            journal.issuedReceiveThrough = -1;
          assert(
            journal.schema === 1 &&
              Array.isArray(journal.payments) &&
              Number.isInteger(journal.nextChangeIndex),
            "Corrupt payment journal; do not clear storage or reuse inputs",
          );
          result = update(journal);
          store.put(journal, account);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to persist payment reservations"));
      tx.onabort = () =>
        reject(new Error("Payment storage transaction aborted"));
    });
  }
  async save(key: string, value: unknown): Promise<void> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("public-cache", "readwrite");
      tx.objectStore("public-cache").put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }
  async load<T>(key: string): Promise<T | undefined> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const request = db
        .transaction("public-cache", "readonly")
        .objectStore("public-cache")
        .get(key);
      request.onsuccess = () => resolve(request.result as T | undefined);
      request.onerror = () => reject(request.error);
    });
  }
}
