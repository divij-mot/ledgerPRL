import test from "node:test";
import assert from "node:assert/strict";
import {
  accountToJson,
  deriveAddress,
  fromHex,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import {
  PrlSnapCompanion,
  PrlSignedPersistenceError,
  type MetaMaskProvider,
  type PrlHardwareSigner,
  LOCAL_SNAP_ID,
} from "../src/provider.js";
import { jsonClone } from "../src/core.js";
import {
  Harness,
  fixture,
  account,
  bundle,
  ORIGIN,
  deferred,
} from "./helpers.js";
function setup() {
  const snap = new Harness();
  const counts = { export: 0, address: 0, sign: 0, validate: 0 };
  const calls: { method: string; params?: unknown }[] = [];
  const displayedPaths: number[] = [];
  const persisted: { rawTx: string; txid: string }[] = [];
  let persist = async (tx: { rawTx: string; txid: string }) => {
    persisted.push({ rawTx: tx.rawTx, txid: tx.txid });
  };
  const ethereum: MetaMaskProvider = {
    request: async (request) => {
      calls.push(request);
      if (request.method === "wallet_requestSnaps")
        return { [LOCAL_SNAP_ID]: { id: LOCAL_SNAP_ID } };
      assert.equal(request.method, "wallet_invokeSnap");
      const params = request.params as any;
      assert.equal(params.snapId, LOCAL_SNAP_ID);
      return snap.handler(ORIGIN, params.request);
    },
  };
  const hardware: PrlHardwareSigner = {
    exportAccount: async () => {
      counts.export++;
      return account();
    },
    verifyAddress: async (a, branch, index) => {
      counts.address++;
      return deriveAddress(a, branch, index).address;
    },
    signTransaction: async () => {
      counts.sign++;
      return fixture.signatures.map(fromHex);
    },
  };
  let validate = async (_bundle: SigningBundle) => {
    counts.validate++;
  };
  const companion = new PrlSnapCompanion({
    ethereum,
    hardware,
    origin: ORIGIN,
    validateBeforeHardware: async (b) => validate(b),
    onVerifiedSigned: async (tx) => persist(tx),
    beforeAddressDisplay: async (_a, _branch, index) => {
      displayedPaths.push(index);
    },
  });
  return {
    snap,
    counts,
    calls,
    ethereum,
    hardware,
    companion,
    persisted,
    displayedPaths,
    setPersistence: (fn: typeof persist) => {
      persist = fn;
    },
    setValidation: (fn: typeof validate) => {
      validate = fn;
    },
  };
}

test("supported provider flow exports/display-checks account and requires separate review/sign calls", async () => {
  const h = setup();
  await h.companion.requestSnapInstallation();
  assert.equal(h.counts.export, 0);
  const connected = await h.companion.connect("regtest", 0);
  assert.deepEqual(connected.account, accountToJson(account()));
  assert.equal(h.counts.address, 1);
  assert.equal(await h.companion.verifyAddress(0, 7), fixture.addresses.second);
  const ticket = await h.companion.prepareTransaction(bundle());
  assert.equal(h.counts.sign, 0);
  assert.equal(h.counts.validate, 0);
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.rawTx, fixture.rawTx);
  assert.equal(h.counts.validate, 1);
  assert.equal(h.counts.sign, 1);
  await assert.rejects(h.companion.signPreparedTransaction(ticket), /Unknown/);
  assert(
    h.calls.every((c) =>
      ["wallet_requestSnaps", "wallet_invokeSnap"].includes(c.method),
    ),
  );
});

test("wrong hardware network/account/display aborts before exposing anything to Snap", async () => {
  for (const mutate of [
    (h: ReturnType<typeof setup>) =>
      (h.hardware.exportAccount = async () => ({
        ...account(),
        network: "mainnet",
      })),
    (h: ReturnType<typeof setup>) =>
      (h.hardware.exportAccount = async () => ({ ...account(), account: 1 })),
    (h: ReturnType<typeof setup>) =>
      (h.hardware.verifyAddress = async () => fixture.addresses.recipient),
  ]) {
    const h = setup();
    mutate(h);
    await assert.rejects(
      h.companion.connect("regtest", 0),
      /wrong account|differs/,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(h.snap.approvals.length, 0);
  }
});

test("node policy callback rejects before Ledger signing and clears the Snap request", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  h.setValidation(async () => {
    throw new Error("Fresh chain validation required");
  });
  await assert.rejects(
    h.companion.signPreparedTransaction(ticket),
    /Fresh chain/,
  );
  assert.equal(h.counts.sign, 0);
  assert.equal(h.snap.state!.session!.pending, null);
  await assert.rejects(h.companion.signPreparedTransaction(ticket), /Unknown/);
});

