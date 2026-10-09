import test from "node:test";
import assert from "node:assert/strict";
import {
  accountFromJson,
  deriveAddress,
  fromHex,
  finalizeTransaction,
} from "@pearl-ledger/sdk";
import {
  createSnapController,
  parseControllerState,
  type ControllerState,
  type PublicDappRequest,
} from "../src/broker.js";
import {
  PrlSnapCompanion,
  PrlDappProvider,
  type MetaMaskProvider,
} from "../src/provider.js";
import {
  chainFor,
  jsonClone,
  type Approval,
  type SavedState,
} from "../src/core.js";
import {
  bundle,
  fixture,
  ORIGIN,
  chain,
  deferred,
  Harness,
} from "./helpers.js";
const SITE = "http://127.0.0.1:4173";
class BrokerHarness {
  state: ControllerState | SavedState | null = null;
  time = Date.now();
  approve = true;
  dialogs: Approval[] = [];
  afterWrite?: () => void;
  runtime = {
    now: () => this.time,
    readState: async () => jsonClone(this.state),
    writeState: async (s: SavedState) => {
      this.state = jsonClone(s);
      this.afterWrite?.();
    },
    confirm: async (a: Approval) => {
      this.dialogs.push(a);
      return this.approve;
    },
  };
  handler = createSnapController(this.runtime);
  call(origin: string, method: string, params: unknown): Promise<any> {
    return this.handler(origin, { method, params });
  }
  async connect() {
    return this.call(ORIGIN, "prl_connect", {
      chain,
      account: fixture.publicAccount,
      nonce: "ab".repeat(32),
    });
  }
  params() {
    return {
      sessionId: (this.state as ControllerState).companion!.session!.sessionId,
      chain,
    };
  }
  async consent() {
    return this.call(SITE, "prl_requestAccounts", { chain });
  }
  async queue() {
    const grant = (this.state as ControllerState).broker.grants[0]!;
    return this.call(SITE, "prl_requestPayment", {
      grantId: grant.id,
      chain,
      sequence: grant.nextSequence,
      recipient: fixture.addresses.recipient,
      amountPrl: "90071992.54740000",
    });
  }
  async setup() {
    await this.connect();
    await this.consent();
    return this.queue();
  }
  async prepare(id: string) {
    await this.call(ORIGIN, "prl_claimDappRequest", { ...this.params(), id });
    return this.call(ORIGIN, "prl_prepareDappTransaction", {
      ...this.params(),
      id,
      sequence: (this.state as ControllerState).companion!.session!
        .nextSequence,
      bundle: fixture.bundle,
    });
  }
  async begin(id: string) {
    const ticket = await this.prepare(id);
    await this.call(ORIGIN, "prl_beginDappSigning", {
      ...this.params(),
      id,
      requestId: ticket.requestId,
    });
    return ticket;
  }
  async record(id: string) {
    return this.call(ORIGIN, "prl_recordDappSigned", {
      ...this.params(),
      id,
      rawTx: fixture.rawTx,
    });
  }
  restart() {
    this.handler = createSnapController(this.runtime);
  }
}
function noPrivateState(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const key of [
    "sessionId",
    "accountId",
    "account",
    "publicKey",
    "chainCode",
    "bundle",
    "signatures",
    "rawTx",
    "signingRequestId",
  ])
    assert(!serialized.includes(`"${key}"`), key);
}

test("website broker full flow keeps xpub/session/signatures private and separates broadcast", async () => {
  const h = new BrokerHarness();
  await h.connect();
  const grant = await h.consent();
  noPrivateState(grant);
  const request = await h.queue();
  noPrivateState(request);
  assert.equal(request.status, "queued");
  const ticket = await h.begin(request.id);
  assert(ticket.requestId);
  const signed = await h.record(request.id);
  assert.equal(signed.status, "signed");
  assert.equal(signed.txid, fixture.txid);
  assert.equal(signed.broadcast, "not-reported");
  const status = await h.call(SITE, "prl_getRequest", {
    id: request.id,
    chain,
  });
  noPrivateState(status);
  const reported = await h.call(ORIGIN, "prl_reportDappBroadcast", {
    ...h.params(),
    id: request.id,
    txid: fixture.txid,
    outcome: "accepted",
  });
  assert.equal(reported.status, "broadcast-reported");
  assert.equal(reported.broadcast, "companion-reported-accepted");
  assert(h.dialogs.at(-1)!.lines.includes(`Requesting website: ${SITE}`));
});

