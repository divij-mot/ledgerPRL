/** Read-only production checks; synthetic candidate files remain in this review folder. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const here = "tools/dependency-supply-review";
test("notices verification accepts exact bytes and rejects a stale distributed file", async () => {
  const temporary = `${here}/.notice-check-${process.pid}.txt`;
  const absolute = path.join(root, temporary);
  const candidate = await fs.readFile(path.join(root, here, "THIRD-PARTY-NOTICES.proposed.txt"));
  const run = () => spawnSync(process.execPath, [`${here}/generate-notices.mjs`, "--check", temporary], { cwd: root, encoding: "utf8" });
  try {
    await fs.writeFile(absolute, candidate);
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    await fs.writeFile(absolute, Buffer.concat([candidate, Buffer.from("\nSTALE-NOTICE-NEGATIVE-CONTROL\n")]));
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Distributed notices are stale/);
  } finally {
    await fs.rm(absolute, { force: true });
  }
});
