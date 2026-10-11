import { readFileSync } from "node:fs";
import { accountFromJson, bundleFromJson } from "@pearl-ledger/sdk";
import {
  createSnapHandler,
  chainFor,
  jsonClone,
  type Approval,
  type SavedState,
  type SnapRuntime,
} from "../src/core.js";
export const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
export const account = () => accountFromJson(fixture.publicAccount);
export const bundle = () => bundleFromJson(fixture.bundle);
export const ORIGIN = "http://127.0.0.1:5173";
export const chain = chainFor("regtest");
export class Harness implements SnapRuntime {
  state: SavedState | null = null;
  time = Date.now();
  approvals: Approval[] = [];
  approve = true;
  writes = 0;
  failWriteAt = -1;
  dialog?: (approval: Approval) => Promise<boolean>;
  handler = createSnapHandler(this);
  now() {
    return this.time;
  }
  async readState() {
    return jsonClone(this.state);
  }
  async writeState(state: SavedState) {
    this.writes++;
    if (this.writes === this.failWriteAt)
      throw new Error("Storage unavailable");
    this.state = jsonClone(state);
  }
  async confirm(approval: Approval) {
    this.approvals.push(approval);
    return this.dialog ? this.dialog(approval) : this.approve;
  }
  call(method: string, params: unknown, origin = ORIGIN) {
    return this.handler(origin, { method, params });
  }
  async connect(origin = ORIGIN) {
    return (await this.call(
      "prl_connect",
      { chain, account: fixture.publicAccount, nonce: "a1".repeat(32) },
      origin,
    )) as { sessionId: string; expiresAt: number; nextSequence: number };
  }
  params() {
    return { sessionId: this.state!.session!.sessionId, chain };
  }
  async prepare() {
    return (await this.call("prl_prepareTransaction", {
      ...this.params(),
      sequence: this.state!.session!.nextSequence,
      bundle: fixture.bundle,
    })) as {
      requestId: string;
      digest: string;
      sequence: number;
      expiresAt: number;
    };
  }
  submit(
    pending = this.state!.session!.pending!,
    signatures = fixture.signatures,
  ) {
    return this.call("prl_submitSignatures", {
      ...this.params(),
      requestId: pending.requestId,
      digest: pending.digest,
      signatures,
    });
  }
  restart() {
    this.handler = createSnapHandler(this);
  }
}
export function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