test("actual RPC origin controls website versus companion capabilities regardless of known identifiers", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  for (const method of [
    "prl_connect",
    "prl_getAccount",
    "prl_getAddress",
    "prl_prepareTransaction",
    "prl_submitSignatures",
    "prl_listDappRequests",
    "prl_claimDappRequest",
    "prl_prepareDappTransaction",
    "prl_beginDappSigning",
    "prl_recordDappSigned",
    "prl_reportDappBroadcast",
    "prl_rejectDappRequest",
  ])
    await assert.rejects(
      h.call(SITE, method, { ...h.params(), id: intent.id }),
      /Origin/,
    );
  for (const method of [
    "prl_requestAccounts",
    "prl_requestPayment",
    "prl_getRequest",
    "prl_cancelRequest",
    "prl_revokeAccounts",
  ])
    await assert.rejects(h.call(ORIGIN, method, {}), /origin/);
  await assert.rejects(
    h.call("http://localhost:4173", "prl_getRequest", { id: intent.id, chain }),
    /Origin/,
  );
});

test("site account request requires connected Ledger public account and exact full chain", async () => {
  const h = new BrokerHarness();
  await assert.rejects(h.consent(), /Connect/);
  await h.connect();
  await assert.rejects(
    h.call(SITE, "prl_requestAccounts", { chain: chainFor("simnet") }),
    /another network/,
  );
  h.approve = false;
  await assert.rejects(h.consent(), /rejected/);
  assert.equal((h.state as ControllerState).broker.grants.length, 0);
});

test("consent and queue schema reject unknown fields, floats, unsupported addresses, and replay", async () => {
  const h = new BrokerHarness();
  await h.connect();
  const grant = await h.consent();
  const params = {
    grantId: grant.grantId,
    chain,
    sequence: 1,
    recipient: fixture.addresses.recipient,
    amountPrl: "90071992.54740000",
  };
  for (const extra of [
    { origin: SITE },
    { amountPrl: 1 },
    { recipient: fixture.addresses.recipient.toUpperCase() },
    { chain: chainFor("simnet") },
    { sequence: 0 },
  ])
    await assert.rejects(
      h.call(SITE, "prl_requestPayment", { ...params, ...extra }),
    );
  await h.queue();
  await assert.rejects(h.call(SITE, "prl_requestPayment", params), /Replayed/);
  await assert.rejects(
    h.call(SITE, "prl_getAccounts", { grantId: "00".repeat(32), chain }),
    /consent/,
  );
});

test("claimed payment cannot substitute recipient, amount, or network", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await h.call(ORIGIN, "prl_claimDappRequest", {
    ...h.params(),
    id: intent.id,
  });
  for (const mutate of [
    (b: any) => (b.outputs[0].amount = "9007199254739999"),
    (b: any) => (b.outputs[0].scriptPubKey = b.outputs[1].scriptPubKey),
    (b: any) => (b.network = "simnet"),
  ]) {
    const changed = jsonClone(fixture.bundle);
    mutate(changed);
    await assert.rejects(
      h.call(ORIGIN, "prl_prepareDappTransaction", {
        ...h.params(),
        id: intent.id,
        sequence: 1,
        bundle: changed,
      }),
      /does not match/,
    );
  }
  assert.equal(
    (h.state as ControllerState).companion!.session!.nextSequence,
    1,
  );
});

test("site cancellation before signing invalidates corresponding hardware approval", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup(),
    ticket = await h.prepare(intent.id);
  const cancelled = await h.call(SITE, "prl_cancelRequest", {
    id: intent.id,
    chain,
  });
  assert.equal(cancelled.status, "cancelled");
  assert.equal((h.state as ControllerState).companion!.session!.pending, null);
  await assert.rejects(
    h.call(ORIGIN, "prl_beginDappSigning", {
      ...h.params(),
      id: intent.id,
      requestId: ticket.requestId,
    }),
    /changed or cancelled/,
  );
});

test("site cannot cancel or erase any signing/signed outcome and status does not imply broadcast", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await h.begin(intent.id);
  await assert.rejects(
    h.call(SITE, "prl_cancelRequest", { id: intent.id, chain }),
    /Cannot cancel/,
  );
  h.time += 20 * 60_000;
  h.restart();
  await h.record(intent.id);
  const signed = await h.call(SITE, "prl_getRequest", { id: intent.id, chain });
  assert.equal(signed.status, "signed");
  assert.equal(signed.broadcast, "not-reported");
  await assert.rejects(
    h.call(SITE, "prl_cancelRequest", { id: intent.id, chain }),
    /Cannot cancel/,
  );
});

test("identical-account reconnect can recover completed signing but cannot reactivate unsigned request", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await h.begin(intent.id);
  const old = h.params();
  await h.connect();
  assert.notEqual(h.params().sessionId, old.sessionId);
  const listed = await h.call(ORIGIN, "prl_listDappRequests", h.params());
  assert.equal(listed[0].id, intent.id);
  assert.equal((await h.record(intent.id)).status, "signed");
  await assert.rejects(
    h.call(ORIGIN, "prl_claimDappRequest", { ...h.params(), id: intent.id }),
    /another hardware session/,
  );
});

