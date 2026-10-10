/** Process boundaries are mocked; these tests do not execute native crypto, SPV or a wallet. */
import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { accountToJson, NETWORKS } from "@pearl-ledger/sdk";
import { publicAccount } from "../../../packages/wallet/test/fixtures.js";
import {
  createLightRuntime,
  LIGHT_SOURCE_COMMIT,
  LocalLightRequestError,
  type LightMethod,
} from "../src/light-runtime.js";
const account = { ...publicAccount, network: "mainnet" as const };
class Child extends EventEmitter {
  stdin = new PassThrough();
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 8_000_000;
  exitCode: number | null = null;
  signals: string[] = [];
  ignoreTerm = false;
  ignoreKill = false;
  finish(code = 0) {
    if (this.exitCode !== null) return;
    this.exitCode = code;
    this.emit("close", code, null);
  }
  kill(signal = "SIGTERM") {
    this.signals.push(signal);
    if (!(signal === "SIGTERM" ? this.ignoreTerm : this.ignoreKill))
      queueMicrotask(() => this.finish());
    return true;
  }
  reply(value: unknown) {
    this.stdout.write(JSON.stringify(value) + "\n");
  }
}
async function fixture(t: TestContext) {
  const folder = await fs.mkdtemp("/private/tmp/pearl-light-runtime-test-");
  const root = path.join(folder, "owned"),
    executable = path.join(folder, "native-helper");
  const bytes = "test-only process boundary; never executable native code";
  await fs.writeFile(executable, bytes, { mode: 0o700 });
  const calls: { args: string[]; options: SpawnOptions; child: Child }[] = [];
  const requests: Record<string, unknown>[] = [];
  let profile: any;
  const controls = {
    initialize: (value: any) => value,
    reply: (request: any): unknown => ({ id: request.id, result: status() }),
  };
  const status = () => ({
    schema: 1,
    sourceCommit: LIGHT_SOURCE_COMMIT,
    watchOnly: true,
    network: "mainnet",
    account: 0,
    publicAccount: accountToJson(account),
    genesisHash: NETWORKS.mainnet.genesisHash,
    ready: false,
    synced: false,
  });
  const launch = (_file: string, args: string[], options: SpawnOptions) => {
    const child = new Child();
    calls.push({ args, options, child });
    if (args[0] === "serve") {
      let buffer = "";
      child.stdin.on("data", (bytes) => {
        buffer += bytes.toString();
        for (let end; (end = buffer.indexOf("\n")) >= 0; ) {
          const line = buffer.slice(0, end);
          buffer = buffer.slice(end + 1);
          const request = JSON.parse(line);
          requests.push(request);
          queueMicrotask(() => {
            const reply = controls.reply(request);
            if (reply !== undefined) child.reply(reply);
          });
        }
      });
    } else {
      let input = "";
      child.stdin.on("data", (bytes) => (input += bytes.toString()));
      child.stdin.on(
        "finish",
        () =>
          void (async () => {
            profile = JSON.parse(input);
            if (args[0] === "init") {
              await fs.mkdir(profile.dataDir, { mode: 0o700 });
              await fs.mkdir(path.join(profile.dataDir, "mainnet"), {
                mode: 0o700,
              });
              await fs.writeFile(
                path.join(profile.dataDir, "mainnet/wallet.db"),
                "MOCK WATCH DB",
                { mode: 0o600 },
              );
              await fs.writeFile(
                path.join(profile.dataDir, ".pearl-watch.json"),
                "{}",
                { mode: 0o600 },
              );
            }
            child.reply(
              controls.initialize({
                schema: 1,
                sourceCommit: LIGHT_SOURCE_COMMIT,
                watchOnly: true,
                network: "mainnet",
                account: 0,
                dataDir: profile.dataDir,
                dbPath: path.join(profile.dataDir, "mainnet/wallet.db"),
                coverage: {
                  externalScannedThrough: 19,
                  changeScannedThrough: 19,
                  gapLimit: 20,
                },
              }),
            );
            child.finish();
          })().catch((error) => {
            child.stderr.write(String(error));
            child.finish(1);
          }),
      );
    }
    return child as unknown as ChildProcess;
  };
  const config = {
    dataRoot: root,
    executable,
    executableSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  const dependencies = {
    spawn: launch,
    initTimeoutMs: 200,
    requestTimeoutMs: 100,
    stopTimeoutMs: 15,
  };
  const runtime = createLightRuntime(config, dependencies);
  t.after(async () => {
    for (const call of calls) call.child.finish();
    await runtime.stop().catch(() => {});
    await fs.rm(folder, { recursive: true, force: true });
  });
  return {
    root,
    executable,
    calls,
    requests,
    controls,
    runtime,
    config,
    dependencies,
    status,
    get profile() {
      return profile;
    },
  };
}
const turn = () => new Promise((resolve) => setTimeout(resolve, 0));

test("runtime verifies watch-only profile then starts only hash-pinned private stdio child; normal stop/restart preserves profile", async (t) => {
  const f = await fixture(t);
  const started = await f.runtime.start(account);
  assert.equal(started.state, "running"); // Native ready:false is normal while headers sync.
  assert.deepEqual(started.registeredThrough, [19, 19]);
  assert.equal(f.runtime.matches(account), true);
  assert.equal(f.calls.length, 2);
  assert.deepEqual(
    f.calls.map((c) => c.args[0]),
    ["init", "serve"],
  );
  assert.deepEqual(f.calls[1]!.args, ["serve", "--dir", f.profile.dataDir]);
  for (const call of f.calls) {
    assert.deepEqual(call.options.stdio, ["pipe", "pipe", "pipe"]);
    assert.equal(call.options.detached, false);
    assert.equal(call.options.env?.HOME, undefined);
    assert(!call.args.join(" ").includes(accountToJson(account).publicKey));
  }
  assert.equal((await fs.stat(f.root)).mode & 0o777, 0o700);
  assert.equal(
    (await fs.stat(path.join(f.root, ".process.lock"))).mode & 0o777,
    0o600,
  );
  assert(!JSON.stringify(started).includes(f.root));
  assert(!JSON.stringify(started).includes(accountToJson(account).publicKey));
  await f.runtime.start(account, [200, 200]);
  assert.equal(
    f.calls.length,
    2,
    "Same live profile start is idempotent without pretending new registration",
  );
  const other = createLightRuntime(f.config, f.dependencies);
  await assert.rejects(other.start(account), /startup failed/);
  assert.equal(f.calls.length, 2);
  await f.runtime.stop();
  assert.deepEqual(f.calls[1]!.child.signals, ["SIGTERM"]);
  await f.runtime.start(account, [200, 200]);
  assert.equal(f.calls[2]!.args[0], "verify");
  assert.deepEqual(
    f.profile.minimumIndex,
    [-1, -1],
    "Existing DB launches at verified bounds before explicit register/rescan",
  );
});

test("existing unowned directories, symlinks and hash mismatch never launch a helper", async (t) => {
  const f = await fixture(t);
  await fs.mkdir(f.root, { mode: 0o700 });
  await fs.writeFile(path.join(f.root, "wallet.db"), "UNRELATED", {
    mode: 0o600,
  });
  await assert.rejects(f.runtime.start(account), /startup failed/);
  assert.equal(
    await fs.readFile(path.join(f.root, "wallet.db"), "utf8"),
    "UNRELATED",
  );
  assert.equal(f.calls.length, 0);
  const symlinkRoot = path.join(path.dirname(f.root), "linked");
  await fs.symlink(f.root, symlinkRoot);
  await assert.rejects(
    createLightRuntime(
      { ...f.config, dataRoot: symlinkRoot },
      f.dependencies,
    ).start(account),
    /startup failed/,
  );
  const clean = path.join(path.dirname(f.root), "clean");
  await assert.rejects(
    createLightRuntime(
      { ...f.config, dataRoot: clean, executableSha256: "00".repeat(32) },
      f.dependencies,
    ).start(account),
    /startup failed/,
  );
  assert.equal(f.calls.length, 0);
});

test("failed watch-only, coverage or source verification prevents the serve child", async (t) => {
  for (const change of [
    { watchOnly: false },
    { sourceCommit: "00".repeat(20) },
    {
      coverage: {
        externalScannedThrough: 0,
        changeScannedThrough: 0,
        gapLimit: 20,
      },
    },
  ]) {
    const f = await fixture(t);
    f.controls.initialize = (value) => ({ ...value, ...change });
    await assert.rejects(f.runtime.start(account), /startup failed/);
    assert.deepEqual(
      f.calls.map((c) => c.args[0]),
      ["init"],
    );
  }
});

test("existing symlinked database is rejected before even a verify command", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  await f.runtime.stop();
  const db = path.join(f.profile.dataDir, "mainnet/wallet.db");
  await fs.rename(db, db + ".saved");
  await fs.symlink(db + ".saved", db);
  await assert.rejects(f.runtime.start(account), /startup failed/);
  assert.equal(f.calls.length, 2);
});

