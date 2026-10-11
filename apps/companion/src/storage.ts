import {
  validateStoredJournal,
  type WalletJournal,
} from "@pearl-ledger/wallet";
const DB = "pearl-ledger-watch-v1";
function normalizeJournal(value: unknown): WalletJournal {
  try {
    return validateStoredJournal(value);
  } catch (cause) {
    throw new Error(
      "Corrupt payment journal; do not clear storage or reuse inputs",
      { cause },
    );
  }
}
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
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("journals", "readonly"),
        request = tx.objectStore("journals").get(account);
      let journal: WalletJournal;
      request.onsuccess = () => {
        try {
          journal = normalizeJournal(request.result);
        } catch (error) {
          tx.abort();
          reject(error);
        }
      };
      request.onerror = () => reject(request.error);
      tx.oncomplete = () => resolve(journal);
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to read payment reservations"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Payment storage transaction aborted"));
    });
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
          const journal = normalizeJournal(request.result);
          result = update(journal);
          normalizeJournal(journal);
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
      tx.onabort = () =>
        reject(
          tx.error ??
            new Error("Public watch data storage transaction aborted"),
        );
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
  /** Remove only the optional watch snapshot; payment recovery rows are never touched. */
  async removeSavedSnapshot(): Promise<void> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const tx = db.transaction("public-cache", "readwrite", {
        durability: "strict",
      });
      const request = tx.objectStore("public-cache").delete("last-snapshot");
      request.onerror = () =>
        reject(request.error ?? new Error("Failed to remove saved watch data"));
      tx.oncomplete = () => resolve();
      tx.onerror = () =>
        reject(tx.error ?? new Error("Failed to remove saved watch data"));
      tx.onabort = () =>
        reject(tx.error ?? new Error("Watch data removal transaction aborted"));
    });
  }
}
