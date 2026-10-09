import {
  accountFromJson,
  accountToJson,
  addressToScript,
  bundleFromJson,
  bundleToJson,
  deriveAddress,
  finalizeTransaction,
  hex,
  parsePrl,
  parseTransaction,
  sha256,
  scriptToAddress,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import {
  assertOrigin,
  createSnapHandler,
  hash,
  integer,
  jsonClone,
  object,
  parseChain,
  parseState,
  requireCondition,
  type Approval,
  type BundleJson,
  type Chain,
  type SavedState,
  type Session,
  type SnapRuntime,
} from "./core.js";
import {
  ALLOWED_ORIGINS,
  DAPP_ORIGINS,
  MAX_RPC_BYTES,
  REQUEST_TTL_MS,
} from "./config.js";

const MAX_REQUESTS = 8;
const MAX_PER_ORIGIN = 4;
const INTENT_TTL = 10 * 60_000;
const POLL_INTERVAL = 1_000;
const TERMINAL_RETENTION = 24 * 60 * 60_000;
export type DappStatus =
  | "queued"
  | "claimed"
  | "prepared"
  | "signing"
  | "signed"
  | "broadcast-unknown"
  | "broadcast-reported"
  | "cancelled"
  | "expired";
export interface DappGrant {
  id: string;
  origin: string;
  chain: Chain;
  sessionId: string;
  address: string;
  createdAt: number;
  expiresAt: number;
  nextSequence: number;
}
export interface DappIntent {
  id: string;
  origin: string;
  companionOrigin: string;
  accountId: string;
  chain: Chain;
  sessionId: string;
  grantId: string;
  sequence: number;
  recipient: string;
  amountPrl: string;
  createdAt: number;
  expiresAt: number;
  updatedAt: number;
  status: DappStatus;
  signingRequestId: string | null;
  bundle: BundleJson | null;
  txid: string | null;
}
export interface BrokerState {
  schema: 1;
  revision: number;
  grants: DappGrant[];
  intents: DappIntent[];
  polls: Record<string, number>;
}
export interface ControllerState {
  schema: 2;
  companion: SavedState | null;
  broker: BrokerState;
}
export interface PublicDappRequest {
  id: string;
  origin: string;
  chain: Chain;
  recipient: string;
  amountPrl: string;
  createdAt: number;
  expiresAt: number;
  status: DappStatus;
  txid: string | null;
  broadcast: "not-reported" | "unknown" | "companion-reported-accepted";
}
export function publicIntent(intent: DappIntent): PublicDappRequest {
  return jsonClone({
    id: intent.id,
    origin: intent.origin,
    chain: intent.chain,
    recipient: intent.recipient,
    amountPrl: intent.amountPrl,
    createdAt: intent.createdAt,
    expiresAt: intent.expiresAt,
    status: intent.status,
    txid: intent.txid,
    broadcast:
      intent.status === "broadcast-reported"
        ? "companion-reported-accepted"
        : intent.status === "broadcast-unknown"
          ? "unknown"
          : "not-reported",
  });
}
export function parsePublicIntent(value: unknown): PublicDappRequest {
  const p = object(
    value,
    [
      "id",
      "origin",
      "chain",
      "recipient",
      "amountPrl",
      "createdAt",
      "expiresAt",
      "status",
      "txid",
      "broadcast",
    ],
    "public website request",
  );
  dappOrigin(p.origin);
  const chain = parseChain(p.chain);
  requireCondition(
    typeof p.status === "string" &&
      [
        "queued",
        "claimed",
        "prepared",
        "signing",
        "signed",
        "broadcast-unknown",
        "broadcast-reported",
        "cancelled",
        "expired",
      ].includes(p.status),
    "Unknown website request status",
  );
  const expectedBroadcast =
    p.status === "broadcast-reported"
      ? "companion-reported-accepted"
      : p.status === "broadcast-unknown"
        ? "unknown"
        : "not-reported";
  requireCondition(
    p.broadcast === expectedBroadcast,
    "Invalid website broadcast status",
  );
  return {
    id: hash(p.id),
    origin: p.origin,
    chain,
    recipient: validAddress(p.recipient, chain),
    amountPrl: amount(p.amountPrl),
    createdAt: integer(p.createdAt),
    expiresAt: integer(p.expiresAt),
    status: p.status as DappStatus,
    txid: p.txid === null ? null : hash(p.txid),
    broadcast: expectedBroadcast,
  };
}
function identify(...parts: unknown[]) {
  return hex(sha256(new TextEncoder().encode(JSON.stringify(parts))));
}
function sameChain(a: Chain, b: Chain) {
  return a.network === b.network && a.genesisHash === b.genesisHash;
}
function dappOrigin(value: unknown): asserts value is string {
  requireCondition(
    typeof value === "string" && DAPP_ORIGINS.includes(value),
    "Website origin is not allowlisted",
    4100,
  );
}
function validAddress(value: unknown, chain: Chain): string {
  requireCondition(
    typeof value === "string" && value === value.toLowerCase(),
    "Expected canonical PRL address",
  );
  requireCondition(
    scriptToAddress(addressToScript(value, chain.network), chain.network) ===
      value,
    "Noncanonical recipient",
  );
  return value;
}
function amount(value: unknown): string {
  requireCondition(
    typeof value === "string" && parsePrl(value) > 0n,
    "Expected positive PRL amount",
  );
  return value;
}
function emptyBroker(): BrokerState {
  return { schema: 1, revision: 0, grants: [], intents: [], polls: {} };
}
function parseBroker(value: unknown): BrokerState {
  const v = object(
    value,
    ["schema", "revision", "grants", "intents", "polls"],
    "broker state",
  );
  requireCondition(v.schema === 1, "Unsupported broker state");
  const revision = integer(v.revision);
  requireCondition(
    Array.isArray(v.grants) && v.grants.length <= DAPP_ORIGINS.length,
    "Too many website grants",
  );
  const origins = new Set<string>();
  const grants = v.grants.map((raw): DappGrant => {
    const g = object(
      raw,
      [
        "id",
        "origin",
        "chain",
        "sessionId",
        "address",
        "createdAt",
        "expiresAt",
        "nextSequence",
      ],
      "website grant",
    );
    dappOrigin(g.origin);
    requireCondition(!origins.has(g.origin), "Duplicate website grant");
    origins.add(g.origin);
    const chain = parseChain(g.chain),
      createdAt = integer(g.createdAt),
      expiresAt = integer(g.expiresAt),
      nextSequence = integer(g.nextSequence, 101);
    requireCondition(
      expiresAt > createdAt &&
        expiresAt <= createdAt + 15 * 60_000 &&
        nextSequence >= 1,
      "Invalid grant time/sequence",
    );
    return {
      id: hash(g.id),
      origin: g.origin,
      chain,
      sessionId: hash(g.sessionId),
      address: validAddress(g.address, chain),
      createdAt,
      expiresAt,
      nextSequence,
    };
  });
  requireCondition(
    Array.isArray(v.intents) && v.intents.length <= MAX_REQUESTS,
    "Too many payment intents",
  );
  const ids = new Set<string>();
  const statuses: DappStatus[] = [
    "queued",
    "claimed",
    "prepared",
    "signing",
    "signed",
    "broadcast-unknown",
    "broadcast-reported",
    "cancelled",
    "expired",
  ];
  const intents = v.intents.map((raw): DappIntent => {
    const i = object(
      raw,
      [
        "id",
        "origin",
        "companionOrigin",
        "accountId",
        "chain",
        "sessionId",
        "grantId",
        "sequence",
        "recipient",
        "amountPrl",
        "createdAt",
        "expiresAt",
        "updatedAt",
        "status",
        "signingRequestId",
        "bundle",
        "txid",
      ],
      "payment intent",
    );
    dappOrigin(i.origin);
    assertOrigin(i.companionOrigin);
    const chain = parseChain(i.chain),
      id = hash(i.id);
    requireCondition(!ids.has(id), "Duplicate payment intent");
    ids.add(id);
    const createdAt = integer(i.createdAt),
      expiresAt = integer(i.expiresAt),
      updatedAt = integer(i.updatedAt);
    requireCondition(
      expiresAt > createdAt &&
        expiresAt <= createdAt + INTENT_TTL &&
        updatedAt >= createdAt,
      "Invalid intent expiry",
    );
    requireCondition(
      typeof i.status === "string" && statuses.includes(i.status as DappStatus),
      "Unknown payment state",
    );
    const status = i.status as DappStatus;
    const sequence = integer(i.sequence, 100);
    requireCondition(sequence > 0, "Invalid intent sequence");
    const intent: DappIntent = {
      id,
      origin: i.origin,
      companionOrigin: i.companionOrigin,
      accountId: hash(i.accountId),
      chain,
      sessionId: hash(i.sessionId),
      grantId: hash(i.grantId),
      sequence,
      recipient: validAddress(i.recipient, chain),
      amountPrl: amount(i.amountPrl),
      createdAt,
      expiresAt,
      updatedAt,
      status,
      signingRequestId:
        i.signingRequestId === null ? null : hash(i.signingRequestId),
      bundle: null,
      txid: i.txid === null ? null : hash(i.txid),
    };
    requireCondition(
      id === intentId(intent),
      "Payment intent identity changed",
    );
    if (i.bundle !== null) {
      const bundle = bundleFromJson(i.bundle);
      assertPaymentMatches(intent, bundle);
      intent.bundle = bundleToJson(bundle);
    }
    if (
      [
        "prepared",
        "signing",
        "signed",
        "broadcast-unknown",
        "broadcast-reported",
      ].includes(status)
    )
      requireCondition(
        intent.bundle && intent.signingRequestId,
        "Missing prepared payment binding",
      );
    if (["signed", "broadcast-unknown", "broadcast-reported"].includes(status))
      requireCondition(intent.txid, "Missing signed transaction identity");
    else
      requireCondition(
        intent.txid === null,
        "Unsigned intent contains transaction identity",
      );
    return intent;
  });
  requireCondition(
    v.polls !== null && typeof v.polls === "object" && !Array.isArray(v.polls),
    "Invalid poll state",
  );
  const polls: Record<string, number> = {};
  for (const [origin, time] of Object.entries(v.polls as object)) {
    dappOrigin(origin);
    polls[origin] = integer(time);
  }
  return { schema: 1, revision, grants, intents, polls };
}
export function parseControllerState(value: unknown): ControllerState {
  if (value === null)
    return { schema: 2, companion: null, broker: emptyBroker() };
  // Development migration retires every old public session/approval; reconnect requires fresh consent.
  if (
    typeof value === "object" &&
    value !== null &&
    (value as { schema?: unknown }).schema === 1
  ) {
    const legacy = parseState(value);
    return {
      schema: 2,
      companion: { ...legacy, session: null },
      broker: emptyBroker(),
    };
  }
  const s = object(
    jsonClone(value, 256_000),
    ["schema", "companion", "broker"],
    "controller state",
  );
  requireCondition(s.schema === 2, "Unsupported controller state");
  return {
    schema: 2,
    companion: s.companion === null ? null : parseState(s.companion),
    broker: parseBroker(s.broker),
  };
}
function intentId(
  intent: Pick<
    DappIntent,
    | "origin"
    | "companionOrigin"
    | "accountId"
    | "chain"
    | "sessionId"
    | "grantId"
    | "sequence"
    | "recipient"
    | "amountPrl"
    | "createdAt"
  >,
): string {
  return identify(
    "prl-dapp-intent/v1",
    intent.origin,
    intent.companionOrigin,
    intent.accountId,
    intent.chain,
    intent.sessionId,
    intent.grantId,
    intent.sequence,
    intent.recipient,
    intent.amountPrl,
    intent.createdAt,
  );
}
function assertPaymentMatches(intent: DappIntent, bundle: SigningBundle) {
  const recipient = bundle.outputs.find((o) => o.role === "recipient");
  requireCondition(
    bundle.network === intent.chain.network &&
      recipient &&
      recipient.amount === parsePrl(intent.amountPrl) &&
      scriptToAddress(recipient.scriptPubKey, bundle.network) ===
        intent.recipient,
    "Transaction does not match website recipient, amount or network",
  );
}
const DAPP_METHODS = [
  "prl_requestAccounts",
  "prl_getAccounts",
  "prl_requestPayment",
  "prl_getRequest",
  "prl_cancelRequest",
  "prl_revokeAccounts",
];
const COMPANION_METHODS = [
  "prl_listDappRequests",
  "prl_claimDappRequest",
  "prl_rejectDappRequest",
  "prl_prepareDappTransaction",
  "prl_beginDappSigning",
  "prl_recordDappSigned",
  "prl_reportDappBroadcast",
];

/** One lock covers both engines: no storage races between website cancellations and companion signing claims. */
export function createSnapController(runtime: SnapRuntime) {
  let busy = false;
  return async (origin: string, request: unknown): Promise<unknown> => {
    requireCondition(
      ALLOWED_ORIGINS.includes(origin),
      "Origin is not authorized",
      4100,
    );
    requireCondition(!busy, "Another PRL request is active", -32002);
    const r = jsonClone(request) as Record<string, unknown>;
    requireCondition(
      r &&
        typeof r === "object" &&
        typeof r.method === "string" &&
        Object.hasOwn(r, "params") &&
        Object.keys(r).every((k) =>
          ["method", "params", "id", "jsonrpc"].includes(k),
        ) &&
        (r.jsonrpc === undefined || r.jsonrpc === "2.0"),
      "Invalid RPC envelope",
    );
    const method = r.method;
    if (DAPP_METHODS.includes(method)) dappOrigin(origin);
    else assertOrigin(origin);
    busy = true;
    try {
      const startedAt = integer(runtime.now());
      const state = parseControllerState(await runtime.readState());
      let now = integer(runtime.now());
      requireCondition(now >= startedAt, "Clock moved backwards");
      const latestSavedTime = Math.max(
        0,
        state.companion?.session?.createdAt ?? 0,
        state.companion?.session?.pending?.approvedAt ?? 0,
        ...state.broker.grants.map((g) => g.createdAt),
        ...state.broker.intents.map((i) => i.updatedAt),
        ...Object.values(state.broker.polls),
      );
      requireCondition(
        now >= latestSavedTime,
        "Clock moved backwards relative to saved state",
      );
      const persist = async () => {
        await runtime.writeState(
          jsonClone(state, 256_000) as unknown as SavedState,
        );
        const resumed = integer(runtime.now());
        requireCondition(
          resumed >= now,
          "Clock moved backwards while saving state",
        );
        now = resumed;
      };
      let reviewingSite: string | null = null;
      const core = createSnapHandler({
        now: runtime.now.bind(runtime),
        readState: async () => state.companion,
        writeState: async (companion) => {
          state.companion = companion;
          await persist();
        },
        confirm: async (approval) =>
          runtime.confirm(
            reviewingSite
              ? {
                  ...approval,
                  lines: [
                    `Requesting website: ${reviewingSite}`,
                    ...approval.lines,
                  ],
                }
              : approval,
          ),
      });
      if (!DAPP_METHODS.includes(method) && !COMPANION_METHODS.includes(method))
        return await core(origin, r);
      const broker = state.broker;
      // Only never-signed work expires automatically. Signed/uncertain outcomes are never reset to unsigned.
      for (const intent of broker.intents)
        if (
          ["queued", "claimed", "prepared"].includes(intent.status) &&
          now >= intent.expiresAt
        ) {
          intent.status = "expired";
          intent.updatedAt = now;
        }
      broker.intents = broker.intents.filter(
        (i) =>
          !["cancelled", "expired", "broadcast-reported"].includes(i.status) ||
          now - i.updatedAt < TERMINAL_RETENTION,
      );
      const activeSession = (allowExpired = false): Session => {
        const session = state.companion?.session;
        requireCondition(
          session &&
            now >= session.createdAt &&
            (allowExpired || now < session.expiresAt),
          "Connect the Ledger in the companion first",
          4100,
        );
        return session;
      };
      const companionSession = (
        p: Record<string, unknown>,
        allowExpired = false,
      ) => {
        const session = activeSession(allowExpired);
        requireCondition(
          session.origin === origin &&
            session.sessionId === hash(p.sessionId) &&
            sameChain(session.chain, parseChain(p.chain)),
          "Unauthorized companion session",
          4100,
        );
        return session;
      };
      const findIntent = (id: unknown): DappIntent => {
        const found = broker.intents.find((i) => i.id === hash(id));
        requireCondition(found, "Unknown payment request");
        return found;
      };
      const requireCurrent = (intent: DappIntent, session: Session) => {
        requireCondition(
          intent.sessionId === session.sessionId &&
            sameChain(intent.chain, session.chain),
          "Request belongs to another hardware session",
          4100,
        );
        requireCondition(
          now >= intent.createdAt && now < intent.expiresAt,
          "Website payment request expired",
        );
      };
      const publicGrant = (grant: DappGrant) => ({
        grantId: grant.id,
        address: grant.address,
        chain: grant.chain,
        expiresAt: grant.expiresAt,
        nextSequence: grant.nextSequence,
      });
      if (method === "prl_requestAccounts") {
        const p = object(r.params, ["chain"], "account consent params"),
          chain = parseChain(p.chain),
          session = activeSession();
        requireCondition(
          sameChain(chain, session.chain),
          "Companion has another network selected",
        );
        requireCondition(
          broker.revision < Number.MAX_SAFE_INTEGER,
          "Grant revision exhausted",
        );
        broker.revision++;
        broker.grants = broker.grants.filter((g) => g.origin !== origin);
        await persist();
        const address = deriveAddress(
          accountFromJson(session.account),
          0,
          0,
        ).address;
        const allowed = await runtime.confirm({
          title: "Share one PRL address with this website?",
          lines: [
            origin,
            `Network: ${chain.network}`,
            `Genesis: ${chain.genesisHash}`,
            address,
            "This website receives only this address and can ask you to review payment requests for up to 15 minutes. Your account public key and Ledger connection remain in the companion.",
            "Every payment still needs explicit companion review, Ledger approval, and a separate broadcast action.",
          ],
        });
        requireCondition(allowed === true, "Address consent rejected", 4001);
        now = integer(runtime.now());
        requireCondition(
          now >= startedAt &&
            now - startedAt <= REQUEST_TTL_MS &&
            now < session.expiresAt,
          "Address consent expired",
        );
        const grant: DappGrant = {
          id: identify(
            "prl-dapp-grant/v1",
            origin,
            session.sessionId,
            chain,
            broker.revision,
            now,
          ),
          origin,
          chain,
          sessionId: session.sessionId,
          address,
          createdAt: now,
          expiresAt: session.expiresAt,
          nextSequence: 1,
        };
        broker.grants.push(grant);
        await persist();
        requireCondition(
          now < grant.expiresAt,
          "Address consent expired while saving",
        );
        return publicGrant(grant);
      }
      if (
        method === "prl_getAccounts" ||
        method === "prl_revokeAccounts" ||
        method === "prl_requestPayment"
      ) {
        const extra =
          method === "prl_requestPayment"
            ? ["sequence", "recipient", "amountPrl"]
            : [];
        const p = object(
          r.params,
          ["grantId", "chain", ...extra],
          "website grant params",
        );
        const grant = broker.grants.find(
          (g) => g.origin === origin && g.id === hash(p.grantId),
        );
        requireCondition(
          grant && sameChain(grant.chain, parseChain(p.chain)),
          "No website address consent",
          4100,
        );
        if (method === "prl_revokeAccounts") {
          broker.grants = broker.grants.filter((g) => g !== grant);
          await persist();
          return { revoked: true };
        }
        const session = activeSession();
        requireCondition(
          grant.sessionId === session.sessionId &&
            now >= grant.createdAt &&
            now < grant.expiresAt,
          "Website consent expired; reconnect",
          4100,
        );
        if (method === "prl_getAccounts") return publicGrant(grant);
        const sequence = integer(p.sequence, 100);
        requireCondition(
          sequence === grant.nextSequence,
          "Replayed website payment sequence",
        );
        requireCondition(
          broker.intents.length < MAX_REQUESTS &&
            broker.intents.filter((i) => i.origin === origin).length <
              MAX_PER_ORIGIN,
          "Website payment queue is full",
        );
        const recipient = validAddress(p.recipient, grant.chain),
          amountPrl = amount(p.amountPrl);
        grant.nextSequence++;
        await persist();
        const accepted = await runtime.confirm({
          title: "Queue a website PRL payment for review?",
          lines: [
            origin,
            `Network: ${grant.chain.network}`,
            `Genesis: ${grant.chain.genesisHash}`,
            `Recipient: ${recipient}`,
            `Amount: ${amountPrl} PRL`,
            "No transaction is signed or broadcast. Open the companion and explicitly claim this request, choose inputs and fee, and review it on the Ledger.",
          ],
        });
        requireCondition(
          accepted === true,
          "Website payment request rejected",
          4001,
        );
        now = integer(runtime.now());
        requireCondition(
          now >= startedAt &&
            now - startedAt <= REQUEST_TTL_MS &&
            now < grant.expiresAt,
          "Website payment approval expired",
        );
        const initial = {
          origin,
          companionOrigin: session.origin,
          accountId: identify(session.account),
          chain: grant.chain,
          sessionId: grant.sessionId,
          grantId: grant.id,
          sequence,
          recipient,
          amountPrl,
          createdAt: now,
        };
        const intent: DappIntent = {
          ...initial,
          id: intentId(initial),
          expiresAt: Math.min(now + INTENT_TTL, grant.expiresAt),
          updatedAt: now,
          status: "queued",
          signingRequestId: null,
          bundle: null,
          txid: null,
        };
        broker.intents.push(intent);
        await persist();
        requireCondition(
          now < intent.expiresAt,
          "Website request expired while saving",
        );
        return publicIntent(intent);
      }
      if (method === "prl_getRequest" || method === "prl_cancelRequest") {
        const p = object(r.params, ["id", "chain"], "website request params"),
          intent = findIntent(p.id);
        requireCondition(
          intent.origin === origin &&
            sameChain(intent.chain, parseChain(p.chain)),
          "Request belongs to another origin/network",
          4100,
        );
        if (method === "prl_getRequest") {
          const previous = broker.polls[origin];
          requireCondition(
            previous === undefined ||
              (now >= previous && now - previous >= POLL_INTERVAL),
            "Wait at least one second between status checks",
            -32005,
          );
          broker.polls[origin] = now;
          await persist();
          return publicIntent(intent);
        }
        requireCondition(
          ["queued", "claimed", "prepared"].includes(intent.status),
          "Cannot cancel a signing, signed, completed or terminal request",
        );
        const session = state.companion?.session;
        if (
          intent.signingRequestId &&
          session?.pending?.requestId === intent.signingRequestId
        ) {
          await core(session.origin, {
            method: "prl_cancel",
            params: {
              sessionId: session.sessionId,
              chain: session.chain,
              requestId: intent.signingRequestId,
            },
          });
        }
        intent.status = "cancelled";
        intent.updatedAt = now;
        await persist();
        return publicIntent(intent);
      }
      const extra: Record<string, string[]> = {
        prl_listDappRequests: [],
        prl_claimDappRequest: ["id"],
        prl_rejectDappRequest: ["id"],
        prl_prepareDappTransaction: ["id", "sequence", "bundle"],
        prl_beginDappSigning: ["id", "requestId"],
        prl_recordDappSigned: ["id", "rawTx"],
        prl_reportDappBroadcast: ["id", "txid", "outcome"],
      };
      const p = object(
        r.params,
        ["sessionId", "chain", ...extra[method]!],
        "companion broker params",
      );
      const completing =
        method === "prl_recordDappSigned" ||
        method === "prl_reportDappBroadcast";
      const session = companionSession(p, completing);
      if (method === "prl_listDappRequests") {
        await persist();
        return broker.intents
          .filter(
            (i) =>
              i.companionOrigin === origin &&
              i.accountId === identify(session.account) &&
              sameChain(i.chain, session.chain),
          )
          .map(publicIntent);
      }
      const intent = findIntent(p.id);
      requireCondition(
        intent.companionOrigin === origin &&
          intent.accountId === identify(session.account) &&
          sameChain(intent.chain, session.chain) &&
          (completing || intent.sessionId === session.sessionId),
        "Request belongs to another hardware session",
        4100,
      );
      if (method === "prl_rejectDappRequest") {
        requireCondition(
          ["queued", "claimed", "prepared"].includes(intent.status),
          "Cannot reject signing, signed or terminal work",
        );
        if (
          intent.signingRequestId &&
          session.pending?.requestId === intent.signingRequestId
        )
          await core(origin, {
            method: "prl_cancel",
            params: {
              sessionId: session.sessionId,
              chain: session.chain,
              requestId: intent.signingRequestId,
            },
          });
        intent.status = "cancelled";
        intent.updatedAt = now;
        await persist();
        return publicIntent(intent);
      }
      if (method === "prl_claimDappRequest") {
        requireCurrent(intent, session);
        requireCondition(
          intent.status === "queued",
          "Request is not waiting to be claimed",
        );
        const approved = await runtime.confirm({
          title: "Claim this website payment in the companion?",
          lines: [
            intent.origin,
            `Network: ${intent.chain.network}`,
            `Genesis: ${intent.chain.genesisHash}`,
            `Recipient: ${intent.recipient}`,
            `Amount: ${intent.amountPrl} PRL`,
            "The companion will let you choose inputs and fee. This does not authorize signing or broadcast.",
          ],
        });
        requireCondition(approved === true, "Website claim rejected", 4001);
        now = integer(runtime.now());
        requireCurrent(intent, session);
        intent.status = "claimed";
        intent.updatedAt = now;
        await persist();
        requireCurrent(intent, session);
        return publicIntent(intent);
      }
      if (method === "prl_prepareDappTransaction") {
        requireCurrent(intent, session);
        requireCondition(
          intent.status === "claimed",
          "Claim this request before preparing it",
        );
        const bundle = bundleFromJson(p.bundle);
        assertPaymentMatches(intent, bundle);
        reviewingSite = intent.origin;
        const ticket = (await core(origin, {
          method: "prl_prepareTransaction",
          params: {
            sessionId: session.sessionId,
            chain: session.chain,
            sequence: p.sequence,
            bundle: bundleToJson(bundle),
          },
        })) as { requestId: string };
        now = integer(runtime.now());
        requireCurrent(intent, session);
        intent.status = "prepared";
        intent.updatedAt = now;
        intent.bundle = bundleToJson(bundle);
        intent.signingRequestId = ticket.requestId;
        await persist();
        requireCurrent(intent, session);
        return ticket;
      }
      if (method === "prl_beginDappSigning") {
        requireCurrent(intent, session);
        requireCondition(
          intent.status === "prepared" &&
            intent.signingRequestId === hash(p.requestId),
          "Website signing request changed or cancelled",
        );
        requireCondition(
          session.pending?.requestId === intent.signingRequestId &&
            now >= session.pending.approvedAt &&
            now < session.pending.expiresAt,
          "MetaMask transaction approval expired",
        );
        intent.status = "signing";
        intent.updatedAt = now;
        await persist();
        requireCurrent(intent, session);
        requireCondition(
          now < session.pending.expiresAt,
          "MetaMask transaction approval expired while starting",
        );
        return publicIntent(intent);
      }
      if (method === "prl_recordDappSigned") {
        requireCondition(
          [
            "signing",
            "signed",
            "broadcast-unknown",
            "broadcast-reported",
          ].includes(intent.status) && intent.bundle,
          "Request was not started for signing",
        );
        requireCondition(
          typeof p.rawTx === "string" &&
            p.rawTx.length <= MAX_RPC_BYTES &&
            /^[0-9a-f]+$/.test(p.rawTx),
          "Invalid signed PRL transaction",
        );
        const tx = parseTransaction(p.rawTx),
          bundle = bundleFromJson(intent.bundle);
        const signatures = tx.inputs.map((input) => {
          requireCondition(
            input.witness.length === 1 && input.witness[0]!.length === 64,
            "Unexpected signed witness",
          );
          return input.witness[0]!;
        });
        const finalized = finalizeTransaction(bundle, signatures);
        requireCondition(
          finalized.rawTx === p.rawTx,
          "Signed transaction does not match approved website intent",
        );
        requireCondition(
          intent.txid === null || intent.txid === finalized.txid,
          "Signed transaction identity changed",
        );
        intent.txid = finalized.txid;
        if (intent.status === "signing") intent.status = "signed";
        intent.updatedAt = now;
        await persist();
        return publicIntent(intent);
      }
      requireCondition(
        ["signed", "broadcast-unknown", "broadcast-reported"].includes(
          intent.status,
        ) && intent.txid === hash(p.txid),
        "Broadcast result does not match signed request",
      );
      requireCondition(
        p.outcome === "accepted" || p.outcome === "unknown",
        "Invalid broadcast outcome",
      );
      requireCondition(
        intent.status !== "broadcast-reported" || p.outcome === "accepted",
        "Cannot regress accepted broadcast report",
      );
      intent.status =
        p.outcome === "accepted" ? "broadcast-reported" : "broadcast-unknown";
      intent.updatedAt = now;
      await persist();
      return publicIntent(intent);
    } finally {
      busy = false;
    }
  };
}