test("completion recovery rejects another account and another companion origin", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await h.begin(intent.id);
  await h.call(ORIGIN, "prl_connect", {
    chain,
    account: { ...fixture.publicAccount, account: 1 },
    nonce: "ac".repeat(32),
  });
  await assert.rejects(h.record(intent.id), /another hardware session/);
  await h.call("http://localhost:5173", "prl_connect", {
    chain,
    account: fixture.publicAccount,
    nonce: "ac".repeat(32),
  });
  await assert.rejects(
    h.call("http://localhost:5173", "prl_recordDappSigned", {
      ...h.params(),
      id: intent.id,
      rawTx: fixture.rawTx,
    }),
    /another hardware session/,
  );
});

test("unsigned queue expires, status polling is bounded, and cancellation replay is terminal", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await h.call(SITE, "prl_getRequest", { id: intent.id, chain });
  await assert.rejects(
    h.call(SITE, "prl_getRequest", { id: intent.id, chain }),
    /one second/,
  );
  h.time += 10 * 60_000;
  h.restart();
  const expired = await h.call(SITE, "prl_getRequest", {
    id: intent.id,
    chain,
  });
  assert.equal(expired.status, "expired");
  await assert.rejects(
    h.call(SITE, "prl_cancelRequest", { id: intent.id, chain }),
    /Cannot cancel/,
  );
});

test("queue is bounded and consumed request sequence survives rejection/restart", async () => {
  const h = new BrokerHarness();
  await h.connect();
  await h.consent();
  h.approve = false;
  await assert.rejects(h.queue(), /rejected/);
  assert.equal((h.state as ControllerState).broker.grants[0]!.nextSequence, 2);
  h.restart();
  h.approve = true;
  for (let i = 0; i < 4; i++) await h.queue();
  await assert.rejects(h.queue(), /full/);
  assert.equal((h.state as ControllerState).broker.intents.length, 4);
});

test("tampered saved immutable intent is rejected and no unreviewed raw transaction is accepted", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await assert.rejects(h.record(intent.id), /not started/);
  await h.begin(intent.id);
  await assert.rejects(
    h.call(ORIGIN, "prl_recordDappSigned", {
      ...h.params(),
      id: intent.id,
      rawTx: fixture.rawTx.replace("0baf", "0baa"),
    }),
  );
  const copied = jsonClone(h.state) as ControllerState;
  copied.broker.intents[0]!.amountPrl = "1";
  assert.throws(() => parseControllerState(copied), /identity changed/);
});

test("accepted broadcast report is monotonic and never inferred from txid alone", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup();
  await h.begin(intent.id);
  await assert.rejects(
    h.call(ORIGIN, "prl_reportDappBroadcast", {
      ...h.params(),
      id: intent.id,
      txid: fixture.txid,
      outcome: "accepted",
    }),
    /signed request/,
  );
  await h.record(intent.id);
  const unknown = await h.call(ORIGIN, "prl_reportDappBroadcast", {
    ...h.params(),
    id: intent.id,
    txid: fixture.txid,
    outcome: "unknown",
  });
  assert.equal(unknown.broadcast, "unknown");
  await h.call(ORIGIN, "prl_reportDappBroadcast", {
    ...h.params(),
    id: intent.id,
    txid: fixture.txid,
    outcome: "accepted",
  });
  await assert.rejects(
    h.call(ORIGIN, "prl_reportDappBroadcast", {
      ...h.params(),
      id: intent.id,
      txid: fixture.txid,
      outcome: "unknown",
    }),
    /regress/,
  );
});

test("legacy core migration discards old session and pending approval; new connection works", async () => {
  const old = new Harness();
  await old.connect();
  await old.prepare();
  const h = new BrokerHarness();
  h.state = old.state;
  await assert.rejects(
    h.call(ORIGIN, "prl_getAccount", old.params()),
    /unauthorized/,
  );
  await h.connect();
  assert.equal((h.state as unknown as ControllerState).schema, 2);
  assert.equal(parseControllerState(h.state).companion!.session!.pending, null);
});

test("delayed begin persistence cannot authorize expired hardware signing", async () => {
  const h = new BrokerHarness();
  const intent = await h.setup(),
    ticket = await h.prepare(intent.id);
  h.afterWrite = () => {
    h.time += 11 * 60_000;
  };
  await assert.rejects(
    h.call(ORIGIN, "prl_beginDappSigning", {
      ...h.params(),
      id: intent.id,
      requestId: ticket.requestId,
    }),
    /expired/,
  );
});

