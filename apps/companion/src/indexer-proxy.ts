/** Same-origin public-data proxy. Never accepts account keys, arbitrary URLs or RPC credentials. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { assert, parseTransaction, readBoundedText } from "@pearl-ledger/sdk";
import { exactKeys, record } from "@pearl-ledger/wallet";
import { BlockbookSource, lightNetwork } from "./blockbook-source.js";
import { readJsonBody, requestOperation } from "./operation.js";

function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  assert(Buffer.byteLength(body) <= 4 * 1024 * 1024, "Response too large");
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}
export function indexerProxy(origin: string, fetcher: typeof fetch = fetch) {
  const expected = new URL(origin);
  assert(
    expected.origin === origin &&
      !expected.username &&
      !expected.password &&
      (expected.protocol === "https:" ||
        (expected.protocol === "http:" &&
          ["127.0.0.1", "localhost"].includes(expected.hostname))),
    "Exact HTTPS or loopback origin required",
  );
  let active = 0;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!request.url?.startsWith("/api/indexer/")) {
      next();
      return;
    }
    if (
      request.method !== "POST" ||
      request.headers.origin !== origin ||
      request.headers.host !== expected.host ||
      request.headers["x-pearl-companion"] !== "1" ||
      (request.headers["sec-fetch-site"] &&
        request.headers["sec-fetch-site"] !== "same-origin")
    ) {
      send(response, 403, { error: "Same-origin wallet request required" });
      return;
    }
    if (
      !["/api/indexer/read", "/api/indexer/broadcast"].includes(request.url)
    ) {
      send(response, 404, { error: "Unsupported indexer operation" });
      return;
    }
    if (active >= 16) {
      send(response, 429, { error: "Service busy; retry manually" });
      return;
    }
    active++;
    const operation = requestOperation(request, response, 25_000);
    try {
      const body = record(
        await readJsonBody(request, operation.signal),
        "indexer request",
      );
      assert(body.consent === true, "Address disclosure consent required");
      const network = lightNetwork(body.network);
      const source = new BlockbookSource(network, fetcher, operation.signal);
      if (request.url === "/api/indexer/read") {
        exactKeys(body, ["network", "consent", "path"], "read request");
        assert(
          typeof body.path === "string" && body.path.length <= 256,
          "Invalid read path",
        );
        // BlockbookSource rejects every path outside the fixed read-only allowlist.
        send(response, 200, await source.get(body.path));
      } else {
        exactKeys(
          body,
          ["network", "consent", "rawTx", "expectedTxid"],
          "broadcast request",
        );
        assert(
          typeof body.rawTx === "string" &&
            body.rawTx.length <= 100_000 &&
            /^[0-9a-f]+$/.test(body.rawTx),
          "Invalid signed transaction",
        );
        const tx = parseTransaction(body.rawTx);
        assert(
          tx.txid === body.expectedTxid &&
            tx.inputs.length >= 1 &&
            tx.inputs.length <= 16 &&
            tx.inputs.every(
              (input) =>
                input.witness.length === 1 && input.witness[0]!.length === 64,
            ),
          "Expected a signed key-path transaction",
        );
        await source.tip();
        // No retry. A timeout may follow successful submission and must remain ambiguous.
        const upstream = await fetcher(source.base + "/api/v2/sendtx/", {
          method: "POST",
          redirect: "error",
          signal: operation.signal,
          headers: { "content-type": "text/plain" },
          body: body.rawTx,
        });
        assert(upstream.ok, "Indexer broadcast failed; acceptance is unknown");
        const result = record(
          JSON.parse(await readBoundedText(upstream, 10_000)),
          "broadcast result",
        );
        assert(
          result.result === tx.txid,
          "Broadcast response mismatch; acceptance is unknown",
        );
        send(response, 200, { txid: tx.txid });
      }
    } catch {
      // Never reflect input, upstream bodies, addresses, transaction bytes or credentials.
      send(response, 400, {
        error: request.url.endsWith("/broadcast")
          ? "Broadcast could not be confirmed. Keep the exact signed payment and its reservations."
          : "Public data unavailable or invalid. No completed balance update was applied.",
      });
    } finally {
      operation.dispose();
      active--;
    }
  };
}
