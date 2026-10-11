import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("hosted wallet fees, Max, QR cancellation and cached-view authority", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "tools/hosted-wallet-review/ui.test.ts",
      "tools/hosted-wallet-review/qr-cache.test.ts",
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      env,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    (result.stdout + result.stderr).replace(
      /data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,
      "[bundled main.ts]",
    ),
  );
});
