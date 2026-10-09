import {
  accountFromJson,
  accountToJson,
  bundleFromJson,
  bundleToJson,
  deriveAddress,
  encodeBundle,
  finalizeTransaction,
  formatPrl,
  fromHex,
  hex,
  NETWORKS,
  sha256,
  scriptToAddress,
  validateBundle,
  type AccountPublicKey,
  type NetworkName,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import { assertPaymentPolicy } from "@pearl-ledger/wallet";
import {
  COMPANION_ORIGINS,
  MAX_ADDRESS_INDEX,
  MAX_REQUESTS_PER_SESSION,
  MAX_RPC_BYTES,
  REQUEST_TTL_MS,
  SESSION_TTL_MS,
} from "./config.js";

export type PublicAccountJson = ReturnType<typeof accountToJson>;
export type BundleJson = ReturnType<typeof bundleToJson>;
export interface Chain {
  network: NetworkName;
  genesisHash: string;
}
export interface Approval {
  title: string;
  lines: readonly string[];
}
export interface PendingRequest {
  requestId: string;
  sequence: number;
  digest: string;
  approvedAt: number;
  expiresAt: number;
  bundle: BundleJson;
}
export interface Session {
  sessionId: string;
  origin: string;
  chain: Chain;
  account: PublicAccountJson;
  createdAt: number;
  expiresAt: number;
  nextSequence: number;
  pending: PendingRequest | null;
}
export interface SavedState {
  schema: 1;
  revision: number;
  session: Session | null;
}
export interface SnapRuntime {
  readState(): Promise<unknown>;
  writeState(state: SavedState): Promise<void>;
  confirm(approval: Approval): Promise<boolean>;
  now(): number;
}
export class PrlRpcError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = "PrlRpcError";
  }
}
export function requireCondition(
  value: unknown,
  message: string,
  code = -32602,
): asserts value {
  if (!value) throw new PrlRpcError(code, message);
}
export function object(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, unknown> {
  requireCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `Invalid ${label}`,
  );
  const record = value as Record<string, unknown>;
  requireCondition(
    Object.keys(record).length === keys.length &&
      keys.every((key) => Object.hasOwn(record, key)),
    `Unexpected or missing ${label} field`,
  );
  return record;
}
export function integer(value: unknown, max = Number.MAX_SAFE_INTEGER): number {
  requireCondition(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= max,
    "Expected bounded nonnegative integer",
  );
  return value;
}
export function hash(value: unknown): string {
  requireCondition(
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
    "Expected lowercase 32-byte identifier",
  );
  return value;
}
export function parseChain(value: unknown): Chain {
  const v = object(value, ["network", "genesisHash"], "chain");
  requireCondition(
    typeof v.network === "string" && Object.hasOwn(NETWORKS, v.network),
    "Unknown PRL network",
  );
  const network = v.network as NetworkName;
  requireCondition(
    v.genesisHash === NETWORKS[network].genesisHash,
    "PRL genesis/network mismatch",
  );
  return { network, genesisHash: v.genesisHash as string };
}
export function chainFor(network: NetworkName): Chain {
  return parseChain({ network, genesisHash: NETWORKS[network]?.genesisHash });
}
/** Origin is provided by MetaMask, never accepted from RPC params. No wildcard or suffix matching. */
export function assertOrigin(origin: unknown): asserts origin is string {
  requireCondition(
    typeof origin === "string" && COMPANION_ORIGINS.includes(origin),
    "Origin is not authorized for the PRL companion Snap",
    4100,
  );
  const parsed = new URL(origin);
  requireCondition(
    parsed.origin === origin && !parsed.username && !parsed.password,
    "Noncanonical origin",
    4100,
  );
}
export function jsonClone<T>(value: T, limit = MAX_RPC_BYTES): T {
  const text = JSON.stringify(value);
  requireCondition(
    typeof text === "string" && new TextEncoder().encode(text).length <= limit,
    "RPC payload exceeds size limit",
  );
  return JSON.parse(text) as T;
}
function digestParts(...parts: unknown[]): string {
  return hex(sha256(new TextEncoder().encode(JSON.stringify(parts))));
}
export function transactionDigest(bundle: SigningBundle): string {
  return hex(sha256(encodeBundle(bundle)));
}
function sameChain(a: Chain, b: Chain): boolean {
  return a.network === b.network && a.genesisHash === b.genesisHash;
}
export function transactionRequestId(
  sessionId: string,
  sequence: number,
  chain: Chain,
  digest: string,
): string {
  return digestParts(
    "pearl-ledger-snap/request/v1",
    sessionId,
    sequence,
    chain,
    digest,
  );
}
function parsePending(
  value: unknown,
  session: Omit<Session, "pending">,
): PendingRequest | null {
  if (value === null) return null;
  const v = object(
    value,
    ["requestId", "sequence", "digest", "approvedAt", "expiresAt", "bundle"],
    "pending request",
  );
  const bundle = bundleFromJson(v.bundle);
  validateBundle(bundle, accountFromJson(session.account));
  assertPaymentPolicy(bundle);
  const sequence = integer(v.sequence, MAX_REQUESTS_PER_SESSION);
  const approvedAt = integer(v.approvedAt),
    expiresAt = integer(v.expiresAt);
  requireCondition(
    sequence >= 1 && sequence + 1 === session.nextSequence,
    "Invalid pending request sequence",
  );
  requireCondition(
    approvedAt >= session.createdAt &&
      expiresAt > approvedAt &&
      expiresAt <= Math.min(session.expiresAt, approvedAt + REQUEST_TTL_MS),
    "Invalid pending expiry",
  );
  const digest = transactionDigest(bundle);
  requireCondition(v.digest === digest, "Pending transaction changed");
  const requestId = transactionRequestId(
    session.sessionId,
    sequence,
    session.chain,
    digest,
  );
  requireCondition(
    v.requestId === requestId,
    "Pending request binding changed",
  );
  return {
    requestId,
    sequence,
    digest,
    approvedAt,
    expiresAt,
    bundle: bundleToJson(bundle),
  };
}
export function parseState(value: unknown): SavedState {
  if (value === null) return { schema: 1, revision: 0, session: null };
  const v = object(
    jsonClone(value, MAX_RPC_BYTES * 2),
    ["schema", "revision", "session"],
    "Snap state",
  );
  requireCondition(v.schema === 1, "Unsupported Snap state");
  const revision = integer(v.revision);
  if (v.session === null) return { schema: 1, revision, session: null };
  const s = object(
    v.session,
    [
      "sessionId",
      "origin",
      "chain",
      "account",
      "createdAt",
      "expiresAt",
      "nextSequence",
      "pending",
    ],
    "saved session",
  );
  assertOrigin(s.origin);
  const chain = parseChain(s.chain),
    account = accountToJson(accountFromJson(s.account));
  requireCondition(
    account.network === chain.network,
    "Session account chain mismatch",
  );
  const createdAt = integer(s.createdAt),
    expiresAt = integer(s.expiresAt);
  requireCondition(
    expiresAt === createdAt + SESSION_TTL_MS,
    "Invalid session expiry",
  );
  const nextSequence = integer(s.nextSequence, MAX_REQUESTS_PER_SESSION + 1);
  requireCondition(nextSequence >= 1, "Invalid session sequence");
  const session = {
    sessionId: hash(s.sessionId),
    origin: s.origin,
    chain,
    account,
    createdAt,
    expiresAt,
    nextSequence,
  };
  return {
    schema: 1,
    revision,
    session: { ...session, pending: parsePending(s.pending, session) },
  };
}
export interface RpcRequest {
  method: string;
  params: unknown;
}
function parseRequest(value: unknown): RpcRequest {
  requireCondition(
    value !== null && typeof value === "object" && !Array.isArray(value),
    "Invalid RPC request",
  );
  const v = value as Record<string, unknown>;
  requireCondition(
    Object.keys(v).every((k) =>
      ["method", "params", "id", "jsonrpc"].includes(k),
    ),
    "Unexpected RPC envelope field",
  );
  requireCondition(
    typeof v.method === "string" &&
      v.method.length <= 64 &&
      Object.hasOwn(v, "params"),
    "RPC method and params required",
  );
  requireCondition(
    v.jsonrpc === undefined || v.jsonrpc === "2.0",
    "Invalid JSON-RPC version",
  );
  requireCondition(
    v.id === undefined ||
      (typeof v.id === "string" && v.id.length <= 128) ||
      (typeof v.id === "number" && Number.isSafeInteger(v.id)),
    "Invalid JSON-RPC id",
  );
  return { method: v.method, params: v.params };
}

