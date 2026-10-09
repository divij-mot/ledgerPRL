import { assert } from "@pearl-ledger/sdk";
import { MAX_BACKUP_BYTES, type WalletBackup } from "@pearl-ledger/wallet";

export type BackupImportResponse =
  | { ok: true; backup: WalletBackup }
  | { ok: false; error: string };

/** Validate in an isolated, one-shot worker; never fall back to blocking the UI. */
export async function importWalletBackupFile(
  file: Blob,
  signal: AbortSignal,
): Promise<WalletBackup> {
  signal.throwIfAborted();
  assert(file.size <= MAX_BACKUP_BYTES, "Backup exceeds 16 MiB");
  const worker = new Worker(
    new URL("./backup-import.worker.ts", import.meta.url),
    {
      type: "module",
    },
  );
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (result?: WalletBackup, error?: unknown) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", cancel);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (result) resolve(result);
      else reject(error);
    };
    const cancel = () =>
      finish(undefined, signal.reason ?? new Error("Backup import cancelled"));
    worker.onmessage = (event: MessageEvent<BackupImportResponse>) => {
      if (signal.aborted) return cancel();
      const data = event.data;
      if (data?.ok === true && data.backup) finish(data.backup);
      else
        finish(
          undefined,
          new Error(
            data?.ok === false && typeof data.error === "string"
              ? data.error
              : "Invalid backup validator response",
          ),
        );
    };
    worker.onerror = () =>
      finish(
        undefined,
        new Error("Backup validation worker failed; no backup was imported"),
      );
    worker.onmessageerror = () =>
      finish(undefined, new Error("Unable to read backup validation result"));
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) return cancel();
    try {
      // Blob is immutable and structured-cloneable; reading and parsing happen
      // inside the worker, not in the UI's event loop.
      worker.postMessage(file);
    } catch (error) {
      finish(undefined, error);
    }
  });
}
