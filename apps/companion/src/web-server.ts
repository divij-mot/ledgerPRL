/** Dedicated HTTPS wallet origin. HTTP is loopback-only behind a trusted TLS proxy. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { lstat, readdir, open, realpath } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { indexerProxy } from "./indexer-proxy.js";

export const WALLET_CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "worker-src 'self'",
  "style-src 'self'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "frame-src 'none'",
].join("; ");
const HEADERS = Object.freeze({
  "Content-Security-Policy": WALLET_CSP,
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy":
    "hid=(self), usb=(), camera=(), microphone=(), geolocation=(), payment=()",
  "Strict-Transport-Security": "max-age=31536000",
  "Cache-Control": "no-store",
});
const TYPES: Readonly<Record<string, string>> = Object.freeze({
  js: "text/javascript; charset=utf-8",
  css: "text/css; charset=utf-8",
  png: "image/png",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  woff: "font/woff",
  woff2: "font/woff2",
});
const ASSET =
  /^[A-Za-z0-9][A-Za-z0-9_.-]*-[A-Za-z0-9_-]{8,}\.(js|css|png|webp|svg|ico|woff|woff2)$/;
const MAX_ASSET_BYTES = 8 * 1024 * 1024;
const MAX_BUILD_BYTES = 32 * 1024 * 1024;
const MAX_API_BYTES = 128 * 1024;

type StaticAsset = { bytes: Buffer; contentType: string };
export interface WalletServerOptions {
  /** One canonical origin, with no trailing slash, credentials, query or fragment. */
  origin: string;
  distDirectory: string;
  /** Dependency injection for deterministic tests; never set by an HTTP parameter. */
  fetcher?: typeof fetch;
}
function requireCondition(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function validateOrigin(origin: string): URL {
  const url = new URL(origin);
  requireCondition(
    url.protocol === "https:" &&
      url.origin === origin &&
      !url.username &&
      !url.password,
    "PEARL_WEB_ORIGIN must be one exact HTTPS origin, without a trailing slash",
  );
  return url;
}

/** Load once, before listening. Request input never becomes a filesystem path. */
async function loadBuild(
  directory: string,
): Promise<ReadonlyMap<string, StaticAsset>> {
  const root = await realpath(directory);
  const assets = new Map<string, StaticAsset>();
  let total = 0;
  async function load(path: string, route: string, contentType: string) {
    const entry = await lstat(path);
    requireCondition(
      entry.isFile() &&
        !entry.isSymbolicLink() &&
        entry.size > 0 &&
        entry.size <= MAX_ASSET_BYTES,
      "Production build contains an invalid or oversized asset",
    );
    const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    let bytes: Buffer;
    try {
      const opened = await file.stat();
      requireCondition(
        opened.isFile() &&
          opened.size === entry.size &&
          opened.ino === entry.ino &&
          opened.dev === entry.dev,
        "Production build changed while loading",
      );
      bytes = Buffer.alloc(entry.size);
      let offset = 0;
      while (offset < bytes.length) {
        const { bytesRead } = await file.read(
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        requireCondition(
          bytesRead > 0,
          "Production build changed while loading",
        );
        offset += bytesRead;
      }
      const extra = await file.read(Buffer.alloc(1), 0, 1, offset);
      requireCondition(
        extra.bytesRead === 0,
        "Production build changed while loading",
      );
    } finally {
      await file.close();
    }
    total += bytes.length;
    requireCondition(
      total <= MAX_BUILD_BYTES,
      "Production build exceeds the memory limit",
    );
    assets.set(route, { bytes, contentType });
  }
  await load(join(root, "index.html"), "/", "text/html; charset=utf-8");
  assets.set("/index.html", assets.get("/")!);
  await load(join(root, "live.html"), "/live.html", "text/html; charset=utf-8");
  await load(
    join(root, "third-party-notices.txt"),
    "/third-party-notices.txt",
    "text/plain; charset=utf-8",
  );
  const assetsDirectory = join(root, "assets");
  const info = await lstat(assetsDirectory);
  requireCondition(
    info.isDirectory() && !info.isSymbolicLink(),
    "Production assets must be a real directory",
  );
  const names = await readdir(assetsDirectory);
  requireCondition(
    names.length <= 128,
    "Production build contains too many assets",
  );
  for (const name of names) {
    const match = ASSET.exec(name);
    if (!match) continue; // Source maps, sources, manifests and unrelated files are never served.
    await load(
      join(assetsDirectory, name),
      `/assets/${name}`,
      TYPES[match[1]!]!,
    );
  }
  for (const entry of ["/", "/live.html"]) {
    const html = assets.get(entry)!.bytes.toString("utf8");
    const linked = [...html.matchAll(/(?:src|href)="(\/[^"\s]+)"/g)].map(
      (match) => match[1]!,
    );
    requireCondition(
      linked.some((path) => path.endsWith(".js")) &&
        linked.some((path) => path.endsWith(".css")) &&
        linked.every((path) => path.startsWith("/assets/") && assets.has(path)),
      "Build first: wallet HTML must refer only to emitted allowlisted assets",
    );
  }
  return assets;
}
function headers(response: ServerResponse) {
  for (const [name, value] of Object.entries(HEADERS))
    response.setHeader(name, value);
}
function reject(
  request: IncomingMessage,
  response: ServerResponse,
  status: number,
  message: string,
) {
  if (response.destroyed || response.writableEnded) return;
  response.statusCode = status;
  response.setHeader("Content-Type", "text/plain; charset=utf-8");
  response.setHeader("Connection", "close");
  response.end(request.method === "HEAD" ? undefined : `${message}\n`);
}
function oneHeader(request: IncomingMessage, name: string): boolean {
  return (
    request.rawHeaders
      .filter((_, index) => index % 2 === 0)
      .filter((value) => value.toLowerCase() === name).length <= 1
  );
}

/** No sessions, cookies, telemetry, access logs, RPC credentials or private-node routes. */
export async function createWalletServer(options: WalletServerOptions) {
  const expected = validateOrigin(options.origin);
  const assets = await loadBuild(options.distDirectory);
  const proxy = indexerProxy(options.origin, options.fetcher);
  const server = createServer(
    {
      maxHeaderSize: 8192,
      requireHostHeader: true,
      connectionsCheckingInterval: 1000,
    },
    (request, response) => {
      headers(response);
      // Do not infer trust from arbitrary Forwarded / X-Forwarded-Host / client-IP values.
      if (
        !oneHeader(request, "host") ||
        !oneHeader(request, "origin") ||
        !oneHeader(request, "x-forwarded-proto") ||
        request.headers.host !== expected.host ||
        request.headers["x-forwarded-proto"] !== "https"
      ) {
        reject(request, response, 421, "Unexpected wallet origin");
        return;
      }
      if (
        request.headers.origin !== undefined &&
        request.headers.origin !== options.origin
      ) {
        reject(request, response, 403, "Same-origin request required");
        return;
      }
      let target = request.url ?? "";
      // Ledger adds these non-authoritative display preferences at launch.
      // Accept only this exact entry and bounded, nonduplicate query keys.
      if (target.startsWith("/live.html?") && target.length <= 128) {
        const query = new URLSearchParams(target.slice("/live.html?".length));
        const pairs = [...query];
        if (
          pairs.length > 0 &&
          pairs.length <= 2 &&
          new Set(pairs.map(([key]) => key)).size === pairs.length &&
          pairs.every(([key, value]) =>
            key === "theme"
              ? /^(light|dark)$/.test(value)
              : key === "lang" && /^[a-z]{2}(?:-[A-Za-z]{2})?$/.test(value),
          )
        )
          target = "/live.html";
      }
      // No decoding/normalizing of hostile paths, queries, encoded slashes, dot segments or absolute URLs.
      if (
        target.length > 512 ||
        !/^\/[A-Za-z0-9/_.-]*$/.test(target) ||
        target.includes("..") ||
        target.includes("//")
      ) {
        reject(request, response, 404, "Not found");
        return;
      }
      if (
        target === "/api/indexer/read" ||
        target === "/api/indexer/broadcast"
      ) {
        if (request.method !== "POST") {
          response.setHeader("Allow", "POST");
          reject(request, response, 405, "Method not allowed");
          return;
        }
        // Browser JSON-string fetches and the documented proxy provide Content-Length.
        // Streaming uploads, multipart forms and compressed bodies are not supported.
        const length = request.headers["content-length"];
        if (
          request.headers["transfer-encoding"] ||
          !length ||
          !/^[0-9]+$/.test(length)
        ) {
          reject(
            request,
            response,
            411,
            "A bounded request length is required",
          );
          return;
        }
        if (Number(length) > MAX_API_BYTES) {
          reject(request, response, 413, "Request too large");
          return;
        }
        if (
          request.headers["content-type"] !== "application/json" ||
          request.headers["content-encoding"]
        ) {
          reject(request, response, 415, "Uncompressed JSON required");
          return;
        }
        void proxy(request, response, () =>
          reject(request, response, 404, "Not found"),
        ).catch(() => reject(request, response, 500, "Request failed"));
        return;
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        response.setHeader("Allow", "GET, HEAD");
        reject(request, response, 405, "Method not allowed");
        return;
      }
      if (
        request.headers["transfer-encoding"] ||
        (request.headers["content-length"] !== undefined &&
          request.headers["content-length"] !== "0")
      ) {
        reject(request, response, 400, "Request body not supported");
        return;
      }
      const asset = assets.get(target);
      if (!asset) {
        reject(request, response, 404, "Not found");
        return;
      }
      response.statusCode = 200;
      response.setHeader("Content-Type", asset.contentType);
      response.setHeader("Content-Length", asset.bytes.length);
      // Never persist wallet HTML or data. Only content-hashed static assets may be cached.
      if (target.startsWith("/assets/"))
        response.setHeader(
          "Cache-Control",
          "public, max-age=31536000, immutable",
        );
      response.end(request.method === "HEAD" ? undefined : asset.bytes);
    },
  );
  server.requestTimeout = 10_000; // Deadline for incoming request headers and body.
  server.headersTimeout = 5_000;
  server.keepAliveTimeout = 5_000;
  server.setTimeout(30_000, (socket) => socket.destroy());
  server.maxHeadersCount = 32;
  server.maxRequestsPerSocket = 100;
  server.maxConnections = 128;
  server.on("checkContinue", (request, response) => {
    headers(response);
    reject(request, response, 417, "Expect is not supported");
  });
  server.on("checkExpectation", (request, response) => {
    headers(response);
    reject(request, response, 417, "Expect is not supported");
  });
  server.on("connect", (_request, socket) => socket.destroy());
  server.on("upgrade", (_request, socket) => socket.destroy());
  return server;
}

async function main() {
  const origin = process.env.PEARL_WEB_ORIGIN ?? "";
  const portText = process.env.PEARL_WEB_PORT ?? "8788";
  requireCondition(/^[0-9]+$/.test(portText), "Invalid PEARL_WEB_PORT");
  const port = Number(portText);
  requireCondition(
    Number.isSafeInteger(port) && port >= 1024 && port <= 65535,
    "Invalid PEARL_WEB_PORT",
  );
  const server = await createWalletServer({
    origin,
    distDirectory: fileURLToPath(new URL("../dist/", import.meta.url)),
  });
  server.on("error", () => {
    console.error(
      "Wallet server failed to listen; check the configured loopback port.",
    );
    process.exitCode = 1;
  });
  server.listen(port, "127.0.0.1", () => {
    console.log(
      `Pearl wallet on loopback port ${port}; trusted HTTPS reverse proxy required.`,
    );
  });
  const stop = () => {
    const timer = setTimeout(() => {
      server.closeAllConnections();
    }, 30_000);
    timer.unref();
    server.close(() => clearTimeout(timer));
  };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  void main().catch(() => {
    // Avoid printing paths, environment values or exception objects from untrusted inputs.
    console.error(
      "Wallet server startup failed. Check HTTPS origin, port and production build.",
    );
    process.exitCode = 1;
  });
}
