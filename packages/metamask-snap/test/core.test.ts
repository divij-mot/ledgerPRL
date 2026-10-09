import test from "node:test";
import assert from "node:assert/strict";
import { deriveAddress } from "@pearl-ledger/sdk";
import {
  chainFor,
  jsonClone,
  parseState,
  transactionDigest,
} from "../src/core.js";
import { SESSION_TTL_MS, REQUEST_TTL_MS } from "../src/config.js";
import {
  Harness,
  fixture,
  account,
  bundle,
  ORIGIN,
  chain,
  deferred,
} from "./helpers.js";

test("public-only connection and independently verified signed transaction", async () => {
  const h = new Harness();
  const connected = await h.connect();
  assert.match(connected.sessionId, /^[0-9a-f]{64}$/);
  assert.equal(h.approvals.length, 1);
  assert(
    h.approvals[0]!.lines.includes(deriveAddress(account(), 0, 0).address),
  );
  const address = (await h.call("prl_getAddress", {
    ...h.params(),
    branch: 0,
    index: 0,
  })) as any;
  assert.equal(address.address, fixture.addresses.input);
  assert.equal(address.deviceVerified, false);
  const pending = await h.prepare();
  assert.equal(pending.digest, transactionDigest(bundle()));
  assert(h.approvals[1]!.lines.some((s) => s.includes("90071992.54740000")));
  const result = (await h.submit()) as any;
  assert.equal(result.rawTx, fixture.rawTx);
  assert.equal(result.txid, fixture.txid);
  assert.equal(result.vsize, fixture.vsize);
  assert.equal(h.state!.session!.pending, null);
});

test("reject exact-origin lookalikes, other websites, schemes, ports and paths", async () => {
  for (const origin of [
    "https://evil.example",
    "http://127.0.0.1:5173.evil.example",
    "http://127.0.0.1:5173/",
    "http://127.0.0.1:5174",
    "http://localhost:5173/path",
    "http://user@localhost:5173",
    "null",
    "npm:other-snap",
    "https://127.0.0.1:5173",
  ]) {
    const h = new Harness();
    await assert.rejects(h.connect(origin), /Origin/);
    assert.equal(h.writes, 0);
    assert.equal(h.approvals.length, 0);
  }
});

test("session and account cannot cross the two allowlisted companion origins", async () => {
  const h = new Harness();
  await h.connect();
  await assert.rejects(
    h.call("prl_getAccount", h.params(), "http://localhost:5173"),
    /unauthorized/,
  );
  await assert.rejects(
    h.call("prl_getAccount", { ...h.params(), sessionId: "00".repeat(32) }),
    /unauthorized/,
  );
});

test("every request binds full chain and network even same-genesis regtest/simnet", async () => {
  const h = new Harness();
  await h.connect();
  await assert.rejects(
    h.call("prl_getAccount", { ...h.params(), chain: chainFor("simnet") }),
    /chain mismatch/,
  );
  await assert.rejects(
    h.call("prl_getAccount", {
      ...h.params(),
      chain: { ...chain, genesisHash: "00".repeat(32) },
    }),
    /genesis/,
  );
  await assert.rejects(
    h.call("prl_connect", {
      chain: chainFor("mainnet"),
      account: fixture.publicAccount,
      nonce: "a1".repeat(32),
    }),
    /another chain/,
  );
});

test("unknown methods, extra fields, numeric amounts, signing flags and oversized payloads fail", async () => {
  const h = new Harness();
  await h.connect();
  for (const method of [
    "eth_sign",
    "eth_sendTransaction",
    "personal_sign",
    "prl_broadcast",
    "prl_signHash",
    "wallet_requestSnaps",
  ])
    await assert.rejects(h.call(method, h.params()), /Unsupported/);
  await assert.rejects(
    h.call("prl_getAccount", { ...h.params(), origin: ORIGIN }),
    /Unexpected/,
  );
  await assert.rejects(
    h.handler(ORIGIN, {
      method: "prl_getAccount",
      params: h.params(),
      jsonrpc: "1.0",
    }),
    /version/,
  );
  await assert.rejects(
    h.call("prl_getAccount", { spam: "a".repeat(25_000) }),
    /size limit/,
  );
  for (const mutate of [
    (b: any) => (b.inputs[0].amount = 9007199254740993),
    (b: any) => (b.sighash = 1),
    (b: any) => (b.outputs[0].scriptPubKey += "00"),
    (b: any) => (b.inputs[0].sequence = 0),
  ]) {
    const b = jsonClone(fixture.bundle);
    mutate(b);
    await assert.rejects(
      h.call("prl_prepareTransaction", {
        ...h.params(),
        sequence: 1,
        bundle: b,
      }),
    );
  }
  assert.equal(h.state!.session!.nextSequence, 1);
});

