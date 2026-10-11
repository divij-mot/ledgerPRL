import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
test("mocked source/storage scheduling: actual UI total budgets and cancellation reject stale public results", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./public-lifecycle.mjs", import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 15_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const diagnostic = (result.stdout + "\n" + result.stderr).replace(
    /data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,
    "[bundled main.ts]",
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, diagnostic);
  assert.equal(
    result.stdout.split("\n").filter((line) => line.startsWith("PASS:")).length,
    5,
    diagnostic,
  );
});