test("signatures fail independent verification before being forwarded to Snap", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  h.hardware.signTransaction = async () => [
    new Uint8Array(64),
    new Uint8Array(64),
  ];
  await assert.rejects(
    h.companion.signPreparedTransaction(ticket),
    /Invalid signature/,
  );
  assert(
    !h.calls.some(
      (c) => (c.params as any)?.request.method === "prl_submitSignatures",
    ),
  );
  assert.equal(h.snap.state!.session!.pending, null);
});

test("caller mutation after review cannot change transaction sent to device", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const proposed = bundle(),
    original = jsonClone(fixture.bundle);
  const ticket = await h.companion.prepareTransaction(proposed);
  proposed.outputs[0]!.amount = 123n;
  proposed.inputs[0]!.scriptPubKey.fill(0);
  h.hardware.signTransaction = async (b) => {
    assert.equal(b.outputs[0]!.amount.toString(), original.outputs[0].amount);
    assert.equal(
      Buffer.from(b.inputs[0]!.scriptPubKey).toString("hex"),
      original.inputs[0].scriptPubKey,
    );
    return fixture.signatures.map(fromHex);
  };
  assert.equal(
    (await h.companion.signPreparedTransaction(ticket)).txid,
    fixture.txid,
  );
});

test("validation callback mutation cannot change the hardware snapshot", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  h.setValidation(async (b) => {
    b.outputs[0]!.amount = 3n;
    b.inputs[0]!.scriptPubKey.fill(0);
  });
  assert.equal(
    (await h.companion.signPreparedTransaction(ticket)).txid,
    fixture.txid,
  );
});

test("mutated tickets are rejected before validation/device access", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  for (const field of [
    "requestId",
    "digest",
    "sequence",
    "expiresAt",
  ] as const) {
    const altered: any = { ...ticket };
    altered[field] =
      typeof altered[field] === "number" ? altered[field] + 1 : "00".repeat(32);
    await assert.rejects(
      h.companion.signPreparedTransaction(altered),
      /changed/,
    );
  }
  assert.equal(h.counts.sign, 0);
  assert.equal(h.counts.validate, 0);
  await h.companion.cancelPreparedTransaction();
  assert.equal(h.snap.state!.session!.pending, null);
});

test("ticket mutation while awaiting validation does not change its immutable binding", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const pause = deferred<void>(),
    entered = deferred<void>();
  h.setValidation(async () => {
    entered.resolve();
    await pause.promise;
  });
  const signing = h.companion.signPreparedTransaction(ticket);
  await entered.promise;
  ticket.digest = "00".repeat(32);
  ticket.requestId = "00".repeat(32);
  ticket.expiresAt = Number.MAX_SAFE_INTEGER;
  pause.resolve();
  assert.equal((await signing).txid, fixture.txid);
});

test("disconnect during preflight makes further hardware signing impossible", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const pause = deferred<void>(),
    entered = deferred<void>();
  h.setValidation(async () => {
    entered.resolve();
    await pause.promise;
  });
  const signing = h.companion.signPreparedTransaction(ticket);
  await entered.promise;
  await h.companion.disconnect();
  pause.resolve();
  await assert.rejects(signing, /disconnected/);
  assert.equal(h.counts.sign, 0);
  assert.equal(h.snap.state!.session, null);
});

test("abort during hardware review durably preserves valid signatures and cancels pending request", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const abort = new AbortController();
  h.hardware.signTransaction = async () => {
    abort.abort();
    return fixture.signatures.map(fromHex);
  };
  const result = await h.companion.signPreparedTransaction(
    ticket,
    abort.signal,
  );
  assert.equal(result.snapVerification, "not-confirmed");
  assert.equal(result.rawTx, fixture.rawTx);
  assert.deepEqual(h.persisted, [{ rawTx: fixture.rawTx, txid: fixture.txid }]);
  assert.equal(h.snap.state!.session!.pending, null);
  assert(
    !h.calls.some(
      (c) => (c.params as any)?.request.method === "prl_submitSignatures",
    ),
  );
});

