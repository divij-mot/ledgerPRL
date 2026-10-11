import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { browserPublicSource } from "../src/public-source.js";
import { discoverAccount } from "@pearl-ledger/wallet";
import { deriveAddress, hex, NETWORKS } from "@pearl-ledger/sdk";
import {
  publicAccount,
  blockHash,
} from "../../../packages/wallet/test/fixtures.js";

/** Browser-side production code; only fetch is mocked. No external source is contacted. */
function mockFetch(t: TestContext, fn: typeof fetch) {
  const original = globalThis.fetch;
  globalThis.fetch = fn;
  t.after(() => {
    globalThis.fetch = original;
  });
}
test("public browser source requires consent and a fixed supported network before any disclosure", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    throw Error("Unexpected fetch");
  });
  assert.throws(() => browserPublicSource("mainnet", false), /disclosure/);
  for (const network of ["regtest", "simnet", "testnet"] as const)
    assert.throws(
      () => browserPublicSource(network, true),
      /only for mainnet and testnet2/,
    );
  assert.equal(calls, 0);
});
test("public browser source sends only approved address/txid/height paths with credentials/cache/redirect disabled", async (t) => {
  const requests: { input: RequestInfo | URL; init?: RequestInit }[] = [];
  mockFetch(t, async (input, init) => {
    requests.push({ input, ...(init ? { init } : {}) });
    return new Response("{}");
  });
  const source = browserPublicSource("mainnet", true),
    address = deriveAddress(
      { ...publicAccount, network: "mainnet" },
      0,
      0,
    ).address;
  const paths = [
    "/api/v2/",
    "/api/v2/block-index/200",
    `/api/v2/address/${address}?details=txids&pageSize=1000&page=1`,
    `/api/v2/utxo/${address}`,
    `/api/v2/tx/${"aa".repeat(32)}`,
  ];
  for (const path of paths) await source.get(path);
  assert.equal(requests.length, paths.length);
  requests.forEach(({ input, init }, i) => {
    assert.equal(input, "/api/indexer/read");
    assert.equal(init?.method, "POST");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.cache, "no-store");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      network: "mainnet",
      consent: true,
      path: paths[i],
    });
    assert(init?.signal instanceof AbortSignal);
  });
});
test("public browser source rejects arbitrary URL, RPC, xpub, traversal and send paths before fetch", async (t) => {
  let calls = 0;
  mockFetch(t, async () => {
    calls++;
    throw Error("Unexpected fetch");
  });
  const source = browserPublicSource("mainnet", true);
  for (const path of [
    "https://attacker.invalid/api/v2/",
    "/api/v2/../xpub/abc",
    "/api/v2/xpub/abc",
    "/api/v2/sendtx/00",
    "/api/v2/address/a?details=txids&pageSize=1000&page=3",
    "/api/v2/block-index/0?api_key=secret",
    "/api/v2/tx/" + "aa".repeat(32) + "/extra",
  ])
    await assert.rejects(
      source.get(path),
      /Unsupported read-only indexer path/,
    );
  assert.equal(calls, 0);
});
test("public browser discovery derives account locally and proxy requests never contain account/xpub or recovery bounds", async (t) => {
  const account = { ...publicAccount, network: "mainnet" as const };
  const addresses = new Set<string>();
  mockFetch(t, async (input, init) => {
    assert.equal(input, "/api/indexer/read");
    const wireBody = String(init?.body);
    for (const bytes of [
      account.publicKey,
      account.chainCode,
      account.masterFingerprint,
    ])
      assert(
        !wireBody.includes(hex(bytes)),
        "Public account key/origin bytes must remain in the browser",
      );
    assert.doesNotMatch(
      wireBody,
      /"(?:account|xpub|masterFingerprint|publicKey|chainCode|minimumIndex)"/,
    );
    const body = JSON.parse(wireBody);
    assert.deepEqual(Object.keys(body).sort(), ["consent", "network", "path"]);
    assert.equal(body.network, "mainnet");
    assert.equal(body.consent, true);
    let response: unknown;
    if (body.path === "/api/v2/")
      response = {
        blockbook: {
          inSync: true,
          initialSync: false,
          inSyncMempool: true,
          bestHeight: 200,
          decimals: 8,
        },
        backend: {
          chain: "mainnet",
          blocks: 200,
          bestBlockHash: blockHash(200),
        },
      };
    else if (body.path.startsWith("/api/v2/block-index/"))
      response = {
        blockHash: body.path.endsWith("/0")
          ? NETWORKS.mainnet.genesisHash
          : blockHash(200),
      };
    else {
      const match =
        /^\/api\/v2\/address\/([a-zA-Z0-9]+)\?details=txids&pageSize=1000&page=1$/.exec(
          body.path,
        );
      assert(match);
      addresses.add(match[1]!);
      response = {
        address: match[1],
        txs: 0,
        unconfirmedTxs: 0,
        page: 1,
        totalPages: 1,
        itemsOnPage: 1000,
        txids: [],
      };
    }
    return new Response(JSON.stringify(response));
  });
  const result = await discoverAccount(
    browserPublicSource("mainnet", true),
    account,
    { minimumIndex: [3, 4] },
  );
  assert.equal(result.complete, true);
  assert.equal(result.snapshot.coins.length, 0);
  assert.equal(result.snapshot.coverage.externalScannedThrough, 23);
  assert.equal(result.snapshot.coverage.changeScannedThrough, 24);
  assert(addresses.has(deriveAddress(account, 0, 23).address));
  assert(addresses.has(deriveAddress(account, 1, 24).address));
});
test("public browser source propagates cancellation without retry or alternate destination", async (t) => {
  let calls = 0,
    observed: AbortSignal | undefined;
  mockFetch(t, async (input, init) => {
    calls++;
    assert.equal(input, "/api/indexer/read");
    observed = init?.signal ?? undefined;
    return new Promise<Response>((_resolve, reject) => {
      observed!.addEventListener("abort", () => reject(observed!.reason), {
        once: true,
      });
    });
  });
  const controller = new AbortController(),
    source = browserPublicSource("testnet2", true, controller.signal);
  const pending = source.get("/api/v2/"),
    rejected = assert.rejects(pending, /cancelled/);
  controller.abort(new Error("User cancelled public query"));
  await rejected;
  assert.equal(observed?.aborted, true);
  assert.equal(calls, 1);
});