test("startup binds the exact public account and genesis without claiming native sync readiness", async (t) => {
  for (const change of [
    { genesisHash: "00".repeat(32) },
    {
      publicAccount: {
        ...accountToJson(account),
        masterFingerprint: "ffffffff",
      },
    },
  ]) {
    const f = await fixture(t);
    f.controls.reply = (request) => ({
      id: request.id,
      result: { ...f.status(), ...change },
    });
    await assert.rejects(f.runtime.start(account), /startup failed/);
    assert.deepEqual(f.calls[1]!.child.signals, ["SIGTERM"]);
  }
});

test("request allowlist, bounds and pre-cancellation send no extra IPC", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  await assert.rejects(
    f.runtime.request("walletpassphrase" as LightMethod, {}),
    /Unsupported/,
  );
  await assert.rejects(
    f.runtime.request("status", {}, AbortSignal.abort()),
    /abort/i,
  );
  await assert.rejects(
    f.runtime.request("broadcast", { rawTransaction: "aa".repeat(128 * 1024) }),
    /too large/,
  );
  assert.equal(f.requests.length, 1);
  assert.equal(f.runtime.status().state, "running");
});

test("native error messages are redacted while broadcast ambiguity is retained", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  f.controls.reply = (request) => ({
    id: request.id,
    error: {
      code: "BROADCAST_UNKNOWN",
      message: "PRIVATE ACCOUNT OR INTERNAL DATA",
    },
  });
  await assert.rejects(
    f.runtime.request("broadcast", {
      rawTransaction: "fixture",
      expectedTxid: "00".repeat(32),
    }),
    (error) => {
      assert(error instanceof LocalLightRequestError);
      assert.equal(error.code, "BROADCAST_UNKNOWN");
      assert(!error.message.includes("PRIVATE"));
      return true;
    },
  );
});