test("overlapping UI calls are rejected and do not open second device operation", async () => {
  const h = setup(),
    pause = deferred<void>(),
    entered = deferred<void>();
  h.hardware.exportAccount = async () => {
    entered.resolve();
    await pause.promise;
    return account();
  };
  const connecting = h.companion.connect("regtest", 0);
  await entered.promise;
  await assert.rejects(h.companion.connect("regtest", 0), /active/);
  pause.resolve();
  await connecting;
});

test("Snap response tampering is caught independently without broadcasting", async () => {
  const h = setup();
  const original = h.ethereum.request.bind(h.ethereum);
  h.ethereum.request = async (args) => {
    const value = (await original(args)) as any;
    if ((args.params as any)?.request.method === "prl_submitSignatures")
      return { ...value, txid: "00".repeat(32) };
    return value;
  };
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.snapVerification, "not-confirmed");
  assert.match(result.snapError!, /differs/);
  assert.deepEqual(h.persisted, [{ rawTx: fixture.rawTx, txid: fixture.txid }]);
  assert.equal(h.snap.state!.session!.pending, null);
});

test("durable persistence precedes MetaMask signature verification and survives its network error", async () => {
  const h = setup(),
    original = h.ethereum.request.bind(h.ethereum);
  h.ethereum.request = async (args) => {
    if ((args.params as any)?.request.method === "prl_submitSignatures") {
      assert.deepEqual(h.persisted, [
        { rawTx: fixture.rawTx, txid: fixture.txid },
      ]);
      throw new Error("MetaMask disconnected");
    }
    return original(args);
  };
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.snapVerification, "not-confirmed");
  assert.equal(result.txid, fixture.txid);
  assert.match(result.snapError!, /disconnected/);
});

test("persistence error carries verified transaction and immutable recovery context", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  h.setPersistence(async () => {
    throw new Error("IndexedDB unavailable");
  });
  await assert.rejects(
    h.companion.signPreparedTransaction(ticket),
    (error: unknown) => {
      assert(error instanceof PrlSignedPersistenceError);
      assert.equal(error.transaction.rawTx, fixture.rawTx);
      assert.equal(error.transaction.txid, fixture.txid);
      assert.equal(error.context.request.requestId, ticket.requestId);
      return true;
    },
  );
  assert(
    !h.calls.some(
      (c) => (c.params as any)?.request.method === "prl_submitSignatures",
    ),
  );
  await assert.rejects(h.companion.signPreparedTransaction(ticket), /Unknown/);
});

test("disconnect after hardware signs still preserves signed recovery data", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  h.hardware.signTransaction = async () => {
    await h.companion.disconnect();
    return fixture.signatures.map(fromHex);
  };
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.snapVerification, "not-confirmed");
  assert.equal(result.txid, fixture.txid);
  assert.deepEqual(h.persisted, [{ rawTx: fixture.rawTx, txid: fixture.txid }]);
});

test("same-genesis alternate network in Snap account status is rejected before hardware", async () => {
  const h = setup(),
    original = h.ethereum.request.bind(h.ethereum);
  h.ethereum.request = async (args) => {
    const result = (await original(args)) as any;
    if ((args.params as any)?.request.method === "prl_getAccount")
      result.chain.network = "simnet";
    return result;
  };
  await h.companion.connect("regtest", 0);
  await assert.rejects(h.companion.prepareTransaction(bundle()), /changed/);
  assert.equal(h.counts.sign, 0);
});

test("same-genesis alternate network in signed Snap result is flagged with durable recovery", async () => {
  const h = setup(),
    original = h.ethereum.request.bind(h.ethereum);
  h.ethereum.request = async (args) => {
    const result = (await original(args)) as any;
    if ((args.params as any)?.request.method === "prl_submitSignatures")
      result.chain.network = "simnet";
    return result;
  };
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.snapVerification, "not-confirmed");
  assert.match(result.snapError!, /differs/);
  assert.equal(h.persisted[0]!.txid, fixture.txid);
});