test("private or unknown account material rejected without a dialog", async () => {
  for (const key of ["privateKey", "seed", "mnemonic", "xprv", "verified"]) {
    const h = new Harness();
    await assert.rejects(
      h.call("prl_connect", {
        chain,
        account: { ...fixture.publicAccount, [key]: "invalid" },
        nonce: "a1".repeat(32),
      }),
    );
    assert.equal(h.approvals.length, 0);
  }
});

test("rejected connection invalidates old permission and writes no new account", async () => {
  const h = new Harness();
  await h.connect();
  const old = h.params();
  h.approve = false;
  await assert.rejects(h.connect(), /rejected/);
  assert.equal(h.state!.session, null);
  await assert.rejects(h.call("prl_getAccount", old), /unauthorized/);
});

test("session expires, rejects backwards clock, and reconnect creates a new id", async () => {
  const h = new Harness();
  const first = await h.connect();
  h.time--;
  await assert.rejects(h.call("prl_getAccount", h.params()), /expired/);
  h.time += SESSION_TTL_MS + 1;
  await assert.rejects(h.call("prl_getAccount", h.params()), /expired/);
  const second = await h.connect();
  assert.notEqual(second.sessionId, first.sessionId);
});

test("reject transaction mutation, wrong account paths and change substitution", async () => {
  for (const mutate of [
    (b: any) => (b.network = "mainnet"),
    (b: any) => (b.account = 1),
    (b: any) => (b.inputs[0].index = 1),
    (b: any) => (b.outputs[1].scriptPubKey = b.outputs[0].scriptPubKey),
  ]) {
    const h = new Harness();
    await h.connect();
    const changed = jsonClone(fixture.bundle);
    mutate(changed);
    await assert.rejects(
      h.call("prl_prepareTransaction", {
        ...h.params(),
        sequence: 1,
        bundle: changed,
      }),
    );
    assert.equal(h.approvals.length, 1);
  }
});

test("rejected review consumes sequence and does not create signing permission", async () => {
  const h = new Harness();
  await h.connect();
  h.approve = false;
  await assert.rejects(h.prepare(), /rejected/);
  assert.equal(h.state!.session!.pending, null);
  assert.equal(h.state!.session!.nextSequence, 2);
  await assert.rejects(
    h.call("prl_prepareTransaction", {
      ...h.params(),
      sequence: 1,
      bundle: fixture.bundle,
    }),
    /Replayed/,
  );
});

test("only one pending request; cancellation invalidates submission and permits a new sequence", async () => {
  const h = new Harness();
  await h.connect();
  const pending = await h.prepare();
  await assert.rejects(h.prepare(), /pending/);
  await h.call("prl_cancel", { ...h.params(), requestId: pending.requestId });
  await assert.rejects(h.submit(pending as any), /No matching/);
  const second = await h.prepare();
  assert.notEqual(second.requestId, pending.requestId);
  assert.equal(second.sequence, 2);
});

test("one-shot signatures reject replay even after Snap restart", async () => {
  const h = new Harness();
  await h.connect();
  await h.prepare();
  const pending = jsonClone(h.state!.session!.pending!);
  h.restart();
  await h.submit(pending);
  h.restart();
  await assert.rejects(h.submit(pending), /No matching/);
});

test("tampered signatures, digest, and unsupported sighash are consumed and fail closed", async () => {
  for (const altered of [
    "00".repeat(64),
    fixture.signatures[0] + "01",
    fixture.signatures[1],
    "AA".repeat(64),
  ]) {
    const h = new Harness();
    await h.connect();
    await h.prepare();
    const pending = h.state!.session!.pending!;
    await assert.rejects(h.submit(pending, [altered, fixture.signatures[1]]));
    assert.equal(h.state!.session!.pending, null);
    await assert.rejects(h.submit(pending), /No matching/);
  }
  const h = new Harness();
  await h.connect();
  await h.prepare();
  const pending = h.state!.session!.pending!;
  await assert.rejects(
    h.submit({ ...pending, digest: "00".repeat(32) }),
    /digest mismatch/,
  );
  assert.equal(h.state!.session!.pending, null);
});

test("expired and clock-reversed signature submissions cannot finalize", async () => {
  for (const delta of [REQUEST_TTL_MS, -1]) {
    const h = new Harness();
    await h.connect();
    await h.prepare();
    h.time += delta;
    await assert.rejects(h.submit(), /expired/);
  }
});

