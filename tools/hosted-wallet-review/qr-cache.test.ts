/** Real QR/cache validators and camera cancellation with synthetic browser APIs;
 * no real camera, file upload, network, user cache or signing. */
import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePaymentQr,
  readQrImage,
  scanCamera,
} from "../../apps/companion/src/qr-reader.ts";
import {
  accountCache,
  parseAccountCache,
} from "../../apps/companion/src/account-cache.ts";
import { deriveAddress } from "../../packages/sdk/src/index.ts";
import { parseWatchSnapshot } from "../../packages/wallet/src/index.ts";
import {
  publicAccount,
  rawTransaction,
  snapshotFixture,
} from "../../packages/wallet/test/fixtures.ts";
const account = { ...publicAccount, network: "mainnet" as const },
  address = deriveAddress(account, 0, 7).address;
function gate() {
  let open!: (value: any) => void;
  const promise = new Promise<any>((r) => (open = r));
  return { promise, open };
}
async function until(check: () => boolean) {
  const end = performance.now() + 3000;
  while (!check()) {
    assert(performance.now() < end);
    await new Promise((r) => setImmediate(r));
  }
}
function globals(t: any, values: Record<string, unknown>) {
  const prior = Object.fromEntries(
    Object.keys(values).map((k) => [
      k,
      Object.getOwnPropertyDescriptor(globalThis, k),
    ]),
  );
  for (const [k, v] of Object.entries(values))
    Object.defineProperty(globalThis, k, {
      configurable: true,
      writable: true,
      value: v,
    });
  t.after(() => {
    for (const [k, v] of Object.entries(prior))
      if (v) Object.defineProperty(globalThis, k, v);
      else Reflect.deleteProperty(globalThis, k);
  });
}

test("QR parser accepts only exact same-network Pearl requests and bounded positive decimal amounts", () => {
  assert.deepEqual(parsePaymentQr(address, "mainnet"), {
    address,
    amount: undefined,
  });
  assert.deepEqual(
    parsePaymentQr(
      `pearl:${address}?amount=0.00002&label=hello&message=review`,
      "mainnet",
    ),
    { address, amount: "0.00002" },
  );
  for (const value of [
    `pearl://${address}`,
    `pearl:${address}?amount=0`,
    `pearl:${address}?amount=1e-3`,
    `pearl:${address}?amount=1&amount=2`,
    `pearl:${address}?req-payjoin=https://example.invalid`,
    `pearl:${address}#ignored`,
    `https://example.invalid/${address}`,
    deriveAddress({ ...account, network: "testnet2" }, 0, 7).address,
    "x".repeat(2049),
  ])
    assert.throws(() => parsePaymentQr(value, "mainnet"));
});

test("camera permission resolving after cancellation stops every acquired track", async (t) => {
  const permission = gate();
  let requested = false,
    stopped = 0,
    paused = 0;
  globals(t, {
    navigator: {
      mediaDevices: {
        getUserMedia: () => {
          requested = true;
          return permission.promise;
        },
      },
    },
    document: { createElement: () => ({ getContext: () => ({}) }) },
  });
  const video: any = {
    srcObject: null,
    pause() {
      paused++;
    },
    play: async () => {},
  };
  const abort = new AbortController();
  const scanning = scanCamera(video, abort.signal),
    rejected = assert.rejects(scanning, /cancelled/);
  await until(() => requested);
  abort.abort();
  await rejected;
  permission.open({
    getTracks: () => [
      {
        stop() {
          stopped++;
        },
      },
      {
        stop() {
          stopped++;
        },
      },
    ],
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(stopped, 2);
  assert.equal(video.srcObject, null);
  assert.equal(paused, 1);
});

test("cancelled image decode closes the late bitmap without reading pixels", async (t) => {
  const pending = gate();
  let closed = 0,
    canvasCalls = 0;
  globals(t, {
    createImageBitmap: () => pending.promise,
    document: {
      createElement() {
        canvasCalls++;
        throw Error("No pixels after cancellation");
      },
    },
  });
  const abort = new AbortController(),
    reading = readQrImage(
      { size: 100, type: "image/png" } as File,
      abort.signal,
    ),
    rejected = assert.rejects(reading);
  abort.abort();
  pending.open({
    width: 10,
    height: 10,
    close() {
      closed++;
    },
  });
  await rejected;
  assert.equal(closed, 1);
  assert.equal(canvasCalls, 0);
});

test("cached view binds account and validates raw owned outputs/history without restoring authority fields", () => {
  const snapshot = parseWatchSnapshot(
      JSON.stringify(snapshotFixture([rawTransaction(10000n)], 200, "mainnet")),
    ),
    cache = accountCache(snapshot, []);
  const read = parseAccountCache(
    {
      ...cache,
      validation: { checkedAt: Date.now() },
      verifiedReceive: address,
    },
    account,
  );
  assert.deepEqual(Object.keys(read).sort(), ["history", "snapshot"]);
  assert.equal(read.snapshot.coins[0]!.amount, 10000n);
  assert.throws(
    () =>
      parseAccountCache(cache, {
        ...account,
        chainCode: new Uint8Array(32).fill(9),
      }),
    /identity/,
  );
  const forged = structuredClone(cache);
  forged.snapshot.coins[0].rawTransaction =
    forged.snapshot.coins[0].rawTransaction.slice(0, -2) + "01";
  assert.throws(() => parseAccountCache(forged, account));
  const badHistory = {
    ...cache,
    history: [
      {
        txid: "aa".repeat(32),
        received: "1",
        spent: "0",
        state: "confirmed",
        block: null,
      },
    ],
  };
  assert.throws(() => parseAccountCache(badHistory, account), /block/);
});
