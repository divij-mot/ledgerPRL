import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

test("real DMK timing across five modeled device IDs and one native capture remain distinct", () => {
  const result = spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      fileURLToPath(new URL("./dmk-refresher.mjs", import.meta.url)),
    ],
    {
      cwd: fileURLToPath(new URL("../../../", import.meta.url)),
      encoding: "utf8",
      // This intentionally spans real one-second DMK timer intervals.
      timeout: 60_000,
      maxBuffer: 1024 * 1024,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
  assert.equal(
    result.stdout.split("\n").filter((line) => line.startsWith("PASS ")).length,
    8,
    result.stdout,
  );
  assert.equal(
    result.stdout
      .split("\n")
      .filter((line) => line.startsWith("CONTROL enabled ")).length,
    2,
    result.stdout,
  );
});