test("timeout invalidates the process, retains broadcast uncertainty and ignores stale child output after restart", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  const old = f.calls[1]!.child;
  f.controls.reply = () => undefined;
  await assert.rejects(
    f.runtime.request("broadcast", {}),
    (error) =>
      error instanceof LocalLightRequestError &&
      error.code === "BROADCAST_UNKNOWN",
  );
  await f.runtime.stop();
  f.controls.reply = (request) => ({ id: request.id, result: f.status() });
  await f.runtime.start(account);
  old.stdout.write("malformed stale result\n");
  assert.equal(f.runtime.status().state, "running");
  assert.deepEqual(old.signals, ["SIGTERM"]);
});

test("range extension waits for old process exit and requires a verified restart before rescan", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  f.controls.reply = (request) => ({
    id: request.id,
    result: { ...f.status(), restartRequired: true },
  });
  assert.equal(
    ((await f.runtime.request("register", { minimumIndex: [20, 20] })) as any)
      .restartRequired,
    true,
  );
  assert.equal(f.runtime.status().state, "stopping");
  await assert.rejects(f.runtime.request("snapshot", {}), /not running/);
  f.calls[1]!.child.finish();
  await turn();
  await f.runtime.stop();
  f.controls.reply = (request) => ({ id: request.id, result: f.status() });
  await f.runtime.start(account);
  assert.equal(f.calls[2]!.args[0], "verify");
});