test("real provider classes exercise site queue, companion claim, durable signing, and reporting", async () => {
  const h = new BrokerHarness();
  const persisted: string[] = [];
  const provider = (origin: string): MetaMaskProvider => ({
    request: async (request) => {
      if (request.method === "wallet_requestSnaps") return {};
      const p = request.params as any;
      return h.handler(origin, p.request);
    },
  });
  const companion = new PrlSnapCompanion({
    ethereum: provider(ORIGIN),
    origin: ORIGIN,
    hardware: {
      exportAccount: async () => accountFromJson(fixture.publicAccount),
      verifyAddress: async (a, b, i) => deriveAddress(a, b, i).address,
      signTransaction: async (b, _a, options) => {
        const signatures = fixture.signatures.map(fromHex);
        await options?.onVerifiedSigned?.(finalizeTransaction(b, signatures));
        return signatures;
      },
    },
    beforeAddressDisplay: async () => {},
    validateBeforeHardware: async () => {},
    onVerifiedSigned: async (tx, context) => {
      assert(context.dappIntentId);
      persisted.push(tx.rawTx);
    },
  });
  const site = new PrlDappProvider(provider(SITE));
  await companion.connect("regtest", 0);
  await site.requestAccounts("regtest");
  const queued = await site.requestPayment(
    fixture.addresses.recipient,
    "90071992.54740000",
  );
  assert.equal((await companion.listDappRequests())[0]!.id, queued.id);
  await companion.claimDappRequest(queued.id);
  const ticket = await companion.prepareDappTransaction(queued.id, bundle());
  const signed = await companion.signPreparedTransaction(ticket);
  assert.equal(signed.snapVerification, "verified");
  assert.deepEqual(persisted, [fixture.rawTx]);
  assert.equal((await site.getRequest(queued.id, "regtest")).status, "signed");
  await companion.reportDappBroadcast(queued.id, signed.txid, "accepted");
  h.time += 1000;
  const status = await site.getRequest(queued.id, "regtest");
  assert.equal(status.broadcast, "companion-reported-accepted");
  noPrivateState(status);
});

test("clock rollback between grant/signing and completion never writes corrupt recovery state", async () => {
  const h = new BrokerHarness();
  await h.connect();
  h.time += 100;
  await h.consent();
  const intent = await h.queue();
  await h.begin(intent.id);
  const before = jsonClone(h.state);
  h.time -= 50;
  await assert.rejects(h.record(intent.id), /backwards/);
  assert.deepEqual(h.state, before);
  h.time += 100;
  assert.equal((await h.record(intent.id)).status, "signed");
  h.restart();
  assert.equal(
    (await h.call(SITE, "prl_getRequest", { id: intent.id, chain })).status,
    "signed",
  );
});

test("delayed website signing claim cannot bypass expiry or stale live preflight", async () => {
  const h = new BrokerHarness(),
    previousNow = Date.now;
  Date.now = () => h.time;
  let hardwareCalls = 0,
    preflightCalls = 0,
    delayBegin = false;
  const provider = (origin: string): MetaMaskProvider => ({
    request: async (request) => {
      if (request.method === "wallet_requestSnaps") return {};
      const p = request.params as any,
        result = await h.handler(origin, p.request);
      if (p.request.method === "prl_beginDappSigning" && delayBegin)
        h.time += 180_001;
      return result;
    },
  });
  try {
    const companion = new PrlSnapCompanion({
      ethereum: provider(ORIGIN),
      origin: ORIGIN,
      hardware: {
        exportAccount: async () => accountFromJson(fixture.publicAccount),
        verifyAddress: async (a, b, i) => deriveAddress(a, b, i).address,
        signTransaction: async () => {
          hardwareCalls++;
          return fixture.signatures.map(fromHex);
        },
      },
      beforeAddressDisplay: async () => {},
      validateBeforeHardware: async () => {
        preflightCalls++;
      },
      onVerifiedSigned: async () => {},
    });
    const site = new PrlDappProvider(provider(SITE));
    await companion.connect("regtest", 0);
    await site.requestAccounts("regtest");
    const intent = await site.requestPayment(
      fixture.addresses.recipient,
      "90071992.54740000",
    );
    await companion.claimDappRequest(intent.id);
    const ticket = await companion.prepareDappTransaction(intent.id, bundle());
    delayBegin = true;
    await assert.rejects(
      companion.signPreparedTransaction(ticket),
      /expired after website claim/,
    );
    assert.equal(hardwareCalls, 0);
    assert.equal(preflightCalls, 0);
  } finally {
    Date.now = previousNow;
  }
});
