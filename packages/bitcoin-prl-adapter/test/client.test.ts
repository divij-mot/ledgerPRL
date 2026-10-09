import test from "node:test";
import assert from "node:assert/strict";
import {
  concat,
  deriveAddress,
  fromHex,
  hex,
  type ApduTransport,
  type FinalizedTransaction,
} from "@pearl-ledger/sdk";
import {
  BITCOIN_PRL_PROTOCOL as P,
  LedgerBitcoinPrlClient,
  parseAccountXpub,
  parseNetworkInfo,
  parseYieldedSignature,
  VerifiedSigningResultError,
  verifyAndFinalize,
  snapshotAccount,
  snapshotBundle,
} from "../src/index.js";
import {
  networkInfo,
  p2mrFixture,
  publicFixture,
  testAccount,
  yielded,
} from "./fixtures.js";
const OK = Uint8Array.of(0x90, 0),
  INTERRUPTED = Uint8Array.of(0xe0, 0);
function ok(bytes: Uint8Array = new Uint8Array()): Uint8Array {
  return concat(bytes, OK);
}
function interrupted(bytes: Uint8Array): Uint8Array {
  return concat(bytes, INTERRUPTED);
}
class FakeTransport implements ApduTransport {
  readonly commands: Uint8Array[] = [];
  closed = false;
  constructor(
    readonly handler: (
      apdu: Uint8Array,
      n: number,
      signal?: AbortSignal,
    ) => Uint8Array | Promise<Uint8Array>,
  ) {}
  async exchange(apdu: Uint8Array, signal?: AbortSignal) {
    assert.equal(apdu[4], apdu.length - 5);
    assert.equal(apdu[2], 0);
    assert.equal(apdu[3], 1);
    this.commands.push(apdu.slice());
    return this.handler(apdu, this.commands.length, signal);
  }
  async close() {
    this.closed = true;
  }
}
function signingTransport(
  options: {
    fixture?: ReturnType<typeof publicFixture>;
    yieldOrder?: number[];
    mutateYield?: (bytes: Uint8Array, i: number) => Uint8Array;
    finalAck?: () => Uint8Array | Promise<Uint8Array>;
    onCommand?: (apdu: Uint8Array, n: number) => void;
  } = {},
) {
  const fixture = options.fixture ?? publicFixture(),
    { account, bundle, signatures } = fixture;
  const deviceAccount = snapshotAccount(account),
    deviceBundle = snapshotBundle(bundle, account);
  const deviceSignatures = signatures.map((signature) => signature.slice());
  const xpub = testAccount(account.network, account.account).xpub;
  let nextYield = 0;
  const order = options.yieldOrder ?? bundle.inputs.map((_, i) => i);
  const transport = new FakeTransport(async (apdu, n) => {
    options.onCommand?.(apdu, n);
    if (apdu[0] === P.cla) {
      if (apdu[1] === P.GET_NETWORK_INFO)
        return ok(networkInfo(deviceAccount.network));
      if (apdu[1] === P.GET_MASTER_FINGERPRINT)
        return ok(deviceAccount.masterFingerprint);
      if (apdu[1] === P.GET_EXTENDED_PUBKEY) {
        assert.equal(apdu[5], 1);
        return ok(new TextEncoder().encode(xpub));
      }
      assert.equal(apdu[1], P.SIGN_PSBT);
      assert.equal(apdu.length, 200);
    } else {
      assert.equal(apdu[0], P.FRAMEWORK_CLA);
      assert.equal(apdu[1], P.CONTINUE);
      assert.equal(apdu.length, 5);
    }
    if (nextYield < order.length) {
      const i = order[nextYield++]!,
        bytes = yielded(deviceBundle, deviceSignatures, i);
      return interrupted(
        options.mutateYield ? options.mutateYield(bytes, i) : bytes,
      );
    }
    return options.finalAck ? options.finalAck() : ok();
  });
  return { transport, ...fixture };
}
test("native signature set matches published txid/wtxid and rejects wrong index/key/length/digest", () => {
  const { account, bundle, signatures, txid, wtxid } = publicFixture();
  const partials = signatures.map((_, i) =>
    parseYieldedSignature(yielded(bundle, signatures, i).slice(1)),
  );
  const final = verifyAndFinalize(bundle, account, [...partials].reverse());
  assert.equal(final.txid, txid);
  assert.equal(final.wtxid, wtxid);
  assert.throws(
    () => verifyAndFinalize(bundle, account, [partials[0]!, partials[0]!]),
    /duplicate/,
  );
  assert.throws(
    () => verifyAndFinalize(bundle, account, [partials[0]!]),
    /count/,
  );
  assert.throws(
    () =>
      verifyAndFinalize(bundle, account, [
        { ...partials[0]!, pubkey: new Uint8Array(32) },
        partials[1]!,
      ]),
    /key mismatch/,
  );
  assert.throws(
    () =>
      verifyAndFinalize(bundle, account, [
        { ...partials[0]!, signature: new Uint8Array(64) },
        partials[1]!,
      ]),
    /verification/,
  );
  assert.throws(
    () =>
      parseYieldedSignature(
        concat(yielded(bundle, signatures, 0).slice(1), Uint8Array.of(0)),
      ),
    /Trailing/,
  );
  assert.throws(
    () => parseYieldedSignature(Uint8Array.of(253, 0, 0)),
    /Noncanonical/,
  );
  const wrong = { ...bundle, outputs: bundle.outputs.map((o) => ({ ...o })) };
  wrong.outputs[0]!.amount -= 1n;
  assert.throws(
    () => verifyAndFinalize(wrong, account, partials),
    /verification/,
  );
});
test("every network/genesis/amount/capability field and xpub account metadata is checked", () => {
  assert.equal(
    parseNetworkInfo(networkInfo(), "regtest").maxMoney,
    2100000000000000000n,
  );
  for (const offset of [0, 4, 5, 6, 10, 42, 50, 52, 54]) {
    const info = networkInfo();
    info[offset] = info[offset]! ^ 1;
    assert.throws(() => parseNetworkInfo(info, "regtest"));
  }
  assert.throws(
    () => parseNetworkInfo(networkInfo("testnet"), "testnet2"),
    /Wrong device network/,
  );
  for (const name of [
    "mainnet",
    "testnet",
    "testnet2",
    "regtest",
    "simnet",
  ] as const) {
    const { account, xpub } = testAccount(name, 0x7fffffff);
    assert.deepEqual(
      parseAccountXpub(xpub, account.masterFingerprint, name, account.account)
        .account,
      account,
    );
    assert.throws(
      () => parseAccountXpub(xpub, account.masterFingerprint, name, 0),
      /depth\/index/,
    );
  }
  const main = testAccount("mainnet");
  assert.throws(
    () =>
      parseAccountXpub(main.xpub, main.account.masterFingerprint, "regtest", 0),
    /version/,
  );
  assert.throws(
    () =>
      parseAccountXpub(
        main.child.privateExtendedKey,
        main.account.masterFingerprint,
        "mainnet",
        0,
      ),
    /version/,
  );
});
test("standard APDU flow verifies and finalizes out-of-order yields, callback once before final ACK", async () => {
  let persisted: FinalizedTransaction | undefined;
  const { transport, bundle, account, txid } = signingTransport({
    yieldOrder: [1, 0],
    finalAck: () => {
      assert.equal(persisted?.txid, txid);
      return ok();
    },
  });
  const client = new LedgerBitcoinPrlClient(transport, account.network);
  let callbackCount = 0;
  const final = await client.signBundle(bundle, account, {
    onVerifiedSigned: async (tx) => {
      callbackCount++;
      persisted = tx;
    },
  });
  assert.equal(final.txid, txid);
  assert.equal(final.completionWarning, undefined);
  assert.equal(callbackCount, 1);
  assert.equal(client.sessionState, "ready");
  assert.equal(transport.closed, false);
  assert.deepEqual(
    transport.commands.map((c) => [c[0], c[1]]),
    [
      [0xe1, 6],
      [0xe1, 5],
      [0xe1, 0],
      [0xe1, 4],
      [0xf8, 1],
      [0xf8, 1],
    ],
  );
});
test("valid P2MR payment uses identical BIP341 signing/finalization with capability flags3", async () => {
  const f = p2mrFixture(),
    fixture = { ...publicFixture(), ...f };
  const { transport } = signingTransport({ fixture });
  const final = await new LedgerBitcoinPrlClient(
    transport,
    f.account.network,
  ).signBundle(f.bundle, f.account);
  assert.equal(final.signatures.length, 2);
  assert.equal(final.completionWarning, undefined);
});
test("complete signed bytes survive missing/rejected final ACK, abort, and post-success cancellation", async () => {
  for (const mode of ["throw", "reject", "payload", "abort"] as const) {
    const abort = new AbortController();
    let saved: FinalizedTransaction | undefined;
    const { transport, bundle, account, txid } = signingTransport({
      finalAck: () => {
        if (mode === "throw") throw new Error("Lost final ACK");
        if (mode === "reject") return Uint8Array.of(0x69, 0x85);
        if (mode === "payload") return ok(Uint8Array.of(1));
        abort.abort();
        return ok();
      },
    });
    const client = new LedgerBitcoinPrlClient(transport, account.network);
    const final = await client.signBundle(bundle, account, {
      signal: abort.signal,
      onVerifiedSigned: (tx) => {
        saved = tx;
      },
    });
    assert.equal(final.txid, txid);
    assert.equal(saved?.txid, txid);
    assert.equal(final.completionWarning, "device-acknowledgement-unconfirmed");
    assert.equal(client.sessionState, "failed");
    assert.equal(transport.closed, true);
    await assert.rejects(client.capabilities(), /failed/);
  }
});
test("a failing final progress observer cannot discard complete verified signed bytes", async () => {
  let persisted: FinalizedTransaction | undefined;
  let acknowledgements = 0;
  const { transport, bundle, account, txid } = signingTransport({
    finalAck: () => { acknowledgements++; return ok(); },
  });
  const client = new LedgerBitcoinPrlClient(transport, account.network);
  const final = await client.signBundle(bundle, account, {
    onVerifiedSigned: (transaction) => { persisted = transaction; },
    onProgress: (phase, completed, total) => {
      if (phase === "signatures" && completed === total) {
        assert.equal(persisted?.txid, txid);
        throw new Error("UI progress observer failed");
      }
    },
  });
  assert.equal(final.txid, txid);
  assert.equal(final.rawTx, persisted?.rawTx);
  assert.equal(final.completionWarning, "device-acknowledgement-unconfirmed");
  assert.equal(acknowledgements, 0);
  assert.equal(client.sessionState, "failed");
  assert.equal(transport.closed, true);
});
test("cancellation triggered by final received yield still persists it without sending continuation", async () => {
  const abort = new AbortController();
  let saved = 0;
  const { transport, bundle, account } = signingTransport({
    mutateYield: (bytes, i) => {
      if (i === 0) abort.abort();
      return bytes;
    },
  });
  const client = new LedgerBitcoinPrlClient(transport, account.network);
  // If abort wins before the response is observed, the payment remains ambiguous; this
  // test cancels from the durable callback to guarantee the complete set was observed.
  const noRace = signingTransport();
  const c = new LedgerBitcoinPrlClient(
      noRace.transport,
      noRace.account.network,
    ),
    controller = new AbortController();
  const final = await c.signBundle(noRace.bundle, noRace.account, {
    signal: controller.signal,
    onVerifiedSigned: () => {
      saved++;
      controller.abort();
    },
  });
  assert.equal(saved, 1);
  assert.equal(final.txid, noRace.txid);
  assert.equal(c.sessionState, "failed");
  assert.equal(noRace.transport.commands.length, 5);
  // Independent cancellation before completion cannot masquerade as a completed transaction.
  await assert.rejects(
    client.signBundle(bundle, account, { signal: abort.signal }),
  );
  assert.equal(client.sessionState, "failed");
});
test("durability callback rejection carries verified bytes and prevents final ACK", async () => {
  const { transport, bundle, account, txid } = signingTransport();
  const client = new LedgerBitcoinPrlClient(transport, account.network);
  let error: unknown;
  try {
    await client.signBundle(bundle, account, {
      onVerifiedSigned: () => {
        throw new Error("disk full");
      },
    });
  } catch (e) {
    error = e;
  }
  assert(error instanceof VerifiedSigningResultError);
  assert.equal(error.signedTransaction.txid, txid);
  assert.match(String(error.failure), /disk full/);
  assert.equal(client.sessionState, "failed");
  assert.equal(transport.commands.length, 5);
});
test("pending durable callback is awaited, cannot mutate retained transaction, and blocks concurrent operations", async () => {
  const { transport, bundle, account, txid } = signingTransport();
  const client = new LedgerBitcoinPrlClient(transport, account.network);
  let release!: () => void, entered!: () => void;
  const enteredPromise = new Promise<void>((resolve) => {
    entered = resolve;
  });
  const pending = client.signBundle(bundle, account, {
    onVerifiedSigned: async (tx) => {
      tx.signatures[0]!.fill(0);
      tx.bytes.fill(0);
      tx.rawTx = "00";
      entered();
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    },
  });
  await enteredPromise;
  assert.equal(transport.commands.length, 5);
  await assert.rejects(client.capabilities(), /busy/);
  await assert.rejects(client.close(), /active/);
  release();
  const final = await pending;
  assert.equal(final.txid, txid);
  assert.notEqual(final.rawTx, "00");
});
test("duplicate/foreign/invalid/missing signatures close the session and never reach durability callback", async () => {
  for (const options of [
    { yieldOrder: [0, 0] },
    { yieldOrder: [0] },
    {
      mutateYield: (b: Uint8Array) => {
        const out = b.slice();
        out[5] = out[5]! ^ 1;
        return out;
      },
    },
    {
      mutateYield: (b: Uint8Array) => {
        const out = b.slice();
        out[out.length - 1] = out[out.length - 1]! ^ 1;
        return out;
      },
    },
  ]) {
    const { transport, bundle, account } = signingTransport(options);
    let callbacks = 0;
    const client = new LedgerBitcoinPrlClient(transport, account.network);
    await assert.rejects(
      client.signBundle(bundle, account, {
        onVerifiedSigned: () => {
          callbacks++;
        },
      }),
    );
    assert.equal(callbacks, 0);
    assert.equal(client.sessionState, "failed");
    assert.equal(transport.closed, true);
  }
});
test("caller mutations after signing starts cannot change approved account or transaction", async () => {
  const { transport, bundle, account, txid } = signingTransport();
  const client = new LedgerBitcoinPrlClient(transport, account.network),
    pending = client.signBundle(bundle, account);
  bundle.outputs[0]!.amount = 1n;
  bundle.inputs[0]!.scriptPubKey.fill(0);
  account.publicKey.fill(0);
  const final = await pending;
  assert.equal(final.txid, txid);
  assert.equal(client.sessionState, "ready");
});
test("network mismatch, unexpected interruption, malformed status and timeout are terminal", async () => {
  for (const response of [
    ok(networkInfo("testnet2")),
    interrupted(Uint8Array.of(0x40)),
    Uint8Array.of(0x90),
    Uint8Array.of(0x6d, 0),
  ]) {
    const transport = new FakeTransport(() => response),
      client = new LedgerBitcoinPrlClient(transport, "regtest");
    await assert.rejects(client.capabilities());
    assert.equal(client.sessionState, "failed");
    assert.equal(transport.commands.length, 1);
  }
  const transport = new FakeTransport(() => new Promise(() => {})),
    client = new LedgerBitcoinPrlClient(transport, "regtest", { timeoutMs: 5 });
  await assert.rejects(client.capabilities(), /timed out/);
  assert.equal(client.sessionState, "failed");
});
test("device receive address must match independently derived HRP/program and can use cached account policy", async () => {
  const { account, xpub } = testAccount();
  const expected = deriveAddress(account, 0, 0).address;
  const transport = new FakeTransport((apdu) => {
    if (apdu[1] === P.GET_NETWORK_INFO) return ok(networkInfo());
    if (apdu[1] === P.GET_MASTER_FINGERPRINT)
      return ok(account.masterFingerprint);
    if (apdu[1] === P.GET_EXTENDED_PUBKEY)
      return ok(new TextEncoder().encode(xpub));
    assert.equal(apdu[1], P.GET_WALLET_ADDRESS);
    assert.equal(apdu[5], 1);
    return ok(new TextEncoder().encode(expected));
  });
  const client = new LedgerBitcoinPrlClient(transport, account.network);
  assert.deepEqual(await client.exportAccount(0), account);
  assert.equal(await client.verifyAddress(account, 0, 0), expected);
  assert.equal(
    transport.commands.filter((c) => c[1] === P.GET_EXTENDED_PUBKEY).length,
    1,
  );
});

test("hung signed-byte storage is bounded and returns the complete recovery transaction", async () => {
  const { transport, bundle, account, txid } = signingTransport();
  const client = new LedgerBitcoinPrlClient(transport, account.network, {
    durabilityTimeoutMs: 5,
  });
  await assert.rejects(
    client.signBundle(bundle, account, {
      onVerifiedSigned: () => new Promise(() => {}),
    }),
    (error: unknown) =>
      error instanceof VerifiedSigningResultError &&
      error.signedTransaction.txid === txid &&
      /storage timed out/.test(String(error.failure)),
  );
  assert.equal(client.sessionState, "failed");
  assert.equal(transport.commands.length, 5);
});
