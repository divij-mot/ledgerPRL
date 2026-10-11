import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const paths = new Map([
  ["/snap.manifest.json", ["snap.manifest.json", "application/json"]],
  ["/dist/snap.js", ["dist/snap.js", "application/javascript"]],
]);
// Static exact-file server only. No signing, uploads, dynamic routes, or arbitrary filesystem access.
const server = createServer(async (req, res) => {
  if (req.headers.host !== "127.0.0.1:8087") {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const target = paths.get(req.url);
  if (!target) {
    res.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(resolve(root, target[0]));
    res.writeHead(200, {
      "content-type": target[1],
      "access-control-allow-origin": "*",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(503).end("Build the local Snap before serving it.");
  }
});
server.listen(8087, "127.0.0.1", () =>
  console.log(
    "Local Snap source: http://127.0.0.1:8087. MetaMask Flask only; never an RPC signing server.",
  ),
);
const demoFiles = new Map([
  ["/", ["dist/index.html", "text/html"]],
  ["/demo.js", ["dist/demo.js", "application/javascript"]],
  ["/demo.css", ["dist/demo.css", "text/css"]],
]);
const demoServer = createServer(async (req, res) => {
  if (req.headers.host !== "127.0.0.1:4173") {
    res.writeHead(403).end();
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405).end();
    return;
  }
  const target = demoFiles.get(req.url);
  if (!target) {
    res.writeHead(404).end();
    return;
  }
  try {
    const bytes = await readFile(resolve(root, target[0]));
    res.writeHead(200, {
      "content-type": target[1],
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'none'; connect-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
    });
    res.end(req.method === "HEAD" ? undefined : bytes);
  } catch {
    res.writeHead(503).end("Build the demo before serving it.");
  }
});
demoServer.listen(4173, "127.0.0.1", () =>
  console.log("Separate-origin PRL site demo: http://127.0.0.1:4173"),
);
