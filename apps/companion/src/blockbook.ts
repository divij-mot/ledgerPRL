import { requestOperation, readJsonBody } from "./operation.js";
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  accountFromJson,
  assert,
  deriveAddress,
  hex,
  NETWORKS,
  type NetworkName,
  parseTransaction,
} from "@pearl-ledger/sdk";
import { readBoundedText, readBoundedJson } from "@pearl-ledger/sdk";
import {
  type WatchSource,
  type AddressActivity,
  type PublicTransaction,
  type WatchSnapshot,
  type ChainValidation,
  type ValidationCoin,
  record,
  safeInteger,
  hash,
  chainTip,
  parseWatchSnapshot,
  snapshotToJson,
  discoverAccount,
  outpoint,
  MAX_HISTORY_TRANSACTIONS,
  MAX_RAW_HISTORY_HEX,
  MAX_HISTORY_REFERENCES,
  exactKeys,
} from "@pearl-ledger/wallet";
import { verifyBroadcastPayload } from "./bridge.js";

import {
  BlockbookSource,
  checkLightSnapshot,
  lightNetwork,
} from "./blockbook-source.js";
export {
  BlockbookSource,
  checkLightSnapshot,
  BLOCKBOOK_HOSTS,
  lightNetwork,
} from "./blockbook-source.js";

function send(response: ServerResponse, status: number, body: unknown) {
  if (response.destroyed || response.writableEnded) return;
  const text = JSON.stringify(body);
  assert(
    new TextEncoder().encode(text).length <= 4 * 1024 * 1024,
    "Response exceeds 4 MiB; scan incomplete",
  );
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(text);
}
export function lightMiddleware(origin = "http://127.0.0.1:5173") {
  const expected = new URL(origin);
  assert(
    ["127.0.0.1", "localhost"].includes(expected.hostname),
    "Light bridge must be served on loopback",
  );
  let busy = false;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!request.url?.startsWith("/api/light/")) {
      next();
      return;
    }
    if (
      request.method !== "POST" ||
      request.headers.origin !== origin ||
      request.headers.host !== expected.host ||
      request.headers["x-pearl-companion"] !== "1"
    ) {
      send(response, 403, { error: "Local companion origin required" });
      return;
    }
    if (
      ![
        "/api/light/discover",
        "/api/light/check",
        "/api/light/broadcast",
      ].includes(request.url)
    ) {
      send(response, 404, { error: "Unsupported light route" });
      return;
    }
    if (busy) {
      send(response, 409, {
        error: "Public indexer request already active; wait for it to finish",
      });
      return;
    }
    busy = true;
    const operation = requestOperation(
      request,
      response,
      request.url.endsWith("/discover") ? 295_000 : 85_000,
    );
    try {
      const body = record(
        await readJsonBody(request, operation.signal),
        "request",
      );
      assert(
        body.consent === true,
        "Explicit public address disclosure consent is required",
      );
      const network = lightNetwork(body.network),
        source = new BlockbookSource(network, fetch, operation.signal);
      if (request.url === "/api/light/discover") {
        exactKeys(
          body,
          ["network", "consent", "account", "minimumIndex"],
          "discovery request",
        );
        const account = accountFromJson(body.account);
        assert(account.network === network, "Account network mismatch");
        assert(
          Array.isArray(body.minimumIndex) && body.minimumIndex.length === 2,
          "Invalid scan bounds",
        );
        const minimumIndex = body.minimumIndex.map((v) => {
          assert(
            typeof v === "number" && Number.isInteger(v) && v >= -1 && v < 980,
            "Scan recovery bounds exceeded",
          );
          return v;
        }) as [number, number];
        const result = await discoverAccount(source, account, { minimumIndex });
        parseWatchSnapshot(snapshotToJson(result.snapshot));
        send(response, 200, {
          snapshot: JSON.parse(snapshotToJson(result.snapshot)),
          validation: result.validation,
          history: result.history.map((h) => ({
            ...h,
            received: h.received.toString(),
            spent: h.spent.toString(),
          })),
          complete: true,
          lastUsed: result.lastUsed,
        });
      } else if (request.url === "/api/light/check") {
        exactKeys(
          body,
          ["network", "consent", "snapshot"],
          "input-check request",
        );
        const snapshot = parseWatchSnapshot(JSON.stringify(body.snapshot));
        send(response, 200, await checkLightSnapshot(source, snapshot));
      } else {
        exactKeys(body, ["network", "consent", "payment"], "broadcast request");
        const tx = verifyBroadcastPayload(network, body.payment);
        await source.tip();
        // No automatic retry: timeout/rejection is an ambiguous broadcast state in the UI.
        const responseUpstream = await fetch(source.base + "/api/v2/sendtx/", {
          method: "POST",
          redirect: "error",
          signal: AbortSignal.any([
            operation.signal,
            AbortSignal.timeout(20_000),
          ]),
          headers: { "content-type": "text/plain" },
          body: tx.rawTx,
        });
        assert(
          responseUpstream.ok,
          `Indexer broadcast returned HTTP ${responseUpstream.status}; acceptance is unknown`,
        );
        const text = await readBoundedText(responseUpstream, 10_000);
        assert(text.length < 10_000, "Unexpected broadcast response");
        const result = record(JSON.parse(text), "broadcast response");
        assert(
          result.result === tx.txid,
          "Indexer broadcast response mismatch; acceptance is unknown",
        );
        send(response, 200, { txid: tx.txid });
      }
    } catch (error) {
      send(response, 400, {
        error:
          error instanceof Error
            ? error.message
            : "Public indexer request failed",
      });
    } finally {
      operation.dispose();
      busy = false;
    }
  };
}
