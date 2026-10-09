import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveConfig } from "vite";
import { fileURLToPath } from "node:url";

test("development and preview reject framing and retain the node bridge proxy", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const config = await resolveConfig({ root }, "serve");
  for (const server of [config.server, config.preview]) {
    assert.equal(
      server.headers?.["Content-Security-Policy"],
      "frame-ancestors 'none'",
    );
    assert.equal(server.headers?.["X-Frame-Options"], "DENY");
    assert.equal(server.host, "127.0.0.1");
    assert.equal(server.strictPort, true);
    const proxy = server.proxy?.["^/api/(check|reconcile|broadcast)$"];
    assert.ok(proxy && typeof proxy !== "string");
    assert.equal(proxy.target, "http://127.0.0.1:8787");
    assert.equal(proxy.changeOrigin, false);
  }
});
