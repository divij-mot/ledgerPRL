/** Real-filesystem regression for interrupted signed-output replacement. All signatures are public fixtures. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { fork } from "node:child_process";
import { mkdtemp, readFile, writeFile, stat, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const childPath = fileURLToPath(new URL("./cli-storage-child.mts", import.meta.url));
const fixture = JSON.parse(await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"));
async function run(mode: string) {
  const dir = await mkdtemp(join(tmpdir(), "pearl-cli-storage-gap-"));
  const bundle = join(dir, "bundle.json"), account = join(dir, "account.json"), output = join(dir, "output.json");
  await writeFile(bundle, JSON.stringify(fixture.bundle));
  await writeFile(account, JSON.stringify(fixture.publicAccount));
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(childPath, [mode, bundle, account, output], {
    cwd: root, env, execArgv: ["--import", "tsx"], silent: true,
  });
  let stdout = "", stderr = "";
  let checkpoint: any;
  child.stdout!.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr!.on("data", (chunk) => { stderr += String(chunk); });
  child.on("message", (message: any) => {
    checkpoint = message;
    if (message.event === "signed-replacement-truncated") child.kill("SIGKILL");
  });
  const timer = setTimeout(() => child.kill("SIGKILL"), 20_000);
  try {
    const exit = await new Promise<{ code: number | null; signal: string | null }>((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code, signal) => resolve({ code, signal }));
    });
    const bytes = await readFile(output, "utf8").catch((error) => { throw new Error(`Child failed before output: ${stderr} ${stdout}`, { cause: error }); });
    const modeBits = (await stat(output)).mode & 0o777;
    const intent = await readFile(`${output}.intent.json`, "utf8");
    const intentModeBits = (await stat(`${output}.intent.json`)).mode & 0o777;
    return { ...exit, bytes, modeBits, intent, intentModeBits, checkpoint, stdout, stderr };
  } finally {
    clearTimeout(timer);
    await rm(dir, { recursive: true, force: true });
  }
}
test("control: real CLI and adapter save frozen signed bytes before final ACK", async () => {
  const result = await run("complete");
  assert.equal(result.code, 0, result.stderr);
  assert.equal(result.checkpoint.intentSeen, true);
  assert.equal(result.checkpoint.finalAcks, 1);
  assert.equal(result.modeBits, 0o600);
  assert.equal(JSON.parse(result.bytes).rawTx, fixture.rawTx);
  assert.equal(result.intentModeBits, 0o600);
  assert.deepEqual(JSON.parse(result.intent).bundle, fixture.bundle);
  assert.equal(JSON.parse(result.intent).kind, "pearl-cli-signing-uncertain");
});
test("post-truncate write failure preserves immutable intent and exact stderr recovery", async () => {
  const result = await run("fail-signed-write");
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.checkpoint.intentSeen, true);
  assert.equal(result.checkpoint.signatures, fixture.signatures.length);
  assert.equal(result.checkpoint.finalAcks, 0);
  assert.equal(result.bytes, "", "a partial signed output must not be trusted");
  assert.deepEqual(JSON.parse(result.intent).bundle, fixture.bundle);
  assert.equal(JSON.parse(result.intent).kind, "pearl-cli-signing-uncertain");
  assert.equal(result.intentModeBits, 0o600);
  assert.match(result.stderr, /SIGNED TRANSACTION RECOVERY/);
  assert.ok(result.stderr.includes(fixture.rawTx));
  assert.doesNotMatch(result.stdout, /"saved"/);
});
test("process interruption after real truncate retains canonical reconciliation intent", async () => {
  const result = await run("crash-after-truncate");
  assert.equal(result.signal, "SIGKILL");
  assert.equal(result.checkpoint.event, "signed-replacement-truncated");
  assert.equal(result.checkpoint.intentSeen, true);
  assert.equal(result.checkpoint.signatures, fixture.signatures.length);
  assert.equal(result.checkpoint.finalAcks, 0);
  assert.equal(result.bytes, "", "interrupted output is incomplete and must not be trusted");
  assert.deepEqual(JSON.parse(result.intent).bundle, fixture.bundle);
  assert.equal(JSON.parse(result.intent).kind, "pearl-cli-signing-uncertain");
  assert.equal(result.intentModeBits, 0o600);
  assert.doesNotMatch(result.stderr, /SIGNED TRANSACTION RECOVERY/);
  assert.doesNotMatch(result.stdout, /"saved"/);
});
