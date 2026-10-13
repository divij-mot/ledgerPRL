import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("UI keeps fees explicit and restored drafts must pass policy before signing", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./fee-policy.mjs", import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    result.stdout.split("\n").filter((line) => line.startsWith("PASS:")).length,
    11,
    result.stdout,
  );
});
