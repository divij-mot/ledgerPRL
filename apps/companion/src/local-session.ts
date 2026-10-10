import {
  accountToJson,
  assert,
  type AccountPublicKey,
} from "@pearl-ledger/sdk";
import { accountId } from "@pearl-ledger/wallet";
import type { LocalPost } from "./local-sync.js";

/** Own startup even if the view that requested it is cancelled or replaced. */
export class LocalSession {
  private owner: string | null = null;
  private starting: Promise<unknown> | null = null;

  start(account: AccountPublicKey, minimumIndex: unknown, post: LocalPost) {
    const owner = accountId(account);
    assert(
      !this.owner || this.owner === owner,
      "Close the previous local account before switching",
    );
    assert(!this.starting, "Local account is already starting");
    this.owner = owner;
    // Cancelling a browser read cannot undo creation of the owned native process.
    // Keep its bounded HTTP result alive so close can wait for that creation.
    const work = post(
      "/api/local/start",
      { account: accountToJson(account), minimumIndex },
      new AbortController().signal,
    );
    this.starting = work;
    void work
      .finally(() => {
        if (this.starting === work) this.starting = null;
      })
      .catch(() => {});
    return work;
  }

  async close(
    post: LocalPost,
    signal?: AbortSignal,
    restored?: AccountPublicKey | null,
  ) {
    // A reload may precede this page's first start while the owned server-side
    // profile is already running. The restored identity is safe to close only
    // because the endpoint checks its exact owner before stopping anything.
    const owner = this.owner ?? (restored ? accountId(restored) : null);
    if (!owner) return;
    await this.starting?.catch(() => {});
    signal?.throwIfAborted();
    const result = await post("/api/local/close", { owner }, signal);
    assert(
      result &&
        typeof result === "object" &&
        "closed" in result &&
        result.closed === true,
      "Local account shutdown was not confirmed; retry before switching",
    );
    // Retain ownership on every failure so a later close can recover it.
    if (this.owner === owner) this.owner = null;
  }
}
