import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("pure-host device identity gates and failed-session receive verification", () => {
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
      "tools/device-identity-review/identity-gates.test.ts",
      "tools/device-identity-review/receive-session-regression.test.ts",
    ],
    {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 45_000,
      maxBuffer: 4 * 1024 * 1024,
    },
  );
  const output = (result.stdout + "\n" + result.stderr).replace(
    /data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,
    "[bundled main.ts]",
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, output);
  assert.match(output, /# tests 35\b/, output);
  assert.match(output, /# fail 0\b/, output);
});
