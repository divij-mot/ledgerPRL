import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("mock-boundary regression: real DMK/SDK disconnect and journal recovery stay fail-closed", () => {
  const root = fileURLToPath(new URL("../../../", import.meta.url));
  const helper = fileURLToPath(
    new URL("./disconnect-regression.mjs", import.meta.url),
  );
  // Isolate test-only DOM/storage/fetch substitutes from every other test file.
  const result = spawnSync(process.execPath, ["--import", "tsx", helper], {
    cwd: root,
    encoding: "utf8",
    timeout: 15_000,
    maxBuffer: 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(
    result.status,
    0,
    `${result.stdout}\n${result.stderr}`.replace(
      /data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,
      "[bundled main.ts]",
    ),
  );
  assert.equal(
    result.stdout.split("\n").filter((line) => line.startsWith("PASS:")).length,
    5,
    result.stdout,
  );
});
