/** Actual PSBT client + Wallet API lifecycle with a frozen public endpoint.
 * No BLE stack, device, private seed, persistence backend or network is used. */
import test from "node:test";
import assert from "node:assert/strict";
import { Buffer } from "buffer";
import {
  LedgerBitcoinPrlClient,
  SigningFailedWithoutResultError,
  VerifiedSigningResultError,
} from "@pearl-ledger/bitcoin-prl-adapter";
import {
  accountFromJson,
  bundleFromJson,
  deriveAddress,
} from "@pearl-ledger/sdk";
import { createWalletConnector } from "../src/wallet-api.js";
const { createPsbtEndpoint, publicFixture, P } = await import(
  new URL("./psbt-endpoint.mjs", import.meta.url).href
);

const account = accountFromJson(publicFixture.publicAccount);
const bundle = bundleFromJson(publicFixture.bundle);
const continuation = Uint8Array.of(0xf8, 1, 0, 1, 0);
const turn = () => new Promise<void>((resolve) => setImmediate(resolve));
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function harness(
  onStage: (stage: string, index?: number) => unknown,
  options: { exchange?: number; close?: number; closeRpc?: Promise<void> } = {},
) {
  const endpoints: ReturnType<typeof createPsbtEndpoint>[] = [];
  const events: string[] = [];
  const connect = createWalletConnector(
    () => {
      const generation = endpoints.length;
      const endpoint = createPsbtEndpoint({
        onStage: generation === 0 ? onStage : undefined,
      });
      endpoints.push(endpoint);
      return {
        capabilities: async () => [
          "device.transport",
          "device.exchange",
          "device.close",
        ],
        open: async () => {
          events.push(`open:${generation}`);
          return {
            exchange: (apdu: Buffer) => endpoint.transport.exchange(apdu),
            close: async () => {
              events.push(`close:${generation}`);
              await endpoint.transport.close();
              if (generation === 0) await options.closeRpc;
            },
          };
        },
        disconnect: () => {
          events.push(`disconnect:${generation}`);
        },
      };
    },
    {
      open: 1000,
      exchange: options.exchange ?? 1000,
      close: options.close ?? 500,
    },
  );
  return {
    endpoints,
    events,
    connect: () => connect(undefined, "bitcoin-prl", account.network),
  };
}
const originalFetch = globalThis.fetch;
test.before(() => {
  globalThis.fetch = async () => {
    throw Error("Network/broadcast forbidden in this test");
  };
});
test.after(() => {
  globalThis.fetch = originalFetch;
});

for (const failure of ["cancel", "timeout", "native-disconnect"] as const) {
  test(
    `Wallet API: partial signature then ${failure} cannot admit a late final signature`,
    { timeout: 10_000 },
    async () => {
      const reached = deferred<void>();
      const late = deferred<void>();
      const abort = new AbortController();
      const h = harness(
        (stage, index) => {
          if (stage === "signature" && index === 1) {
            reached.resolve();
            return late.promise;
          }
        },
        failure === "timeout" ? { exchange: 100, close: 40 } : {},
      );
      const transport = await h.connect();
      const client = new LedgerBitcoinPrlClient(transport, account.network);
      let persisted = 0;
      const progress: number[] = [];
      const signing = client.signBundle(bundle, account, {
        signal: abort.signal,
        onVerifiedSigned() {
          persisted++;
        },
        onProgress(phase, done) {
          if (phase === "signatures") progress.push(done);
        },
      });
      const rejected = assert.rejects(signing, SigningFailedWithoutResultError);
      await reached.promise;
      assert.deepEqual(
        progress,
        [1],
        "First signature must actually be verified",
      );
      const old = h.endpoints[0]!;
      const oldCommands = old.apdus.length;
      if (failure === "cancel") {
        abort.abort();
        await Promise.resolve();
        await assert.rejects(h.connect(), /already/);
        assert.equal(h.endpoints.length, 1);
        // Native RPC close can resolve first, but its old exchange must drain.
        await turn();
        assert(h.events.includes("close:0"));
        assert(!h.events.includes("disconnect:0"));
        late.resolve();
      } else if (failure === "native-disconnect") {
        late.reject({ _tag: "DeviceDisconnectedWhileSendingError" });
      }
      await rejected;
      assert.equal(client.sessionState, "failed");
      assert.equal(persisted, 0);
      assert.equal(old.acknowledgements(), 0);
      assert.deepEqual(progress, [1]);
      await assert.rejects(transport.exchange(continuation), /closed/);
      assert.equal(old.apdus.length, oldCommands);
      if (failure === "timeout") {
        await assert.rejects(h.connect(), /Close and reopen/);
        late.resolve();
        await turn();
        assert.equal(persisted, 0);
        assert.deepEqual(progress, [1]);
        assert.equal(old.apdus.length, oldCommands);
        assert.equal(old.acknowledgements(), 0);
        await assert.rejects(h.connect(), /Close and reopen/);
        assert.equal(h.endpoints.length, 1);
      } else {
        const fresh = await h.connect();
        const next = new LedgerBitcoinPrlClient(fresh, account.network);
        assert.equal(
          await next.verifyAddress(account, 0, 1),
          deriveAddress(account, 0, 1).address,
        );
        const freshCommands = h.endpoints[1]!.apdus.length;
        await client.close();
        await transport.close();
        await turn();
        assert.equal(next.sessionState, "ready");
        assert.equal(h.endpoints[1]!.apdus.length, freshCommands);
        assert.equal(h.endpoints[1]!.closes(), 0);
        assert.equal(old.closes(), 1);
        assert.equal(old.apdus.length, oldCommands);
        assert.equal(h.endpoints[1]!.commands.includes(P.SIGN_PSBT), false);
        await next.close();
      }
    },
  );
}

