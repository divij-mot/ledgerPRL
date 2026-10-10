/** Actual launcher entry bundled against fake server/process/opener; no sockets, browser or helper. */
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";

let serial = 0;
async function load(open: boolean, platform = "darwin") {
  const events: string[] = [],
    calls: unknown[][] = [],
    handlers = new Map<string, () => void>();
  let listening: (() => void) | undefined;
  const state = {
    process: {
      env: open ? { PEARL_OPEN_BROWSER: "1" } : {},
      platform,
      exitCode: 0,
      on(name: string, callback: () => void) {
        handlers.set(name, callback);
      },
      exit() {
        events.push("exit");
      },
    },
    server: {
      listen(port: number, host: string, callback: () => void) {
        assert.equal(port, 5188);
        assert.equal(host, "127.0.0.1");
        listening = callback;
      },
      on(name: string, callback: () => void) {
        handlers.set(name, callback);
      },
      closeAllConnections() {
        events.push("close-connections");
      },
      close(callback: () => void) {
        events.push("close-server");
        callback();
      },
    },
    light: {
      middleware() {},
      async stop() {
        events.push("stop-helper");
      },
    },
    execFile(...args: unknown[]) {
      calls.push(args);
    },
  };
  (globalThis as any).__pearlLocalEntryTest = state;
  const compiled = await build({
    entryPoints: [
      fileURLToPath(new URL("../src/local-main.ts", import.meta.url)),
    ],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    logLevel: "silent",
    define: {
      "import.meta.url": JSON.stringify(
        "file:///fixture/apps/companion/src/local-main.ts",
      ),
      process: "__testProcess",
    },
    banner: {
      js: `const __testProcess=globalThis.__pearlLocalEntryTest.process; // ${serial++}`,
    },
    plugins: [
      {
        name: "isolated-entry-boundaries",
        setup(b) {
          b.onResolve(
            {
              filter:
                /^(?:\.\/web-server\.js|\.\/local-service\.js|node:child_process)$/,
            },
            (args) => ({ path: args.path, namespace: "fixture" }),
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
            loader: "js",
            contents: args.path.includes("web-server")
              ? "export async function createWalletServer(){return globalThis.__pearlLocalEntryTest.server}"
              : args.path.includes("local-service")
                ? "export function createLocalLightService(){return globalThis.__pearlLocalEntryTest.light}"
                : "export const execFile=globalThis.__pearlLocalEntryTest.execFile",
          }));
        },
      },
    ],
  });
  await import(
    `data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0]!.text).toString("base64")}`
  );
  return { calls, handlers, state, events, listen: () => listening!() };
}

test("launcher flag opens only the fixed WebHID URL after successful server listen", async () => {
  for (const platform of ["darwin", "linux"]) {
    const t = await load(true, platform);
    assert.equal(t.calls.length, 0);
    t.listen();
    assert.equal(t.calls.length, 1);
    assert.deepEqual(t.calls[0]!.slice(0, 3), [
      platform === "darwin" ? "open" : "xdg-open",
      ["http://127.0.0.1:5188/"],
      { timeout: 5000 },
    ]);
    (t.calls[0]![3] as (error: Error) => void)(new Error("No opener"));
    assert.equal(t.state.process.exitCode, 0);
  }
});

test("ordinary npm start and failed bind never open a browser; owned shutdown is retained", async () => {
  const ordinary = await load(false);
  ordinary.listen();
  assert.equal(ordinary.calls.length, 0);
  const failed = await load(true);
  failed.handlers.get("error")!();
  assert.equal(failed.calls.length, 0);
  assert.equal(failed.state.process.exitCode, 1);
  const owned = await load(true);
  owned.handlers.get("SIGINT")!();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(owned.events, [
    "close-connections",
    "close-server",
    "stop-helper",
    "exit",
  ]);
  assert.equal(owned.calls.length, 0);
});