/** No signer, transport, network access, seed or private-key capability exists in this engine. */
export function createSnapHandler(runtime: SnapRuntime) {
  let busy = false;
  return async (origin: string, rawRequest: unknown): Promise<unknown> => {
    assertOrigin(origin);
    requireCondition(
      !busy,
      "Another PRL request is active; finish or reject it first",
      -32002,
    );
    const request = parseRequest(jsonClone(rawRequest));
    busy = true;
    try {
      const startedAt = integer(runtime.now());
      const state = parseState(await runtime.readState());
      const now = integer(runtime.now());
      requireCondition(
        now >= startedAt,
        "Clock moved backwards while reading Snap state",
      );
      const persist = async () => {
        await runtime.writeState(jsonClone(state));
      };
      if (request.method === "prl_connect") {
        const p = object(
          request.params,
          ["chain", "account", "nonce"],
          "connection params",
        );
        const chain = parseChain(p.chain),
          account = accountToJson(accountFromJson(p.account));
        requireCondition(
          account.network === chain.network,
          "Public account is on another chain",
        );
        const nonce = hash(p.nonce);
        requireCondition(
          state.revision < Number.MAX_SAFE_INTEGER,
          "Snap revision exhausted",
        );
        // Retire the old session before opening a prompt, including if the new prompt is rejected.
        state.session = null;
        state.revision++;
        await persist();
        const expectedAddress = deriveAddress(
          accountFromJson(account),
          0,
          0,
        ).address;
        const approved = await runtime.confirm({
          title: "Connect a PRL public account",
          lines: [
            origin,
            `Network: ${chain.network}`,
            `Genesis: ${chain.genesisHash}`,
            `Account: ${account.account}; master fingerprint: ${account.masterFingerprint}`,
            "Compare this first receive address with the address displayed by your Ledger:",
            expectedAddress,
            "The companion supplies public account data. MetaMask cannot prove that it came from a Ledger. Reject if the device address differs.",
            "This permission exposes this public account and derived addresses to this companion origin for 15 minutes. Public data is stored encrypted in this Snap.",
            "This Snap has no private keys. Every signing operation still requires a separate companion action and Ledger approval.",
          ],
        });
        requireCondition(approved === true, "Connection rejected", 4001);
        const createdAt = integer(runtime.now());
        requireCondition(
          createdAt >= now && createdAt - now <= REQUEST_TTL_MS,
          "Connection approval expired",
        );
        const sessionId = digestParts(
          "pearl-ledger-snap/session/v1",
          origin,
          nonce,
          state.revision,
          createdAt,
          chain,
          account,
        );
        state.session = {
          sessionId,
          origin,
          chain,
          account,
          createdAt,
          expiresAt: createdAt + SESSION_TTL_MS,
          nextSequence: 1,
          pending: null,
        };
        await persist();
        return {
          sessionId,
          chain,
          account,
          expiresAt: state.session.expiresAt,
          nextSequence: 1,
        };
      }
      const supported = [
        "prl_getAccount",
        "prl_getAddress",
        "prl_prepareTransaction",
        "prl_submitSignatures",
        "prl_cancel",
        "prl_disconnect",
      ];
      requireCondition(
        supported.includes(request.method),
        "Unsupported PRL method",
        -32601,
      );
      const p = request.params;
      const extra: Record<string, string[]> = {
        prl_getAccount: [],
        prl_getAddress: ["branch", "index"],
        prl_prepareTransaction: ["sequence", "bundle"],
        prl_submitSignatures: ["requestId", "digest", "signatures"],
        prl_cancel: ["requestId"],
        prl_disconnect: [],
      };
      const params = object(
        p,
        ["sessionId", "chain", ...extra[request.method]!],
        "PRL params",
      );
      const session = state.session;
      requireCondition(
        session &&
          session.sessionId === hash(params.sessionId) &&
          session.origin === origin,
        "Missing or unauthorized PRL session",
        4100,
      );
      requireCondition(
        sameChain(parseChain(params.chain), session.chain),
        "Session chain mismatch",
        4100,
      );
      requireCondition(
        now >= session.createdAt && now < session.expiresAt,
        "PRL session expired; reconnect",
        4100,
      );
      if (request.method === "prl_disconnect") {
        state.session = null;
        await persist();
        return { disconnected: true };
      }
      if (request.method === "prl_getAccount")
        return jsonClone({
          account: session.account,
          chain: session.chain,
          expiresAt: session.expiresAt,
          nextSequence: session.nextSequence,
        });
      const account = accountFromJson(session.account);
      if (request.method === "prl_getAddress") {
        requireCondition(
          params.branch === 0 || params.branch === 1,
          "Invalid address branch",
        );
        const index = integer(params.index, MAX_ADDRESS_INDEX);
        const derived = deriveAddress(account, params.branch, index);
        return {
          address: derived.address,
          path: derived.path,
          deviceVerified: false,
        };
      }
      if (request.method === "prl_prepareTransaction") {
        const sequence = integer(params.sequence, MAX_REQUESTS_PER_SESSION);
        requireCondition(
          sequence >= 1 && sequence === session.nextSequence,
          "Replayed or out-of-order transaction sequence",
        );
        requireCondition(
          session.pending === null,
          "Finish or cancel the pending transaction",
          -32002,
        );
        const bundle = bundleFromJson(params.bundle);
        const { fee } = validateBundle(bundle, account);
        assertPaymentPolicy(bundle);
        requireCondition(fee > 0n, "Choose an explicit positive fee");
        const digest = transactionDigest(bundle),
          recipient = bundle.outputs.find((o) => o.role === "recipient")!;
        const requestId = transactionRequestId(
          session.sessionId,
          sequence,
          session.chain,
          digest,
        );
        // Consume before the dialog. A crash or rejection cannot resurrect the same sequence.
        session.nextSequence++;
        await persist();
        const approved = await runtime.confirm({
          title: "Review external PRL signing request",
          lines: [
            origin,
            `Network: ${session.chain.network}`,
            `Genesis: ${session.chain.genesisHash}`,
            `Recipient: ${scriptToAddress(recipient.scriptPubKey, bundle.network)}`,
            `Amount: ${formatPrl(recipient.amount)} PRL`,
            `Fee: ${formatPrl(fee)} PRL`,
            ...bundle.outputs
              .filter((o) => o.role === "change")
              .map(
                (o) =>
                  `Change: ${formatPrl(o.amount)} PRL to ${scriptToAddress(o.scriptPubKey, bundle.network)}`,
              ),
            `Inputs: ${bundle.inputs.length}; account: ${bundle.account}`,
            `Transaction digest: ${digest}`,
            "Continue only after checking the payment. The companion must validate live inputs, and the Ledger must display and approve these details separately.",
            "This approval does not sign or broadcast. Returned signed bytes can be broadcast by anyone holding them.",
          ],
        });
        requireCondition(
          approved === true,
          "Transaction review rejected",
          4001,
        );
        const approvedAt = integer(runtime.now());
        requireCondition(
          approvedAt >= now &&
            approvedAt - now <= REQUEST_TTL_MS &&
            approvedAt < session.expiresAt,
          "Transaction review expired",
        );
        const expiresAt = Math.min(
          session.expiresAt,
          approvedAt + REQUEST_TTL_MS,
        );
        session.pending = {
          requestId,
          sequence,
          digest,
          approvedAt,
          expiresAt,
          bundle: bundleToJson(bundle),
        };
        await persist();
        const releasedAt = integer(runtime.now());
        requireCondition(
          releasedAt >= approvedAt && releasedAt < expiresAt,
          "PRL approval expired while saving state",
        );
        return { requestId, sequence, digest, expiresAt };
      }
      const pending = session.pending;
      requireCondition(
        pending && pending.requestId === hash(params.requestId),
        "No matching pending PRL request",
      );
      if (request.method === "prl_cancel") {
        session.pending = null;
        await persist();
        return { cancelled: true };
      }
      // Consume even malformed/expired submission attempts before releasing any finalized result.
      session.pending = null;
      await persist();
      const submittedAt = integer(runtime.now());
      requireCondition(
        submittedAt >= now &&
          submittedAt >= pending.approvedAt &&
          submittedAt < pending.expiresAt,
        "PRL signing request expired",
      );
      requireCondition(
        params.digest === pending.digest,
        "Signing request digest mismatch",
      );
      const bundle = bundleFromJson(pending.bundle);
      requireCondition(
        Array.isArray(params.signatures) &&
          params.signatures.length === bundle.inputs.length,
        "Signature count mismatch",
      );
      const signatures = params.signatures.map((signature: unknown) => {
        requireCondition(
          typeof signature === "string" && /^[0-9a-f]{128}$/.test(signature),
          "Expected 64-byte SIGHASH_DEFAULT signature",
        );
        return fromHex(signature);
      });
      const finalized = finalizeTransaction(bundle, signatures);
      const finalizedAt = integer(runtime.now());
      requireCondition(
        finalizedAt >= submittedAt && finalizedAt < pending.expiresAt,
        "PRL signature verification expired",
      );
      return {
        requestId: pending.requestId,
        digest: pending.digest,
        chain: session.chain,
        rawTx: finalized.rawTx,
        txid: finalized.txid,
        wtxid: finalized.wtxid,
        vsize: finalized.vsize,
      };
    } finally {
      busy = false;
    }
  };
}
