/** Independent pure-host CLI storage fault matrix.
 * Actual CLI and PSBT adapter, frozen public signatures, real isolated FileHandles.
 * No native code, browser, device, service endpoint, software signing or live network.
 * Hooks model file-I/O failures; successful fsync is observed, not power-loss proven.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import * as sdk from "@pearl-ledger/sdk";
import {
  networkInfo,
  publicFixture,
  yielded,
} from "../../packages/bitcoin-prl-adapter/test/fixtures.js";

const root = fileURLToPath(new URL("../../", import.meta.url));
const sourcePath = join(root, "apps/cli/src/index.ts");
const fixture = publicFixture();
const protocol = JSON.parse(
  await fs.readFile(
    join(
      root,
      "packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json",
    ),
    "utf8",
  ),
);
const compiled = await build({
  entryPoints: [sourcePath],
  bundle: true,
  write: false,
  platform: "node",
  format: "cjs",
  logLevel: "silent",
  external: ["@pearl-ledger/sdk", "@pearl-ledger/bitcoin-prl-adapter"],
});
const require = createRequire(import.meta.url);
const code = compiled.outputFiles[0]!.text.replace(/^#![^\n]*\n/, "");
const markerKind = "pearl-cli-signing-uncertain";
const failure = (code: string) =>
  Object.assign(new Error(`Synthetic ${code}`), { code });
type Fault =
  | "none"
  | "initial-write"
  | "initial-sync"
  | "directory-sync"
  | "sidecar-directory-sync"
  | "initial-output-write"
  | "initial-output-sync"
  | "signed-write"
  | "signed-partial-write"
  | "signed-zero-write"
  | "signed-sync"
  | "short-writes"
  | "cancel-before-sign"
  | "cancel-after-sign"
  | "cancel-during-write"
  | "final-reject"
  | "final-lost"
  | "replace-output";

type Observations = {
  commands: number;
  signatures: number;
  finalAcks: number;
  outputSynced: boolean;
  before: Map<string, string>;
  created: string[];
  events: string[];
};
async function run(
  fault: Fault,
  prepare?: (output: string, directory: string) => Promise<void>,
) {
  const directory = await fs.mkdtemp(
    join(tmpdir(), "pearl-cli-independent-durability-"),
  );
  const output = join(directory, "signed.json");
  const bundle = join(directory, "bundle.json"),
    account = join(directory, "account.json");
  await fs.writeFile(bundle, JSON.stringify(sdk.bundleToJson(fixture.bundle)));
  await fs.writeFile(
    account,
    JSON.stringify(sdk.accountToJson(fixture.account)),
  );
  await prepare?.(output, directory);
  const state: Observations = {
    commands: 0,
    signatures: 0,
    finalAcks: 0,
    outputSynced: false,
    before: new Map(),
    created: [],
    events: [],
  };
  let complete = false,
    writesAfterComplete = 0,
    directorySyncs = 0;
  let stdout = "",
    stderr = "",
    error: unknown;
  async function findMarkers() {
    const found = new Map<string, string>();
    for (const path of state.created) {
      try {
        const contents = await fs.readFile(path, "utf8");
        if (JSON.parse(contents).kind === markerKind) found.set(path, contents);
      } catch {
        /* A partial output is not accepted as intent. */
      }
    }
    return found;
  }
  const ok = (bytes: Uint8Array = new Uint8Array()) =>
    sdk.concat(bytes, Uint8Array.of(0x90, 0));
  class PublicFixtureTransport {
    async exchange(apdu: Uint8Array) {
      state.commands++;
      state.events.push(`APDU:${sdk.hex(apdu.slice(0, 2))}`);
      if (state.commands === 1) {
        state.before = await findMarkers();
        assert(
          state.before.size > 0,
          "complete pre-sign intent must exist before any APDU",
        );
        assert(
          state.before.has(`${output}.intent.json`),
          "the separately reserved intent must exist before any APDU",
        );
        assert.equal(
          directorySyncs,
          2,
          "both new directory entries must be synced before any APDU",
        );
        for (const path of state.before.keys()) {
          assert(
            state.events.includes(`sync:${path}`),
            "pre-sign intent must have completed fsync",
          );
          assert.equal((await fs.stat(path)).mode & 0o777, 0o600);
        }
        if (fault === "cancel-before-sign") process.emit("SIGINT");
      }
      if (apdu[0] === 0xe1) {
        if (apdu[1] === 6) return ok(networkInfo());
        if (apdu[1] === 5) return ok(fixture.account.masterFingerprint);
        if (apdu[1] === 0)
          return ok(new TextEncoder().encode(protocol.accountXpub));
        assert.equal(sdk.hex(apdu), protocol.signPsbtApduHex);
      } else assert.equal(sdk.hex(apdu), "f801000100");
      if (state.signatures < fixture.signatures.length) {
        const i = state.signatures++;
        if (state.signatures === fixture.signatures.length) {
          complete = true;
          if (fault === "cancel-after-sign") process.emit("SIGINT");
          if (fault === "replace-output") {
            await fs.rename(
              output,
              join(directory, "invocation-owned-output.json"),
            );
            await fs.writeFile(output, "unrelated replacement", { flag: "wx" });
          }
        }
        return sdk.concat(
          yielded(fixture.bundle, fixture.signatures, i),
          Uint8Array.of(0xe0, 0),
        );
      }
      state.finalAcks++;
      assert(
        state.outputSynced,
        "final continuation ACK must follow complete signed-file fsync",
      );
      if (fault !== "replace-output")
        assert.equal(
          JSON.parse(await fs.readFile(output, "utf8")).rawTx,
          fixture.rawTx,
        );
      if (fault === "final-reject") return Uint8Array.of(0x69, 0x85);
      if (fault === "final-lost") throw failure("LOST_ACK");
      return ok();
    }
    async close() {}
  }
  const injectedFs = {
    ...fs,
    async open(
      path: Parameters<typeof fs.open>[0],
      flags: Parameters<typeof fs.open>[1],
      mode?: number,
    ) {
      const handle = await fs.open(path, flags, mode);
      const fullPath = String(path);
      const exclusive = flags === "wx";
      state.events.push(`open:${fullPath}:${flags}`);
      if (exclusive) state.created.push(fullPath);
      return new Proxy(handle, {
        get(target, property) {
          if (property === "truncate")
            return async (size: number) => {
              state.events.push(`truncate:${fullPath}:${complete}`);
              return target.truncate(size);
            };
          if (property === "write")
            return async (
              buffer: Buffer,
              offset: number,
              length: number,
              position: number,
            ) => {
              state.events.push(`write:${fullPath}:${complete}`);
              if (exclusive && !complete && fault === "initial-write")
                throw failure("ENOSPC");
              if (
                fullPath === output &&
                !complete &&
                fault === "initial-output-write"
              )
                throw failure("ENOSPC");
              if (fullPath === output && complete) {
                writesAfterComplete++;
                if (fault === "signed-write") throw failure("ENOSPC");
                if (fault === "signed-zero-write")
                  return { bytesWritten: 0, buffer };
                if (fault === "signed-partial-write" && writesAfterComplete > 1)
                  throw failure("ENOSPC");
                if (fault === "signed-partial-write")
                  length = Math.min(length, 11);
                if (
                  fault === "cancel-during-write" &&
                  writesAfterComplete === 1
                )
                  process.emit("SIGINT");
              }
              if (fault === "short-writes") length = Math.min(length, 17);
              return target.write(buffer, offset, length, position);
            };
          if (property === "sync")
            return async () => {
              if (!exclusive && flags === "r") {
                directorySyncs++;
                if (
                  fault === "directory-sync" ||
                  (fault === "sidecar-directory-sync" && directorySyncs === 2)
                )
                  throw failure("EIO");
              }
              if (exclusive && !complete && fault === "initial-sync")
                throw failure("EIO");
              if (
                fullPath === output &&
                !complete &&
                fault === "initial-output-sync"
              )
                throw failure("EIO");
              if (fullPath === output && complete && fault === "signed-sync")
                throw failure("EIO");
              await target.sync();
              state.events.push(`sync:${fullPath}`);
              if (fullPath === output && complete) state.outputSynced = true;
            };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
  const module = { exports: {} as { main: (args: string[]) => Promise<void> } };
  new Function("require", "module", "exports", code)(
    (name: string) =>
      name === "node:fs/promises"
        ? injectedFs
        : name === "@pearl-ledger/sdk"
          ? { ...sdk, SpeculosTransport: PublicFixtureTransport }
          : require(name),
    module,
    module.exports,
  );
  const savedStdout = process.stdout.write,
    savedStderr = process.stderr.write;
  const interrupts = process.listenerCount("SIGINT");
  process.stdout.write = ((bytes: any) => {
    stdout += String(bytes);
    return true;
  }) as any;
  process.stderr.write = ((bytes: any) => {
    stderr += String(bytes);
    return true;
  }) as any;
  try {
    await module.exports.main([
      "sign",
      bundle,
      account,
      output,
      "synthetic:no-network",
    ]);
  } catch (failure) {
    error = failure;
  } finally {
    process.stdout.write = savedStdout;
    process.stderr.write = savedStderr;
  }
  try {
    assert.equal(
      process.listenerCount("SIGINT"),
      interrupts,
      "SIGINT listener leaked",
    );
    const after = await findMarkers();
    const outputs = new Map<string, string>();
    for (const filename of await fs.readdir(directory)) {
      const path = join(directory, filename);
      if ((await fs.lstat(path)).isFile())
        outputs.set(filename, await fs.readFile(path, "utf8"));
    }
    return {
      ...state,
      directory,
      output,
      after,
      outputs,
      stdout,
      stderr,
      error,
      writesAfterComplete,
    };
  } finally {
    // All artifacts are this test's synthetic public data, below its private mkdtemp root.
    await fs.rm(directory, { recursive: true, force: true });
  }
}
function retainedIntent(result: Awaited<ReturnType<typeof run>>) {
  assert(
    result.after.has(`${result.output}.intent.json`),
    "the independently parseable intent sidecar must survive",
  );
  assert(
    !result.events.some((event) =>
      event.startsWith(`truncate:${result.output}.intent.json:`),
    ),
    "immutable intent must never be truncated",
  );
  for (const [path, bytes] of result.after) {
    assert.equal(
      bytes,
      result.before.get(path),
      "retained intent must be byte-for-byte immutable",
    );
    const marker = JSON.parse(bytes);
    assert.equal(marker.network, fixture.bundle.network);
    assert.deepEqual(marker.bundle, sdk.bundleToJson(fixture.bundle));
  }
}

test("signed success preserves immutable intent and syncs signed bytes before final ACK", async () => {
  const r = await run("none");
  assert.equal(r.error, undefined);
  assert.equal(r.finalAcks, 1);
  assert.equal(JSON.parse(r.outputs.get("signed.json")!).rawTx, fixture.rawTx);
  retainedIntent(r);
});
for (const fault of [
  "initial-write",
  "initial-sync",
  "directory-sync",
  "sidecar-directory-sync",
  "initial-output-write",
  "initial-output-sync",
] as const) {
  test(`${fault}: fail closed before any APDU`, async () => {
    const r = await run(fault);
    assert(r.error);
    assert.equal(r.commands, 0);
    assert.equal(r.signatures, 0);
    assert.equal(r.finalAcks, 0);
    assert.doesNotMatch(r.stdout, /"saved"/);
  });
}
for (const fault of [
  "signed-write",
  "signed-partial-write",
  "signed-zero-write",
  "signed-sync",
] as const) {
  test(`${fault}: preserve intent, expose exact typed recovery bytes and withhold final ACK`, async () => {
    const r = await run(fault);
    assert(r.error);
    assert.equal(r.signatures, fixture.signatures.length);
    assert.equal(r.finalAcks, 0);
    assert.match(r.stderr, /SIGNED TRANSACTION RECOVERY/);
    assert(r.stderr.includes(fixture.rawTx));
    assert.doesNotMatch(r.stdout, /"saved"/);
    retainedIntent(r);
  });
}
test("short positive writes are completed and synced before final ACK", async () => {
  const r = await run("short-writes");
  assert.equal(r.error, undefined);
  assert(r.writesAfterComplete > 2);
  assert.equal(r.finalAcks, 1);
  assert.equal(JSON.parse(r.outputs.get("signed.json")!).rawTx, fixture.rawTx);
  retainedIntent(r);
});
test("cancellation before signatures retains uncertainty and sends no continuation", async () => {
  const r = await run("cancel-before-sign");
  assert(r.error);
  assert.equal(r.signatures, 0);
  assert.equal(r.finalAcks, 0);
  retainedIntent(r);
});
for (const fault of [
  "cancel-after-sign",
  "cancel-during-write",
  "final-reject",
  "final-lost",
] as const) {
  test(`${fault}: exact signed bytes stay durable and result reports unconfirmed acknowledgement`, async () => {
    const r = await run(fault);
    assert.equal(r.error, undefined);
    assert(r.outputSynced);
    assert.equal(
      JSON.parse(r.outputs.get("signed.json")!).rawTx,
      fixture.rawTx,
    );
    assert.match(r.stdout, /device-acknowledgement-unconfirmed/);
    assert.match(r.stderr, /final device acknowledgement was not confirmed/);
    assert.equal(r.finalAcks, fault.startsWith("cancel") ? 0 : 1);
    retainedIntent(r);
  });
}
test("descriptor write never overwrites an unrelated replacement output path", async () => {
  const r = await run("replace-output");
  assert.equal(r.outputs.get("signed.json"), "unrelated replacement");
  assert.equal(
    JSON.parse(r.outputs.get("invocation-owned-output.json")!).rawTx,
    fixture.rawTx,
  );
  retainedIntent(r);
});
for (const kind of [
  "existing",
  "symlink",
  "dangling-symlink",
  "directory",
] as const) {
  test(`${kind} output collision fails before any APDU without overwriting user data`, async () => {
    const r = await run("none", async (output, dir) => {
      if (kind === "existing") await fs.writeFile(output, "unrelated data");
      else if (kind === "directory") await fs.mkdir(output);
      else {
        const target = join(dir, "unrelated.json");
        if (kind === "symlink") await fs.writeFile(target, "unrelated data");
        await fs.symlink(target, output);
      }
    });
    assert(r.error);
    assert.equal(r.commands, 0);
    if (kind === "existing")
      assert.equal(r.outputs.get("signed.json"), "unrelated data");
    if (kind === "symlink")
      assert.equal(r.outputs.get("unrelated.json"), "unrelated data");
    if (kind === "dangling-symlink") assert(!r.outputs.has("unrelated.json"));
  });
}

for (const kind of [
  "existing",
  "symlink",
  "dangling-symlink",
  "directory",
] as const) {
  test(`${kind} intent-sidecar collision fails before any APDU without overwriting user data`, async () => {
    const r = await run("none", async (output, dir) => {
      const sidecar = `${output}.intent.json`;
      if (kind === "existing")
        await fs.writeFile(sidecar, "unrelated intent-named data");
      else if (kind === "directory") await fs.mkdir(sidecar);
      else {
        const target = join(dir, "unrelated-intent-target.json");
        if (kind === "symlink")
          await fs.writeFile(target, "unrelated intent-named data");
        await fs.symlink(target, sidecar);
      }
    });
    assert(r.error);
    assert.equal(r.commands, 0);
    assert.equal(r.finalAcks, 0);
    assert.equal(
      r.outputs.get("signed.json"),
      "",
      "reserved output is retained conservatively; no path cleanup",
    );
    if (kind === "existing")
      assert.equal(
        r.outputs.get("signed.json.intent.json"),
        "unrelated intent-named data",
      );
    if (kind === "symlink")
      assert.equal(
        r.outputs.get("unrelated-intent-target.json"),
        "unrelated intent-named data",
      );
    if (kind === "dangling-symlink")
      assert(!r.outputs.has("unrelated-intent-target.json"));
  });
}