test("read-time persisted state validation detects account, request, digest, policy and version changes", async () => {
  for (const mutate of [
    (s: any) => (s.schema = 2),
    (s: any) => (s.session.account.account = 1),
    (s: any) => (s.session.pending.digest = "00".repeat(32)),
    (s: any) => (s.session.pending.requestId = "00".repeat(32)),
    (s: any) => (s.session.pending.sequence = 7),
    (s: any) => (s.session.pending.expiresAt += 1),
    (s: any) => (s.session.origin = "https://evil.example"),
  ]) {
    const h = new Harness();
    await h.connect();
    await h.prepare();
    mutate(h.state);
    h.restart();
    await assert.rejects(h.call("prl_getAccount", h.params()));
  }
  assert.throws(() =>
    parseState({ schema: 1, revision: 0, session: null, extra: true }),
  );
});

test("concurrent RPC rejects instead of opening duplicate confirmation or overwriting state", async () => {
  const h = new Harness(),
    dialog = deferred<boolean>(),
    opened = deferred<void>();
  h.dialog = async () => {
    opened.resolve();
    return dialog.promise;
  };
  const first = h.connect();
  await opened.promise;
  await assert.rejects(h.connect(), /active/);
  assert.equal(h.approvals.length, 1);
  dialog.resolve(true);
  await first;
});

test("storage failures before approval or finalization do not release an approval or transaction", async () => {
  const h = new Harness();
  h.failWriteAt = 1;
  await assert.rejects(h.connect(), /Storage/);
  assert.equal(h.approvals.length, 0);
  h.failWriteAt = -1;
  await h.connect();
  h.failWriteAt = h.writes + 2;
  await assert.rejects(h.prepare(), /Storage/);
  assert.equal(h.state!.session!.pending, null);
  h.failWriteAt = -1;
  await h.prepare();
  h.failWriteAt = h.writes + 1;
  await assert.rejects(h.submit(), /Storage/);
});

test("restart during transaction review retains only consumed sequence, never unsigned authorization", async () => {
  const h = new Harness();
  await h.connect();
  const dialog = deferred<boolean>(),
    opened = deferred<void>();
  h.dialog = async () => {
    opened.resolve();
    return dialog.promise;
  };
  const pending = h.prepare();
  await opened.promise;
  assert.equal(h.state!.session!.pending, null);
  assert.equal(h.state!.session!.nextSequence, 2);
  dialog.resolve(false);
  await assert.rejects(pending, /rejected/);
  h.restart();
  assert.equal(
    ((await h.call("prl_getAccount", h.params())) as any).nextSequence,
    2,
  );
});

test("an approval taking longer than the request window is rejected", async () => {
  const h = new Harness();
  await h.connect();
  h.dialog = async () => {
    h.time += REQUEST_TTL_MS + 1;
    return true;
  };
  await assert.rejects(h.prepare(), /expired/);
  assert.equal(h.state!.session!.pending, null);
});

test("delayed storage reads cannot bypass session or pending approval expiry", async () => {
  for (const drift of [REQUEST_TTL_MS + 1, SESSION_TTL_MS + 1, -1]) {
    const h = new Harness();
    await h.connect();
    await h.prepare();
    const original = h.readState.bind(h);
    h.readState = async () => {
      h.time += drift;
      return original();
    };
    await assert.rejects(h.submit(), /expired|backwards/);
  }
});

test("delayed consume writes cannot release signatures outside the approved window", async () => {
  for (const drift of [REQUEST_TTL_MS + 1, -1]) {
    const h = new Harness();
    await h.connect();
    await h.prepare();
    const original = h.writeState.bind(h);
    h.writeState = async (state) => {
      await original(state);
      h.time += drift;
    };
    await assert.rejects(h.submit(), /expired/);
    assert.equal(h.state!.session!.pending, null);
  }
});

test("delayed approval persistence cannot release an expired signing ticket", async () => {
  const h = new Harness();
  await h.connect();
  const original = h.writeState.bind(h);
  h.writeState = async (state) => {
    await original(state);
    if (state.session?.pending) h.time += REQUEST_TTL_MS + 1;
  };
  await assert.rejects(h.prepare(), /expired/);
});

test("Snap offline address derivation stays within supported companion recovery coverage", async () => {
  const h = new Harness();
  await h.connect();
  await h.call("prl_getAddress", { ...h.params(), branch: 0, index: 999 });
  await assert.rejects(
    h.call("prl_getAddress", { ...h.params(), branch: 0, index: 1000 }),
    /bounded/,
  );
});
