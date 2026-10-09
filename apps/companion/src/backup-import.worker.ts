import { assert } from "@pearl-ledger/sdk";
import { importWalletBackup, MAX_BACKUP_BYTES } from "@pearl-ledger/wallet";
import type { BackupImportResponse } from "./backup-import.js";

// Use the narrow shared surface without adding conflicting DOM/WebWorker libs
// to the companion's TypeScript program.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  postMessage(message: BackupImportResponse): void;
  close(): void;
};
scope.onmessage = async ({ data }) => {
  scope.onmessage = null;
  try {
    assert(data instanceof Blob, "Expected a public wallet backup file");
    assert(data.size <= MAX_BACKUP_BYTES, "Backup exceeds 16 MiB");
    const backup = importWalletBackup(await data.text());
    scope.postMessage({ ok: true, backup });
  } catch (error) {
    scope.postMessage({
      ok: false,
      error:
        error instanceof Error ? error.message : "Backup validation failed",
    });
  } finally {
    scope.close();
  }
};
