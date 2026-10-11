import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("pure-host UI authority, pending signed recovery and modeled two-tab storage boundaries", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--test",
      "--test-reporter=tap",
      "tools/browser-operation-review/operation-boundaries.test.ts",
      "tools/browser-operation-review/storage-serialization.test.ts",
    ],
    {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 30_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const output = (result.stdout + "\n" + result.stderr).replace(
    /data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,
    "[bundled main.ts]",
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.match(output, /# tests 29\b/, output);
  assert.match(output, /# fail 0\b/, output);
});