test("stuck owned child escalates only its signals; unresolved termination keeps the directory locked", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  const child = f.calls[1]!.child;
  child.ignoreTerm = true;
  child.ignoreKill = true;
  await assert.rejects(f.runtime.stop(), /has not exited/);
  assert.deepEqual(child.signals, ["SIGTERM", "SIGKILL"]);
  assert.equal(
    (await fs.stat(path.join(f.root, ".process.lock"))).isFile(),
    true,
  );
  assert.equal(f.calls[0]!.child.signals.length, 0);
  child.finish();
  await f.runtime.stop();
});

test("a valid startup status followed by malformed data in the same chunk cannot revive a failed session", async (t) => {
  const f = await fixture(t);
  f.controls.reply = (request) => {
    f.calls
      .at(-1)!
      .child.stdout.write(
        JSON.stringify({ id: request.id, result: f.status() }) +
          "\nmalformed\n",
      );
    return undefined;
  };
  await assert.rejects(f.runtime.start(account), /startup failed/);
  assert.equal(f.runtime.status().state, "failed");
  await assert.rejects(f.runtime.request("status", {}), /not running/);
});

test("mutating abort invalidates in-flight work and oversized native frames fail closed", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  f.controls.reply = () => undefined;
  const controller = new AbortController();
  const request = f.runtime.request(
    "register",
    { minimumIndex: [20, 20] },
    controller.signal,
  );
  controller.abort();
  await assert.rejects(request, /cancelled/);
  await f.runtime.stop();
  f.controls.reply = (request) => ({ id: request.id, result: f.status() });
  await f.runtime.start(account);
  f.controls.reply = () => {
    f.calls.at(-1)!.child.stdout.write(Buffer.alloc(4 * 1024 * 1024 + 1, 65));
    return undefined;
  };
  await assert.rejects(f.runtime.request("snapshot", {}), /exceeded/);
  await f.runtime.stop();
});

test("pipe errors terminate only the owned native process instead of escaping as unhandled stream errors", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  f.controls.reply = () => undefined;
  const pending = f.runtime.request("snapshot", {});
  f.calls[1]!.child.stdin.emit("error", new Error("sensitive internal error"));
  await assert.rejects(pending, /input pipe failed/);
  await f.runtime.stop();
  assert.deepEqual(f.calls[1]!.child.signals, ["SIGTERM"]);
});

test("aborted read consumes only its exact late reply without stopping background sync or applying it to another request", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  f.controls.reply = () => undefined;
  const controller = new AbortController();
  const abandoned = f.runtime.request("snapshot", {}, controller.signal);
  controller.abort();
  await assert.rejects(abandoned, /abort/i);
  assert.equal(f.runtime.status().state, "running");
  const current = f.runtime.request("status", {});
  const oldId = f.requests.at(-2)!.id,
    currentId = f.requests.at(-1)!.id;
  f.calls
    .at(-1)!
    .child.reply({ id: oldId, result: { shouldNeverApply: "old snapshot" } });
  f.calls
    .at(-1)!
    .child.reply({ id: currentId, result: { currentStatus: true } });
  assert.deepEqual(await current, { currentStatus: true });
  assert.equal(f.runtime.status().state, "running");
  assert.deepEqual(f.calls.at(-1)!.child.signals, []);
});

test("cancelled reads retain the four-slot bound and original deadline", async (t) => {
  const f = await fixture(t);
  await f.runtime.start(account);
  f.controls.reply = () => undefined;
  for (let i = 0; i < 4; i++) {
    const controller = new AbortController();
    const read = f.runtime.request("status", {}, controller.signal);
    controller.abort();
    await assert.rejects(read, /abort/i);
  }
  await assert.rejects(f.runtime.request("status", {}), /busy/);
  assert.equal(
    f.requests.length,
    5,
    "Startup plus four retained requests, no fifth send",
  );
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.equal(f.runtime.status().state, "failed");
  await f.runtime.stop();
});
