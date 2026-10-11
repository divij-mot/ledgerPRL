/** Pure-host identity/session review. Frozen public fixtures only: no key
 * derivation, native execution, browser, network, device or broadcast. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { base58check } from "@scure/base";
import * as sdk from "../../packages/sdk/src/index.ts";
import {
  LedgerBitcoinPrlClient,
  BitcoinPrlDeviceError,
  buildPrlPsbt,
  serializePrlPsbt,
} from "../../packages/bitcoin-prl-adapter/src/index.ts";
import {
  createPsbtEndpoint,
  publicFixture,
  psbtFixture,
  networkInfo,
  ok,
  P,
} from "../../apps/companion/test/psbt-endpoint.mjs";

const account = () => sdk.accountFromJson(publicFixture.publicAccount);
const bundle = () => sdk.bundleFromJson(publicFixture.bundle);
const psbt = serializePrlPsbt(buildPrlPsbt(bundle(), account()));
const encoder = new TextEncoder();
const operations = {
  export: (client: LedgerBitcoinPrlClient, signal?: AbortSignal) =>
    client.exportAccount(0, signal),
  receive: (client: LedgerBitcoinPrlClient, signal?: AbortSignal) =>
    client.verifyAddress(account(), 0, 0, signal),
  signBundle: (client: LedgerBitcoinPrlClient, signal?: AbortSignal) =>
    client.signBundle(bundle(), account(), { signal }),
  signPsbt: (client: LedgerBitcoinPrlClient, signal?: AbortSignal) =>
    client.signPsbt(psbt, account(), { signal }),
};

for (const [name, operation] of Object.entries(operations)) {
  test(`${name}: every byte of live network/profile binding is enforced before export, display or sign`, async () => {
    for (let offset = 0; offset < 58; offset++) {
      const changed = networkInfo();
      changed[offset] ^= 1;
      const endpoint = createPsbtEndpoint({
        onCommand: (ins: number) =>
          ins === P.GET_NETWORK_INFO ? ok(changed) : undefined,
      });
      const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
      await assert.rejects(operation(client), `binding byte ${offset}`);
      assert.equal(client.sessionState, "failed");
      assert.deepEqual(endpoint.commands, [P.GET_NETWORK_INFO]);
      await assert.rejects(client.capabilities(), /failed/);
      assert.deepEqual(endpoint.commands, [P.GET_NETWORK_INFO]);
    }
  });

  test(`${name}: wrong app, legacy protocol, malformed response and rejected command cannot fall back`, async () => {
    for (const response of [
      Uint8Array.of(0x6d, 0x00), // unknown instruction, including ordinary Bitcoin app
      Uint8Array.of(0x6e, 0x00), // wrong CLA
      Uint8Array.of(0x69, 0x85), // device rejection
      Uint8Array.of(0x69, 0x86), // command not allowed
      Uint8Array.of(0x90),
      ok(Uint8Array.of(1, 0, 1, 0, 3, 16, 0xe3, 5)), // historical PRL1 capabilities
      ok(networkInfo().slice(0, 57)),
      ok(sdk.concat(networkInfo(), Uint8Array.of(0))),
      sdk.concat(networkInfo(), Uint8Array.of(0xe0, 0)), // unexpected interruption
      ok(networkInfo("mainnet")),
      ok(networkInfo("testnet2")),
    ]) {
      const endpoint = createPsbtEndpoint({ onCommand: () => response });
      const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
      await assert.rejects(operation(client));
      assert.equal(client.sessionState, "failed");
      assert.equal(endpoint.apdus.length, 1);
      assert.deepEqual(endpoint.apdus[0], Uint8Array.of(0xe1, 6, 0, 1, 0));
    }
  });

  test(`${name}: already-cancelled request sends no APDU`, async () => {
    const endpoint = createPsbtEndpoint();
    const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(
      operation(client, controller.signal),
      /already cancelled/,
    );
    assert.equal(endpoint.commands.length, 0);
    // A no-op cancellation before any command does not poison a ready session.
    assert.equal(client.sessionState, "ready");
    await client.close();
  });

  test(`${name}: cached policy does not skip the next operation's live binding`, async () => {
    let replaced = false;
    const endpoint = createPsbtEndpoint({
      onCommand: (ins: number) =>
        replaced && ins === P.GET_NETWORK_INFO
          ? ok(networkInfo("testnet2"))
          : undefined,
    });
    const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
    await client.exportAccount(0);
    replaced = true;
    const count = endpoint.commands.length;
    await assert.rejects(operation(client), /Wrong device network/);
    assert.deepEqual(endpoint.commands.slice(count), [P.GET_NETWORK_INFO]);
    assert.equal(client.sessionState, "failed");
  });
}

test("same-HRP testnets are still separately bound by network ID and genesis", async () => {
  assert.equal(sdk.NETWORKS.testnet.hrp, sdk.NETWORKS.testnet2.hrp);
  for (const actual of ["testnet", "testnet2"] as const) {
    const expected = actual === "testnet" ? "testnet2" : "testnet";
    const endpoint = createPsbtEndpoint({
      onCommand: () => ok(networkInfo(actual)),
    });
    const client = new LedgerBitcoinPrlClient(endpoint.transport, expected);
    await assert.rejects(client.capabilities(), /Wrong device network/);
  }
});

test("uncached receive and signing compare the full approved public account, not only its fingerprint", async () => {
  for (const field of [
    "masterFingerprint",
    "chainCode",
    "publicKey",
  ] as const) {
    for (const operation of ["receive", "signBundle"] as const) {
      const changed = account();
      if (field === "publicKey") {
        // Negate the public point: valid public key, same fixture fingerprint.
        changed.publicKey[0] = changed.publicKey[0] === 2 ? 3 : 2;
      } else changed[field][0] ^= 1;
      const endpoint = createPsbtEndpoint({ account: changed });
      const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
      await assert.rejects(
        operations[operation](client),
        /differs from approved/,
      );
      assert.equal(endpoint.commands.includes(P.GET_WALLET_ADDRESS), false);
      assert.equal(endpoint.commands.includes(P.SIGN_PSBT), false);
      assert.equal(client.sessionState, "failed");
    }
  }
});

test("cached policies still reject a changed device fingerprint before display or signing", async () => {
  for (const operation of ["receive", "signBundle"] as const) {
    let replaced = false;
    const endpoint = createPsbtEndpoint({
      onCommand: (ins: number) => {
        if (replaced && ins === P.GET_MASTER_FINGERPRINT) {
          const changed = account().masterFingerprint;
          changed[0] ^= 1;
          return ok(changed);
        }
      },
    });
    const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
    await client.exportAccount(0);
    replaced = true;
    const count = endpoint.commands.length;
    await assert.rejects(operations[operation](client), /fingerprint changed/);
    assert.deepEqual(endpoint.commands.slice(count), [
      P.GET_NETWORK_INFO,
      P.GET_MASTER_FINGERPRINT,
    ]);
  }
});

test("export rejects malformed fingerprint and account xpub metadata", async () => {
  for (const length of [0, 3, 5]) {
    const endpoint = createPsbtEndpoint({
      onCommand: (ins: number) =>
        ins === P.GET_MASTER_FINGERPRINT
          ? ok(new Uint8Array(length))
          : undefined,
    });
    const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
    await assert.rejects(client.exportAccount(0), /fingerprint/);
    assert.equal(endpoint.commands.includes(P.GET_EXTENDED_PUBKEY), false);
  }
  const b58 = base58check(sdk.sha256);
  for (const offset of [0, 4, 9, 12]) {
    const bytes = b58.decode(psbtFixture.accountXpub);
    bytes[offset] ^= 1;
    const endpoint = createPsbtEndpoint({
      onCommand: (ins: number) =>
        ins === P.GET_EXTENDED_PUBKEY
          ? ok(encoder.encode(b58.encode(bytes)))
          : undefined,
    });
    const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
    await assert.rejects(client.exportAccount(0), /version|depth\/index/);
    assert.equal(client.sessionState, "failed");
  }
});

test("receive requires display and rejects a well-formed address for a different index", async () => {
  const endpoint = createPsbtEndpoint({
    onStage: (stage: string) =>
      stage === "address"
        ? ok(encoder.encode(sdk.deriveAddress(account(), 0, 1).address))
        : undefined,
  });
  const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
  await assert.rejects(
    client.verifyAddress(account(), 0, 0),
    /differs from independently/,
  );
  const request = endpoint.apdus.find(
    (a: Uint8Array) => a[0] === P.cla && a[1] === P.GET_WALLET_ADDRESS,
  );
  assert.equal(request[5], 1);
  assert.equal(client.sessionState, "failed");
});

for (const stage of ["export", "address", "review"] as const) {
  test(`${stage}: rejected device UI never releases an address or signed result`, async () => {
    for (const status of [0x6985, 0x6986, 0x6a80, 0x6f00]) {
      const endpoint = createPsbtEndpoint({
        onStage: (at: string) =>
          at === stage ? Uint8Array.of(status >>> 8, status & 255) : undefined,
      });
      const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
      let persisted = 0;
      const operation =
        stage === "export"
          ? client.exportAccount(0)
          : stage === "address"
            ? client.verifyAddress(account(), 0, 0)
            : client.signBundle(bundle(), account(), {
                onVerifiedSigned: () => {
                  persisted++;
                },
              });
      await assert.rejects(
        operation,
        (error: unknown) =>
          error instanceof BitcoinPrlDeviceError && error.status === status,
      );
      assert.equal(persisted, 0);
      assert.equal(client.sessionState, "failed");
      const count = endpoint.commands.length;
      await assert.rejects(client.capabilities(), /failed/);
      assert.equal(endpoint.commands.length, count);
    }
  });

  test(`${stage}: cancellation while waiting for UI ignores a late successful response`, async () => {
    let enter!: () => void;
    let release!: (value: Uint8Array | undefined) => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const pendingReply = new Promise<Uint8Array | undefined>((resolve) => {
      release = resolve;
    });
    const endpoint = createPsbtEndpoint({
      onStage: (at: string) => {
        if (at === stage) {
          enter();
          return pendingReply;
        }
      },
    });
    const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
    const controller = new AbortController();
    const pending =
      stage === "export"
        ? client.exportAccount(0, controller.signal)
        : stage === "address"
          ? client.verifyAddress(account(), 0, 0, controller.signal)
          : client.signBundle(bundle(), account(), {
              signal: controller.signal,
            });
    const rejected = assert.rejects(pending, /cancelled|timed out/);
    await entered;
    controller.abort();
    await rejected;
    const count = endpoint.commands.length;
    release(undefined);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(client.sessionState, "failed");
    assert.equal(endpoint.commands.length, count);
  });
}

test("trust-boundary control: exact public device claims can pass without proving firmware identity or a human click", async () => {
  // This is an intentional, disclosed mock. There is no device or person.
  // Passing it demonstrates the limits of a host protocol assertion, not an exploit.
  const endpoint = createPsbtEndpoint();
  const client = new LedgerBitcoinPrlClient(endpoint.transport, "regtest");
  const info = await client.capabilities();
  assert.equal(Object.hasOwn(info, "appVersion"), false);
  assert.equal(Object.hasOwn(info, "firmwareHash"), false);
  const exported = await client.exportAccount(0);
  assert.equal(
    await client.verifyAddress(exported, 0, 0),
    sdk.deriveAddress(exported, 0, 0).address,
  );
  assert.equal(
    endpoint.apdus.some((a: Uint8Array) => a[0] === 0xb0),
    false,
  );
  await client.close();
});

test("current companion and CLI instantiate only the PSBT client, with no legacy fallback", () => {
  for (const path of [
    "../../apps/companion/src/main.ts",
    "../../apps/cli/src/index.ts",
  ]) {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /new LedgerBitcoinPrlClient\(/);
    assert.doesNotMatch(source, /new LedgerPearlClient\(/);
  }
  const main = readFileSync(
    new URL("../../apps/companion/src/main.ts", import.meta.url),
    "utf8",
  );
  assert.match(main, /\},\s*"bitcoin-prl",\s*network,?\s*\)/);
});
