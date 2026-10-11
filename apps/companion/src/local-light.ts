/** Same-origin, loopback-only access to the private watch-only process. */
import type { IncomingMessage, ServerResponse } from "node:http";
import {
  accountFromJson,
  assert,
  decodeBundle,
  fromHex,
  validateBundle,
} from "@pearl-ledger/sdk";
import {
  accountId,
  exactKeys,
  record,
  safeInteger,
} from "@pearl-ledger/wallet";
import { verifyBroadcastPayload } from "./bridge.js";
import { readJsonBody, requestOperation } from "./operation.js";
import type { LocalLightRuntime } from "./light-runtime.js";

type Runtime = Pick<LocalLightRuntime, "start" | "status" | "request" | "stop">;
function send(response: ServerResponse, status: number, value: unknown) {
  if (response.destroyed || response.writableEnded) return;
  const body = JSON.stringify(value);
  assert(
    Buffer.byteLength(body) <= 4 * 1024 * 1024,
    "Local response exceeds its limit",
  );
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}
const ROUTES = [
  "start",
  "status",
  "snapshot",
  "register",
  "blockHash",
  "broadcast",
  "close",
] as const;

export function localLightMiddleware(
  origin: string,
  runtime: () => Promise<Runtime>,
) {
  const expected = new URL(origin);
  assert(
    expected.origin === origin &&
      expected.protocol === "http:" &&
      expected.hostname === "127.0.0.1",
    "Local wallet requires an exact loopback origin",
  );
  let account: ReturnType<typeof accountFromJson> | undefined;
  let running = false;
  return async (
    request: IncomingMessage,
    response: ServerResponse,
    next: () => void,
  ) => {
    if (!request.url?.startsWith("/api/local/")) return next();
    const unique = (name: string) =>
      request.rawHeaders.filter(
        (_, index) =>
          index % 2 === 0 && request.rawHeaders[index]!.toLowerCase() === name,
      ).length === 1;
    if (
      request.method !== "POST" ||
      request.headers.host !== expected.host ||
      request.headers.origin !== origin ||
      request.headers["x-pearl-companion"] !== "1" ||
      request.headers["content-type"] !== "application/json" ||
      [
        "host",
        "origin",
        "x-pearl-companion",
        "content-type",
        "content-length",
      ].some((name) => !unique(name)) ||
      request.headers["transfer-encoding"] ||
      (request.headers["sec-fetch-site"] &&
        request.headers["sec-fetch-site"] !== "same-origin")
    ) {
      send(response, 403, { error: "Local wallet origin required" });
      return;
    }
    const action = request.url.slice("/api/local/".length);
    if (!(ROUTES as readonly string[]).includes(action)) {
      send(response, 404, { error: "Unsupported local operation" });
      return;
    }
    const size = Number(request.headers["content-length"]);
    if (!Number.isSafeInteger(size) || size < 2 || size > 32 * 1024) {
      send(response, 413, { error: "Local request exceeds its limit" });
      return;
    }
    if (running) {
      send(response, 409, {
        error: "Local wallet is busy; retry when it finishes",
      });
      return;
    }
    running = true;
    const operation = requestOperation(request, response, 45_000);
    try {
      const body = record(
        await readJsonBody(request, operation.signal),
        "local request",
      );
      if (action === "close" && !account) {
        exactKeys(body, ["owner"], "local close");
        assert(
          typeof body.owner === "string" &&
            /^mainnet:0:[0-9a-f]{64}$/.test(body.owner),
          "Invalid local account owner",
        );
        // The request mutex excludes an in-flight start. An initialization
        // failure can leave the browser owning an attempt with no profile.
        send(response, 200, { closed: true });
        return;
      }
      const client = await runtime();
      if (action === "start") {
        exactKeys(body, ["account", "minimumIndex"], "local start");
        const nextAccount = accountFromJson(body.account);
        assert(
          nextAccount.network === "mainnet" && nextAccount.account === 0,
          "Local sync supports the first mainnet account",
        );
        const minimum = bounds(body.minimumIndex);
        const state = client.status().state;
        if (state === "running")
          assert(
            account && accountId(account) === accountId(nextAccount),
            "Another account is syncing locally",
          );
        else {
          assert(
            state === "stopped" || state === "failed",
            "Local wallet is starting",
          );
          if (state === "failed") await client.stop();
          operation.signal.throwIfAborted();
          await client.start(nextAccount, minimum);
          account = nextAccount;
        }
        send(
          response,
          200,
          await client.request("status", {}, operation.signal),
        );
      } else {
        assert(
          account && body.owner === accountId(account),
          "Local account changed; reconnect sync",
        );
        if (action === "close") {
          exactKeys(body, ["owner"], "local close");
          await client.stop();
          account = undefined;
          send(response, 200, { closed: true });
        } else if (action === "broadcast") {
          exactKeys(body, ["owner", "payment"], "local broadcast");
          const payment = record(body.payment, "signed payment");
          const signed = verifyBroadcastPayload(account.network, payment);
          validateBundle(
            decodeBundle(fromHex(payment.bundleHex as string)),
            account,
          );
          send(
            response,
            200,
            await client.request(
              "broadcast",
              { rawTransaction: signed.rawTx, expectedTxid: signed.txid },
              operation.signal,
            ),
          );
        } else if (action === "blockHash") {
          exactKeys(body, ["owner", "height"], "local block");
          send(
            response,
            200,
            await client.request(
              "blockHash",
              { height: safeInteger(body.height, 0x7fffffff) },
              operation.signal,
            ),
          );
        } else if (action === "register") {
          exactKeys(body, ["owner", "minimumIndex"], "local recovery");
          const minimum = bounds(body.minimumIndex);
          const result = record(
            await client.request(
              "register",
              { minimumIndex: minimum },
              operation.signal,
            ),
            "local recovery result",
          );
          if (result.restartRequired === true) {
            // The native wallet rewinds only after its old scan workers stop.
            // A new child ensures no old completion notification can mark the rescan ready.
            await client.stop();
            operation.signal.throwIfAborted();
            await client.start(account, minimum);
            send(
              response,
              200,
              await client.request("status", {}, operation.signal),
            );
          } else send(response, 200, result);
        } else {
          exactKeys(body, ["owner"], "local read");
          assert(
            action === "status" || action === "snapshot",
            "Unsupported local read",
          );
          send(
            response,
            200,
            await client.request(action, {}, operation.signal),
          );
        }
      }
    } catch (error) {
      send(response, 400, {
        error:
          error instanceof Error ? error.message : "Local sync unavailable",
      });
    } finally {
      operation.dispose();
      running = false;
    }
  };
}

function bounds(value: unknown): [number, number] {
  assert(
    Array.isArray(value) &&
      value.length === 2 &&
      value.every((n) => Number.isInteger(n) && n >= -1 && n <= 979),
    "Invalid local recovery bounds",
  );
  return [value[0] as number, value[1] as number];
}