test("hardware address display occurs only after recovery metadata hook and rejects unscannable index", async () => {
  const h = setup();
  h.hardware.verifyAddress = async (a, branch, index) => {
    assert.equal(h.displayedPaths.at(-1), index);
    return deriveAddress(a, branch, index).address;
  };
  await h.companion.connect("regtest", 0);
  await h.companion.verifyAddress(0, 999);
  await assert.rejects(h.companion.verifyAddress(0, 1000), /bounded/);
  assert.deepEqual(h.displayedPaths, [0, 999]);
});

test("lower-layer complete-signature callback persists before final ACK and deduplicates return", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const { finalizeTransaction } = await import("@pearl-ledger/sdk");
  h.hardware.signTransaction = async (b, _a, options) => {
    const signatures = fixture.signatures.map(fromHex);
    await options!.onVerifiedSigned!(finalizeTransaction(b, signatures));
    assert.equal(h.persisted.length, 1);
    await options!.onVerifiedSigned!(finalizeTransaction(b, signatures));
    assert.equal(h.persisted.length, 1);
    return signatures;
  };
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.snapVerification, "verified");
  assert.equal(h.persisted.length, 1);
});

test("lost final ACK after signature callback returns durable verified recovery", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const { finalizeTransaction } = await import("@pearl-ledger/sdk");
  h.hardware.signTransaction = async (b, _a, options) => {
    await options!.onVerifiedSigned!(
      finalizeTransaction(b, fixture.signatures.map(fromHex)),
    );
    throw new Error("Final ACK lost");
  };
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.snapVerification, "not-confirmed");
  assert.match(result.snapError!, /ACK/);
  assert.equal(result.txid, fixture.txid);
  assert.equal(h.persisted.length, 1);
});

test("lower-layer wrapper cannot swallow a failed persistence recovery error", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const { finalizeTransaction } = await import("@pearl-ledger/sdk");
  h.setPersistence(async () => {
    throw new Error("Storage failed");
  });
  h.hardware.signTransaction = async (b, _a, options) => {
    try {
      await options!.onVerifiedSigned!(
        finalizeTransaction(b, fixture.signatures.map(fromHex)),
      );
    } catch (cause) {
      throw new Error("Hardware callback failed", { cause });
    }
    throw new Error("Unreachable");
  };
  await assert.rejects(
    h.companion.signPreparedTransaction(ticket),
    (error: unknown) => {
      assert(error instanceof PrlSignedPersistenceError);
      assert.equal(error.transaction.rawTx, fixture.rawTx);
      return true;
    },
  );
});

test("bad returned signature after complete callback cannot discard already verified bytes", async () => {
  const h = setup();
  await h.companion.connect("regtest", 0);
  const ticket = await h.companion.prepareTransaction(bundle());
  const { finalizeTransaction } = await import("@pearl-ledger/sdk");
  h.hardware.signTransaction = async (b, _a, options) => {
    await options!.onVerifiedSigned!(
      finalizeTransaction(b, fixture.signatures.map(fromHex)),
    );
    return [new Uint8Array(64), new Uint8Array(64)];
  };
  const result = await h.companion.signPreparedTransaction(ticket);
  assert.equal(result.txid, fixture.txid);
  assert.equal(result.snapVerification, "not-confirmed");
  assert.equal(h.persisted.length, 1);
});

test("unawaited transport callback still blocks submission/return until durable persistence finishes", async () => {
  for (const fail of [false, true]) {
    const h = setup();
    await h.companion.connect("regtest", 0);
    const ticket = await h.companion.prepareTransaction(bundle());
    const pause = deferred<void>(),
      entered = deferred<void>();
    h.setPersistence(async () => {
      entered.resolve();
      await pause.promise;
      if (fail) throw new Error("Late persistence failure");
    });
    const { finalizeTransaction } = await import("@pearl-ledger/sdk");
    h.hardware.signTransaction = async (b, _a, options) => {
      void options!.onVerifiedSigned!(
        finalizeTransaction(b, fixture.signatures.map(fromHex)),
      );
      return fixture.signatures.map(fromHex);
    };
    let completed = false;
    const signing = h.companion.signPreparedTransaction(ticket).finally(() => {
      completed = true;
    });
    await entered.promise;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(completed, false);
    assert(
      !h.calls.some(
        (c) => (c.params as any)?.request.method === "prl_submitSignatures",
      ),
    );
    pause.resolve();
    if (fail) await assert.rejects(signing, PrlSignedPersistenceError);
    else assert.equal((await signing).snapVerification, "verified");
  }
});
