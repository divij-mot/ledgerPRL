/** Stateless HTTPS adapter. The native light client is deliberately not imported. */
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable, addAbortSignal } from "node:stream";
import { indexerProxy } from "./indexer-proxy.js";
import { requestOperation } from "./operation.js";

const MAX_REQUEST_BYTES = 128 * 1024;
type Environment = Readonly<Record<string, string | undefined>>;

/** Production is explicit; previews may use only Vercel's deployment identity. */
export function hostedOrigin(env: Environment): string {
  let origin = env.PEARL_WEB_ORIGIN;
  if (!origin && env.VERCEL_ENV === "preview") {
    const hostname = env.VERCEL_URL ?? "";
    if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/.test(hostname))
      throw new Error("Invalid preview deployment identity");
    origin = `https://${hostname}`;
  }
  if (!origin) throw new Error("Exact hosted wallet origin is required");
  const url = new URL(origin);
  if (
    url.protocol !== "https:" ||
    url.origin !== origin ||
    url.username ||
    url.password ||
    url.port ||
    !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(url.hostname) ||
    !url.hostname.includes(".") ||
    url.hostname.endsWith(".localhost") ||
    /^\d+(?:\.\d+){3}$/.test(url.hostname)
  )
    throw new Error("Exact public HTTPS wallet origin is required");
  return origin;
}

function reject(response: ServerResponse, status: number, message: string) {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify({ error: message }));
}

/** Shared per-instance concurrency limit lives in the existing fixed allowlist proxy. */
export function createHostedIndexer(
  origin: string,
  fetcher: typeof fetch = fetch,
) {
  origin = hostedOrigin({ PEARL_WEB_ORIGIN: origin });
  const expectedHost = new URL(origin).host;
  const proxy = indexerProxy(origin, fetcher);
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    if (
      !["/api/indexer/read", "/api/indexer/broadcast"].includes(
        request.url ?? "",
      )
    ) {
      reject(response, 404, "Not found");
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("allow", "POST");
      reject(response, 405, "POST required");
      return;
    }
    const one = (name: string) =>
      request.rawHeaders.filter(
        (value, index) => index % 2 === 0 && value.toLowerCase() === name,
      ).length === 1;
    if (
      [
        "host",
        "origin",
        "x-pearl-companion",
        "content-type",
        "content-length",
        "x-forwarded-proto",
      ].some((name) => !one(name)) ||
      request.headers.host !== expectedHost ||
      request.headers.origin !== origin ||
      request.headers["x-pearl-companion"] !== "1" ||
      request.headers["x-forwarded-proto"] !== "https" ||
      (request.headers["sec-fetch-site"] !== undefined &&
        request.headers["sec-fetch-site"] !== "same-origin")
    ) {
      reject(response, 403, "Exact same-origin HTTPS request required");
      return;
    }
    const length = request.headers["content-length"];
    if (
      request.headers["transfer-encoding"] !== undefined ||
      typeof length !== "string" ||
      !/^(?:0|[1-9][0-9]*)$/.test(length)
    ) {
      reject(response, 411, "A bounded request length is required");
      return;
    }
    const size = Number(length);
    if (!Number.isSafeInteger(size) || size < 2 || size > MAX_REQUEST_BYTES) {
      reject(response, 413, "Request size is unsupported");
      return;
    }
    if (
      request.headers["content-type"] !== "application/json" ||
      request.headers["content-encoding"] !== undefined ||
      request.headers.expect !== undefined
    ) {
      reject(response, 415, "Uncompressed JSON required");
      return;
    }
    // @vercel/node's helpers pre-read bodies, before this bound can run. They
    // must be disabled at BUILD time with NODEJS_HELPERS=0. Never accept a
    // parsed req.body or reconstruct JSON: that would change the raw boundary.
    if ("body" in request || request.readableEnded || request.destroyed) {
      reject(response, 503, "Raw request handling is unavailable");
      return;
    }
    const upload = requestOperation(request, response, 5_000);
    let raw: Buffer;
    try {
      const chunks: Buffer[] = [];
      let total = 0;
      for await (const value of addAbortSignal(upload.signal, request)) {
        const chunk = Buffer.from(value);
        total += chunk.length;
        if (total > size || total > MAX_REQUEST_BYTES)
          throw new Error("Invalid body length");
        chunks.push(chunk);
      }
      upload.signal.throwIfAborted();
      if (total !== size) throw new Error("Invalid body length");
      raw = Buffer.concat(chunks, total);
      // The proxy consumes the exact original bytes, but must not normalize
      // malformed UTF-8 to replacement characters during its JSON parse.
      new TextDecoder("utf-8", { fatal: true }).decode(raw);
    } catch {
      reject(response, 400, "Invalid bounded JSON request");
      return;
    } finally {
      upload.dispose();
    }
    const replay = Object.assign(Readable.from([raw]), {
      method: request.method,
      url: request.url,
      headers: request.headers,
      rawHeaders: request.rawHeaders,
    });
    try {
      await proxy(replay as IncomingMessage, response, () =>
        reject(response, 404, "Not found"),
      );
    } catch {
      // Never log or reflect request bodies, addresses, transaction data or upstream errors.
      reject(response, 500, "Request could not be completed");
    } finally {
      replay.destroy();
    }
  };
}

let handler: ReturnType<typeof createHostedIndexer> | undefined;
export async function hostedIndexer(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    handler ??= createHostedIndexer(hostedOrigin(process.env));
  } catch {
    reject(response, 503, "Hosted wallet configuration is unavailable");
    return;
  }
  await handler(request, response);
}
