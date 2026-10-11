import { accountToJson, type AccountPublicKey } from "@pearl-ledger/sdk";
import { accountId } from "@pearl-ledger/wallet";
import {
  localStatus,
  LocalWatchSource,
  type LocalStatus,
} from "./local-source.js";

export type LocalPost = (
  route: string,
  body: unknown,
  signal?: AbortSignal,
) => Promise<unknown>;

export async function localSource(
  account: AccountPublicKey,
  post: LocalPost,
  signal: AbortSignal,
): Promise<LocalWatchSource> {
  const owner = accountId(account);
  return new LocalWatchSource(
    account,
    await post("/api/local/snapshot", { owner }, signal),
    (method, params) =>
      post(`/api/local/${method}`, { owner, ...(params as object) }, signal),
  );
}

/** Header/filter scanning continues in the native process while the interface stays usable. */
export async function waitForLocalSource(
  account: AccountPublicKey,
  minimumIndex: [number, number],
  post: LocalPost,
  signal: AbortSignal,
  progress: (status: LocalStatus) => void,
): Promise<LocalWatchSource> {
  const owner = accountId(account);
  let status = localStatus(
    await post(
      "/api/local/start",
      { account: accountToJson(account), minimumIndex },
      signal,
    ),
    account,
  );
  for (;;) {
    signal.throwIfAborted();
    progress(status);
    const required: [number, number] = [
      Math.max(minimumIndex[0], status.lastUsed[0]),
      Math.max(minimumIndex[1], status.lastUsed[1]),
    ];
    const enough = required.every(
      (minimum, branch) => status.registeredThrough[branch]! >= minimum + 20,
    );
    if (status.ready && enough) return localSource(account, post, signal);
    if (status.synced && (!enough || status.needsRegistration)) {
      status = localStatus(
        await post(
          "/api/local/register",
          { owner, minimumIndex: required },
          signal,
        ),
        account,
      );
      continue;
    }
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        reject(signal.reason);
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 1500);
      signal.addEventListener("abort", abort, { once: true });
      if (signal.aborted) abort();
    });
    status = localStatus(
      await post("/api/local/status", { owner }, signal),
      account,
    );
  }
}