for (const durability of ["resolve", "reject", "timeout"] as const) {
  test(
    `Wallet API: cancelled verified result survives ${durability} of old durability callback beside a fresh session`,
    { timeout: 10_000 },
    async () => {
      const reached = deferred<void>();
      const stored = deferred<void>();
      const closed = deferred<void>();
      const h = harness(() => undefined, { closeRpc: closed.promise });
      const transport = await h.connect();
      const client = new LedgerBitcoinPrlClient(transport, account.network, {
        durabilityTimeoutMs: durability === "timeout" ? 500 : 3000,
      });
      const abort = new AbortController();
      let persistenceCalls = 0;
      let recoveryBytes: string | undefined;
      const signing = client
        .signBundle(bundle, account, {
          signal: abort.signal,
          onVerifiedSigned(signed) {
            persistenceCalls++;
            recoveryBytes = signed.rawTx;
            reached.resolve();
            return stored.promise;
          },
        })
        .then(
          (value) => ({ value }),
          (error: unknown) => ({ error }),
        );
      await reached.promise;
      assert.equal(recoveryBytes, publicFixture.rawTx);
      assert.equal(h.endpoints[0]!.acknowledgements(), 0);
      const oldCommands = h.endpoints[0]!.apdus.length;
      abort.abort();
      const closing = transport.close();
      await assert.rejects(h.connect(), /already/);
      assert.equal(h.endpoints.length, 1);
      closed.resolve();
      await closing;
      // The old durability callback is still pending, but its native request and
      // close have both drained. This new generation uses a distinct endpoint.
      const fresh = await h.connect();
      const next = new LedgerBitcoinPrlClient(fresh, account.network);
      assert.equal(
        await next.verifyAddress(account, 0, 2),
        deriveAddress(account, 0, 2).address,
      );
      const freshCommands = h.endpoints[1]!.apdus.length;
      if (durability === "resolve") stored.resolve();
      else if (durability === "reject")
        stored.reject(new Error("Synthetic durable storage failed"));
      const outcome = await signing;
      if (durability === "resolve") {
        assert("value" in outcome);
        assert.equal(outcome.value.rawTx, publicFixture.rawTx);
        assert.equal(outcome.value.txid, publicFixture.txid);
        assert.equal(
          outcome.value.completionWarning,
          "device-acknowledgement-unconfirmed",
        );
      } else {
        assert("error" in outcome);
        assert(outcome.error instanceof VerifiedSigningResultError);
        assert.equal(
          outcome.error.signedTransaction.rawTx,
          publicFixture.rawTx,
        );
        assert.equal(outcome.error.signedTransaction.txid, publicFixture.txid);
        assert.equal(
          outcome.error instanceof SigningFailedWithoutResultError,
          false,
        );
      }
      stored.resolve();
      await turn();
      assert.equal(persistenceCalls, 1);
      assert.equal(client.sessionState, "failed");
      assert.equal(next.sessionState, "ready");
      assert.equal(h.endpoints[0]!.closes(), 1);
      assert.equal(h.endpoints[0]!.apdus.length, oldCommands);
      assert.equal(h.endpoints[0]!.acknowledgements(), 0);
      assert.equal(h.endpoints[1]!.closes(), 0);
      assert.equal(h.endpoints[1]!.apdus.length, freshCommands);
      assert.equal(h.endpoints[1]!.commands.includes(P.SIGN_PSBT), false);
      await next.close();
    },
  );
}
