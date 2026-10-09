import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { NETWORKS, parseTransaction } from "@pearl-ledger/sdk";
import { indexerProxy } from "../src/indexer-proxy.js";

// Frozen public transaction only. Every upstream reply is in-process; no node,
// browser, real wallet, device or external network is used by these tests.
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
) as { rawTx: string; txid: string };
const origin = "https://wallet.example.com";
async function broadcast(rawTx: string, fetcher: typeof fetch) {
  const request = Object.assign(new PassThrough(), {
    method: "POST",
    url: "/api/indexer/broadcast",
    headers: {
      origin,
      host: "wallet.example.com",
      "x-pearl-companion": "1",
      "content-type": "application/json",
    },
  });
  let status = 0,
    body = "";
  const response = Object.assign(new EventEmitter(), {
    destroyed: false,
    writableEnded: false,
    writeHead(value: number) {
      status = value;
    },
    end(value: string) {
      body = value;
      this.writableEnded = true;
    },
  });
  const promise = indexerProxy(origin, fetcher)(
    request as unknown as IncomingMessage,
    response as unknown as ServerResponse,
    () => assert.fail("unexpected fallthrough"),
  );
  request.end(
    JSON.stringify({
      network: "mainnet",
      consent: true,
      rawTx,
      expectedTxid: parseTransaction(rawTx).txid,
    }),
  );
  await promise;
  return { status, body: JSON.parse(body) as unknown };
}

test("public relay rejects nonempty scriptSig even when witness and txid shapes match", async () => {
  assert.equal(fixture.rawTx.slice(86, 88), "00");
  const modified =
    fixture.rawTx.slice(0, 86) + "0151" + fixture.rawTx.slice(88);
  const parsed = parseTransaction(modified);
  assert.equal(parsed.inputs[0]!.scriptSig.length, 1);
  assert(
    parsed.inputs.every(
      (input) => input.witness.length === 1 && input.witness[0]!.length === 64,
    ),
  );
  let calls = 0;
  const result = await broadcast(modified, async () => {
    calls++;
    throw Error("unexpected upstream");
  });
  assert.equal(result.status, 400);
  assert.equal(calls, 0);
});

test("public relay forwards exact structural key-path bytes once after chain identity checks", async () => {
  let submissions = 0,
    reads = 0;
  const result = await broadcast(fixture.rawTx, async (input, init) => {
    const url = String(input);
    assert(url.startsWith("https://blockbook.pearlresearch.ai/api/v2/"));
    assert.equal(init?.redirect, "error");
    if (url.endsWith("/sendtx/")) {
      submissions++;
      assert.equal(reads, 3);
      assert.equal(init?.method, "POST");
      assert.equal(init?.body, fixture.rawTx);
      assert.deepEqual(init?.headers, { "content-type": "text/plain" });
      return new Response(JSON.stringify({ result: fixture.txid }));
    }
    reads++;
    assert.equal(init?.method, undefined);
    if (url.endsWith("/api/v2/"))
      return new Response(
        JSON.stringify({
          blockbook: {
            decimals: 8,
            inSync: true,
            initialSync: false,
            inSyncMempool: true,
            bestHeight: 200,
          },
          backend: {
            chain: "mainnet",
            blocks: 200,
            bestBlockHash: "22".repeat(32),
          },
        }),
      );
    return new Response(
      JSON.stringify({
        blockHash: url.endsWith("/block-index/0")
          ? NETWORKS.mainnet.genesisHash
          : "22".repeat(32),
      }),
    );
  });
  assert.equal(result.status, 200);
  assert.deepEqual(result.body, { txid: fixture.txid });
  assert.equal(submissions, 1);
});
