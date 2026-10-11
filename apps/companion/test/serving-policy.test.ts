import { test } from "node:test";
import assert from "node:assert/strict";
import { build, createServer, resolveConfig } from "vite";
import { fileURLToPath } from "node:url";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));

function stylesheetHref(html: string): string {
  const links = [...html.matchAll(/<link\b[^>]*>/g)]
    .map(([tag]) => tag)
    .filter((tag) => /\brel="stylesheet"/.test(tag));
  assert.equal(links.length, 1, "the page must load one external stylesheet");
  const [link] = links;
  assert.ok(link);
  const href = link.match(/\bhref="([^"]+)"/)?.[1];
  assert.ok(href, "the stylesheet must have a URL");
  assert.doesNotMatch(html, /<style\b/i, "styles must not require inline CSS");
  assert.match(html, /style-src 'self';/, "retain the strict style policy");
  assert.match(html, /worker-src 'self';/, "workers remain same-origin only");
  assert.doesNotMatch(html, /'unsafe-inline'/);
  return href;
}

test("development and preview reject framing and retain the node bridge proxy", async () => {
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

test("development serves the linked stylesheet as CSS under the strict CSP", async (t) => {
  const cacheDir = await mkdtemp(join(tmpdir(), "pearl-vite-styles-"));
  const vite = await createServer({
    root,
    cacheDir,
    logLevel: "silent",
    server: {
      middlewareMode: true,
      hmr: false,
      watch: { ignored: ["**/*"] },
      preTransformRequests: false,
    },
    optimizeDeps: { noDiscovery: true, include: [] },
  });
  const http = createHttpServer(vite.middlewares);
  t.after(async () => {
    if (http.listening) {
      await new Promise<void>((resolve, reject) =>
        http.close((error) => (error ? reject(error) : resolve())),
      );
    }
    await vite.close();
    await rm(cacheDir, { recursive: true, force: true });
  });
  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(0, "127.0.0.1", resolve);
  });
  const address = http.address();
  assert.ok(address && typeof address !== "string");
  const origin = `http://127.0.0.1:${address.port}`;
  const page = await fetch(origin, { headers: { Accept: "text/html" } });
  assert.equal(page.status, 200);
  assert.equal(page.headers.get("x-frame-options"), "DENY");
  assert.equal(
    page.headers.get("content-security-policy"),
    "frame-ancestors 'none'",
  );
  const href = stylesheetHref(await page.text());
  assert.equal(href, "/src/styles.css");
  const stylesheet = await fetch(new URL(href, origin), {
    headers: { Accept: "text/css" },
  });
  assert.equal(stylesheet.status, 200);
  assert.match(stylesheet.headers.get("content-type") ?? "", /^text\/css\b/);
  const css = await stylesheet.text();
  assert.match(css, /\.main\s*\{/);
  assert.doesNotMatch(css, /__vite__updateStyle/);
  const source = await readFile(join(root, "src/main.ts"), "utf8");
  assert.doesNotMatch(source, /import\s*["'][^"']*\.css["']/);
  const entry = await fetch(`${origin}/src/main.ts`);
  assert.equal(entry.status, 200);
  const validator = await fetch(`${origin}/src/backup-import.ts`);
  assert.equal(validator.status, 200);
  const validatorSource = await validator.text();
  assert.match(
    validatorSource,
    /\/src\/backup-import\.worker\.ts\?worker_file&type=module/,
  );
  assert.doesNotMatch(
    validatorSource.split("//# sourceMappingURL=")[0]!,
    /blob:|data:/,
  );
  const worker = await fetch(
    `${origin}/src/backup-import.worker.ts?worker_file&type=module`,
  );
  assert.equal(worker.status, 200);
  assert.match(await worker.text(), /importWalletBackup/);
  assert.doesNotMatch(
    await entry.text(),
    /import\s*["'][^"']*\.css(?:\?[^"']*)?["']/,
    "the entry must not use Vite's inline CSS-injection path",
  );
});

test("production keeps the strict CSP and emits a linked CSS asset", async () => {
  const result = await build({
    root,
    logLevel: "silent",
    build: { write: false },
  });
  assert.ok(!Array.isArray(result) && "output" in result);
  const output = result.output;
  const html = output.find((item) => item.fileName === "index.html");
  assert.ok(html && html.type === "asset");
  const href = stylesheetHref(String(html.source));
  assert.match(href, /^\/assets\/[^/]+\.css$/);
  const css = output.find((item) => `/${item.fileName}` === href);
  assert.ok(css && css.type === "asset");
  assert.match(String(css.source), /\.main\{/);
  const workers = output.filter((item) =>
    /^assets\/backup-import\.worker-[^/]+\.js$/.test(item.fileName),
  );
  assert.equal(workers.length, 1, "emit one external validation worker");
  const worker = workers[0]!;
  assert.equal(worker.type, "asset");
  for (const name of ["index.html", "live.html"]) {
    const page = output.find((item) => item.fileName === name);
    assert.ok(page && page.type === "asset");
    stylesheetHref(String(page.source));
    const script = String(page.source).match(
      /src="(\/assets\/[^\"]+\.js)"/,
    )?.[1];
    assert.ok(script);
    const reachable = new Set<string>();
    const modules: string[] = [];
    let code = "";
    function visit(file: string): void {
      if (reachable.has(file)) return;
      reachable.add(file);
      const chunk = output.find((item) => item.fileName === file);
      if (!chunk || chunk.type !== "chunk") return;
      code += chunk.code;
      modules.push(...Object.keys(chunk.modules));
      for (const dependency of [...chunk.imports, ...chunk.dynamicImports])
        visit(dependency);
    }
    visit(script.slice(1));
    assert.ok(code.includes(`/${worker.fileName}`));
    assert.match(code, /type:"module"/);
    const moduleNames = modules.join("\n");
    if (name === "live.html") {
      assert.match(moduleNames, /wallet-api-client/);
      assert.doesNotMatch(
        moduleNames,
        /device-management-kit|device-transport-kit-web-hid|src\/ledger\.ts/,
      );
    } else {
      assert.match(moduleNames, /device-transport-kit-web-hid/);
      assert.doesNotMatch(moduleNames, /wallet-api-client|src\/wallet-api\.ts/);
    }
  }
  if (worker.type === "asset")
    assert.match(
      String(worker.source),
      /Restored signed transaction fails independent signature\/byte verification/,
    );
});
