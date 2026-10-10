import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

test("15 mocked payment/recovery sequences preserve exact bytes and reservations", () => {
  const directory = mkdtempSync(join(tmpdir(), "prl-payment-sequences-"));
  const output = join(directory, "results.json");
  try {
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "tools/payment-sequence-review/sequences.mjs"],
      {
        cwd: fileURLToPath(new URL("../../../", import.meta.url)),
        env: { ...process.env, PRL_SEQUENCE_OUTPUT: output },
        encoding: "utf8",
        timeout: 120_000,
        maxBuffer: 4 * 1024 * 1024,
      },
    );
    const diagnostic = (result.stdout + "\n" + result.stderr).replace(
      /data:text\/javascript;base64,[A-Za-z0-9+/=]+(?:#\d+)?/g,
      "[bundled main.ts]",
    );
    assert.ifError(result.error);
    assert.equal(result.status, 0, diagnostic);
    const report = JSON.parse(readFileSync(output, "utf8"));
    assert.equal(report.sourceUnchanged, true);
    assert.equal(report.passed, 15);
    assert.equal(report.failed, 0);
    assert.equal(report.results.length, 15);
    assert.equal(
      new Set(report.results.map((row: { name: string }) => row.name)).size,
      15,
    );
    for (const row of report.results)
      assert.equal(row.outcome, "pass", row.name);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
