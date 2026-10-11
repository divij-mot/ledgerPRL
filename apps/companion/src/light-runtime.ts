/** Local, watch-only native process boundary. No wallet seeds, RPC listeners or shell commands. */
import {
  spawn,
  type ChildProcess,
  type SpawnOptions,
} from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream, constants, writeFileSync } from "node:fs";
import * as fs from "node:fs/promises";
import path from "node:path";
import {
  accountToJson,
  accountFromJson,
  assert,
  exactKeys,
  NETWORKS,
  type AccountPublicKey,
} from "@pearl-ledger/sdk";

import { abortable } from "./operation.js";

export const LIGHT_SOURCE_COMMIT = "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701";
const OWNER = { schema: 1, application: "pearl-ledger-local-light" };
const MAX_FRAME = 4 * 1024 * 1024;
export type LightMethod =
  | "status"
  | "snapshot"
  | "register"
  | "blockHash"
  | "broadcast";
const METHODS: readonly LightMethod[] = [
  "status",
  "snapshot",
  "register",
  "blockHash",
  "broadcast",
];
type Profile = {
  dataDir: string;
  account: ReturnType<typeof accountToJson>;
  minimumIndex: [number, number];
};
export interface LightRuntimeStatus {
  state:
    | "stopped"
    | "preparing"
    | "starting"
    | "running"
    | "stopping"
    | "failed";
  network: "mainnet";
  account: 0;
  /** Address registration bounds, not completed blockchain scan coverage. */
  registeredThrough: [number, number] | null;
  error: string | null;
}
export class LocalLightRequestError extends Error {
  constructor(readonly code: "UNAVAILABLE" | "BROADCAST_UNKNOWN") {
    super(
      code === "BROADCAST_UNKNOWN"
        ? "Broadcast outcome is unknown; retain the exact signed transaction"
        : "Local light data is unavailable",
    );
    this.name = "LocalLightRequestError";
  }
}
export interface LightRuntimeConfig {
  /** Trusted server configuration only; never populate paths/hashes from HTTP input. */
  dataRoot: string;
  executable: string;
  executableSha256: string;
}
export interface LightRuntimeDependencies {
  spawn?: (file: string, args: string[], options: SpawnOptions) => ChildProcess;
  initTimeoutMs?: number;
  requestTimeoutMs?: number;
  stopTimeoutMs?: number;
}
async function hashFile(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) hash.update(bytes);
  return hash.digest("hex");
}
function object(value: unknown): Record<string, unknown> {
  assert(
    typeof value === "object" && value !== null && !Array.isArray(value),
    "Invalid local light response",
  );
  return value as Record<string, unknown>;
}
async function exists(file: string): Promise<boolean> {
  try {
    await fs.lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function privatePath(file: string, directory: boolean): Promise<void> {
  const stat = await fs.lstat(file);
  assert(
    !stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile()),
    "Local light path is not a regular owned path",
  );
  assert(
    stat.uid === process.getuid?.() &&
      (stat.mode & 0o077) === 0 &&
      (directory || stat.nlink === 1),
    "Local light path must be private to this user",
  );
  assert(
    (await fs.realpath(file)) === path.resolve(file),
    "Local light path must not traverse symlinks",
  );
}
async function privateJson(file: string, maximum = 8192): Promise<unknown> {
  await privatePath(file, false);
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    assert(stat.size <= maximum, "Local light metadata too large");
    return JSON.parse(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
}
/** Only a verified helper may touch an app-owned profile or start native synchronization. */
export class LocalLightRuntime {
  private readonly config: LightRuntimeConfig;
  private readonly launch: NonNullable<LightRuntimeDependencies["spawn"]>;
  private readonly initTimeout: number;
  private readonly requestTimeout: number;
  private readonly stopTimeout: number;
  private current: LightRuntimeStatus = {
    state: "stopped",
    network: "mainnet",
    account: 0,
    registeredThrough: null,
    error: null,
  };
  private profile: Profile | undefined;
  private child: ChildProcess | undefined;
  private closed: Promise<{ code: number | null }> | undefined;
  private termination: Promise<void> | undefined;
  private cleaning: Promise<void> | undefined;
  private serving: ChildProcess | undefined;
  private expectedExit: ChildProcess | undefined;
  private transition: Promise<LightRuntimeStatus> | undefined;
  private stopping = false;
  private lock: { file: string; token: string } | undefined;
  private readonly pending = new Map<
    string,
    {
      method: LightMethod;
      resolve(value: unknown): void;
      reject(error: Error): void;
    }
  >();
  private readonly exitCleanup = () => {
    this.child?.kill("SIGTERM");
  };

  constructor(
    config: LightRuntimeConfig,
    dependencies: LightRuntimeDependencies = {},
  ) {
    assert(
      path.isAbsolute(config.dataRoot) && path.isAbsolute(config.executable),
      "Absolute local light paths required",
    );
    assert(
      /^[a-f0-9]{64}$/.test(config.executableSha256),
      "Pinned native helper SHA-256 required",
    );
    this.config = {
      ...config,
      dataRoot: path.resolve(config.dataRoot),
      executable: path.resolve(config.executable),
    };
    this.launch = dependencies.spawn ?? spawn;
    this.initTimeout = dependencies.initTimeoutMs ?? 60_000;
    this.requestTimeout = dependencies.requestTimeoutMs ?? 30_000;
    this.stopTimeout = dependencies.stopTimeoutMs ?? 5_000;
  }
  status(): LightRuntimeStatus {
    return structuredClone(this.current);
  }
  /** Trusted server-side identity check; public account bytes are never in lifecycle status. */
  matches(account: AccountPublicKey): boolean {
    return (
      this.profile !== undefined &&
      JSON.stringify(this.profile.account) ===
        JSON.stringify(accountToJson(account))
    );
  }

  private async acquire(): Promise<void> {
    const root = this.config.dataRoot,
      owner = path.join(root, ".owner.json");
    if (!(await exists(root))) {
      await fs.mkdir(root, { mode: 0o700 });
      await fs.writeFile(owner, JSON.stringify(OWNER), {
        flag: "wx",
        mode: 0o600,
      });
    }
    await privatePath(root, true);
    assert(
      JSON.stringify(await privateJson(owner)) === JSON.stringify(OWNER),
      "Refusing an unowned local light directory",
    );
    const file = path.join(root, ".process.lock");
    assert(
      !(await exists(file)),
      "An existing local light process lock must be resolved before starting",
    );
    const token = randomUUID();
    await fs.writeFile(file, JSON.stringify({ pid: process.pid, token }), {
      flag: "wx",
      mode: 0o600,
    });
    this.lock = { file, token };
  }
  private async release(): Promise<void> {
    if (!this.lock) return;
    const lock = this.lock;
    const saved = object(await privateJson(lock.file, 1024));
    assert(saved.token === lock.token, "Local light lock changed unexpectedly");
    await fs.unlink(lock.file);
    this.lock = undefined;
  }
  private async verifiedExecutable(): Promise<void> {
    const stat = await fs.lstat(this.config.executable);
    assert(
      stat.isFile() && !stat.isSymbolicLink() && !(stat.mode & 0o022),
      "Native helper must be a non-writable regular executable",
    );
    assert(
      (await fs.realpath(this.config.executable)) === this.config.executable,
      "Native helper path traverses a symlink",
    );
    assert(
      (await hashFile(this.config.executable)) === this.config.executableSha256,
      "Native helper hash does not match the pinned build",
    );
  }
  private async startChild(args: string[]): Promise<ChildProcess> {
    assert(
      !this.child && !this.stopping,
      "Local light process is closing or busy",
    );
    await this.verifiedExecutable();
    assert(!this.stopping, "Local light startup cancelled");
    const child = this.launch(this.config.executable, args, {
      cwd: this.config.dataRoot,
      stdio: ["pipe", "pipe", "pipe"],
      detached: false,
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        LANG: "C",
        TMPDIR: this.config.dataRoot,
      },
    });
    this.child = child;
    child.on("error", () => {}); // Prevent an early spawn error from escaping before protocol listeners attach.
    this.closed = new Promise((resolve) =>
      child.once("close", (code) => {
        if (this.child === child) this.child = undefined;
        resolve({ code });
      }),
    );
    child.stdin?.on("error", () => {
      if (this.serving === child && !this.stopping)
        this.fail("Local light input pipe failed");
    });
    child.stdout?.on("error", () => {
      if (this.serving === child && !this.stopping)
        this.fail("Local light output pipe failed");
    });
    child.stderr?.on("error", () => {});
    child.stderr?.resume(); // Native logs may contain public account data; never forward them.
    process.once("exit", this.exitCleanup);
    if (child.pid && this.lock)
      writeFileSync(
        this.lock.file,
        JSON.stringify({
          pid: process.pid,
          childPid: child.pid,
          token: this.lock.token,
        }),
        { mode: 0o600 },
      );
    return child;
  }
  private terminate(): Promise<void> {
    if (this.termination) return this.termination;
    const work = this.terminateChild();
    this.termination = work;
    void work
      .finally(() => {
        if (this.termination === work) this.termination = undefined;
      })
      .catch(() => {});
    return work;
  }
  private async terminateChild(): Promise<void> {
    const child = this.child,
      closed = this.closed;
    if (!child || !closed) {
      process.off("exit", this.exitCleanup);
      return;
    }
    const wait = async (ms: number) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          closed.then(() => true),
          new Promise<false>((resolve) => {
            timer = setTimeout(() => resolve(false), ms);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    child.kill("SIGTERM");
    if (!(await wait(this.stopTimeout))) {
      child.kill("SIGKILL");
      assert(
        await wait(this.stopTimeout),
        "Local light process has not exited; directory remains locked",
      );
    }
    process.off("exit", this.exitCleanup);
  }
  private rejectPending(message: string): void {
    for (const pending of this.pending.values())
      pending.reject(
        pending.method === "broadcast"
          ? new LocalLightRequestError("BROADCAST_UNKNOWN")
          : new Error(message),
      );
    this.pending.clear();
  }
  private cleanup(): Promise<void> {
    if (this.cleaning) return this.cleaning;
    const work = (async () => {
      await this.terminate();
      await this.release();
    })();
    this.cleaning = work;
    void work
      .finally(() => {
        if (this.cleaning === work) this.cleaning = undefined;
      })
      .catch(() => {});
    return work;
  }
  private fail(message: string): void {
    this.current = { ...this.current, state: "failed", error: message };
    this.rejectPending(message);
    void this.cleanup().catch(() => {
      /* Retain lock if termination cannot be confirmed. */
    });
  }
  private async initialize(
    profile: Profile,
    command: "init" | "verify",
  ): Promise<unknown> {
    const child = await this.startChild([command]);
    const request = JSON.stringify(profile);
    assert(
      Buffer.byteLength(request) <= 8192,
      "Local light profile request too large",
    );
    let output = Buffer.alloc(0),
      timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Watch-only initialization timed out")),
          this.initTimeout,
        );
        child.once("error", () =>
          reject(new Error("Native helper could not start")),
        );
        child.stdout?.on("data", (bytes: Buffer) => {
          if (output.length + bytes.length > 8192) {
            reject(new Error("Watch-only initialization response too large"));
            return;
          }
          output = Buffer.concat([output, bytes]);
        });
        void this.closed!.then(({ code }) => {
          if (code !== 0) {
            reject(new Error("Watch-only profile validation failed"));
            return;
          }
          try {
            resolve(JSON.parse(output.toString("utf8")));
          } catch {
            reject(new Error("Malformed watch-only initialization response"));
          }
        });
        child.stdin?.end(request);
      });
    } finally {
      clearTimeout(timer);
      await this.terminate();
    }
  }
  private async prepareProfile(
    account: AccountPublicKey,
    minimumIndex: [number, number],
  ): Promise<Profile> {
    const publicAccount = accountToJson(account);
    assert(
      publicAccount.network === "mainnet" && publicAccount.account === 0,
      "Local light mode currently supports mainnet account 0",
    );
    assert(
      minimumIndex.length === 2 &&
        minimumIndex.every(
          (index) => Number.isInteger(index) && index >= -1 && index <= 979,
        ),
      "Invalid local discovery bounds",
    );
    const identity = createHash("sha256")
      .update(JSON.stringify(publicAccount))
      .digest("hex");
    const profiles = path.join(this.config.dataRoot, "profiles");
    if (!(await exists(profiles))) await fs.mkdir(profiles, { mode: 0o700 });
    await privatePath(profiles, true);
    const profile = {
      dataDir: path.join(profiles, identity),
      account: publicAccount,
      minimumIndex: [...minimumIndex] as [number, number],
    };
    const present = await exists(profile.dataDir);
    if (present) {
      await privatePath(profile.dataDir, true);
      await privatePath(path.join(profile.dataDir, "mainnet"), true);
      await privatePath(path.join(profile.dataDir, "mainnet/wallet.db"), false);
      await privatePath(path.join(profile.dataDir, ".pearl-watch.json"), false);
    }
    // An existing profile must be launchable before a later register/rescan expands
    // it. Verify its existing baseline; never label requested new bounds as scanned.
    const verification = present
      ? { ...profile, minimumIndex: [-1, -1] as [number, number] }
      : profile;
    const reply = object(
      await this.initialize(verification, present ? "verify" : "init"),
    );
    exactKeys(
      reply,
      [
        "schema",
        "sourceCommit",
        "watchOnly",
        "network",
        "account",
        "dataDir",
        "dbPath",
        "coverage",
      ],
      "watch-only profile",
    );
    this.checkIdentity(reply);
    assert(
      reply.dataDir === profile.dataDir &&
        reply.dbPath === path.join(profile.dataDir, "mainnet/wallet.db"),
      "Watch-only database path mismatch",
    );
    await privatePath(profile.dataDir, true);
    await privatePath(path.join(profile.dataDir, "mainnet"), true);
    await privatePath(String(reply.dbPath), false);
    await privatePath(path.join(profile.dataDir, ".pearl-watch.json"), false);
    const coverage = object(reply.coverage);
    exactKeys(
      coverage,
      ["externalScannedThrough", "changeScannedThrough", "gapLimit"],
      "watch-only coverage",
    );
    const bounds = [
      coverage.externalScannedThrough,
      coverage.changeScannedThrough,
    ];
    assert(
      coverage.gapLimit === 20 &&
        bounds.every(
          (bound, i) =>
            Number.isInteger(bound) &&
            Number(bound) >= Math.max(19, verification.minimumIndex[i]! + 20) &&
            Number(bound) <= 999,
        ),
      "Watch-only profile coverage is insufficient",
    );
    this.current.registeredThrough = bounds.map(Number) as [number, number];
    return profile;
  }
  private checkIdentity(reply: Record<string, unknown>): void {
    assert(
      reply.schema === 1 &&
        reply.sourceCommit === LIGHT_SOURCE_COMMIT &&
        reply.watchOnly === true &&
        reply.network === "mainnet" &&
        reply.account === 0,
      "Native helper identity or watch-only mode mismatch",
    );
  }
  private listen(child: ChildProcess): void {
    this.serving = child;
    let buffer = Buffer.alloc(0);
    child.stdout?.on("data", (bytes: Buffer) => {
      if (this.child !== child) return;
      buffer = Buffer.concat([buffer, bytes]);
      for (let end; (end = buffer.indexOf(10)) >= 0; ) {
        const line = buffer.subarray(0, end);
        buffer = buffer.subarray(end + 1);
        if (line.length === 0) continue;
        try {
          assert(line.length <= MAX_FRAME, "Native response too large");
          const message = object(
            JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(line)),
          );
          assert(
            typeof message.id === "string" && this.pending.has(message.id),
            "Unexpected native response",
          );
          const pending = this.pending.get(message.id)!;
          if (Object.hasOwn(message, "error")) {
            exactKeys(message, ["id", "error"], "native error");
            const error = object(message.error);
            exactKeys(error, ["code", "message"], "native error details");
            assert(
              error.code === "UNAVAILABLE" ||
                error.code === "BROADCAST_UNKNOWN",
              "Unknown native error code",
            );
            this.pending.delete(message.id);
            pending.reject(new LocalLightRequestError(error.code));
          } else {
            exactKeys(message, ["id", "result"], "native response");
            if (
              pending.method === "register" &&
              object(message.result).restartRequired === true
            ) {
              this.checkIdentity(object(message.result));
              this.expectedExit = child;
              this.current.state = "stopping";
            }
            this.pending.delete(message.id);
            pending.resolve(message.result);
          }
        } catch {
          this.fail("Invalid response from local light process");
          return;
        }
      }
      if (buffer.length > MAX_FRAME)
        this.fail("Local light response exceeded its bound");
    });
    child.once("error", () => {
      if (this.serving === child)
        this.fail("Local light process could not start");
    });
    child.once("close", () => {
      if (this.serving !== child) return;
      this.serving = undefined;
      if (this.expectedExit === child) {
        this.expectedExit = undefined;
        this.current.state = "stopped";
        this.rejectPending("Local light profile extended; restart to rescan");
        void this.cleanup().catch(() => {});
      } else if (!this.stopping)
        this.fail("Local light process exited; restart before retrying");
      else this.rejectPending("Local light process stopped");
    });
  }
  async start(
    account: AccountPublicKey,
    minimumIndex: [number, number] = [-1, -1],
  ): Promise<LightRuntimeStatus> {
    if (this.child && this.current.state === "running" && !this.stopping) {
      assert(
        this.matches(account),
        "Stop the active local profile before switching accounts",
      );
      assert(
        minimumIndex.length === 2 &&
          minimumIndex.every(
            (index) => Number.isInteger(index) && index >= -1 && index <= 979,
          ),
        "Invalid local discovery bounds",
      );
      return this.status();
    }
    assert(
      !this.transition && !this.child && !this.cleaning,
      "Local light process is already active",
    );
    this.stopping = false;
    const work = (async () => {
      this.current = {
        state: "preparing",
        network: "mainnet",
        account: 0,
        registeredThrough: null,
        error: null,
      } as LightRuntimeStatus;
      try {
        await this.acquire();
        this.profile = await this.prepareProfile(account, minimumIndex);
        assert(!this.stopping, "Local light startup cancelled");
        this.current.state = "starting";
        const child = await this.startChild([
          "serve",
          "--dir",
          this.profile.dataDir,
        ]);
        this.listen(child);
        const response = object(await this.request("status", {}));
        this.checkIdentity(response);
        assert(
          JSON.stringify(
            accountToJson(accountFromJson(response.publicAccount)),
          ) === JSON.stringify(this.profile.account),
          "Local light public account mismatch",
        );
        assert(
          response.genesisHash === NETWORKS.mainnet.genesisHash,
          "Local light genesis mismatch",
        );
        assert(
          !this.stopping &&
            this.child === child &&
            this.current.state === "starting" &&
            !this.cleaning,
          "Local light startup cancelled",
        );
        this.current.state = "running";
        return this.status();
      } catch {
        await this.cleanup();
        this.current = {
          ...this.current,
          state: "failed",
          error:
            "Local light startup failed; profile retained for verification",
        };
        throw new Error(this.current.error!);
      }
    })();
    this.transition = work;
    try {
      return await work;
    } finally {
      if (this.transition === work) this.transition = undefined;
    }
  }
  async request(
    method: LightMethod,
    params: unknown,
    signal?: AbortSignal,
  ): Promise<unknown> {
    assert(METHODS.includes(method), "Unsupported local light method");
    assert(
      this.child &&
        ["starting", "running"].includes(this.current.state) &&
        !this.stopping,
      "Local light process is not running",
    );
    signal?.throwIfAborted();
    assert(this.pending.size < 4, "Local light process is busy");
    const id = randomUUID(),
      wire = JSON.stringify({ id, method, params }) + "\n";
    assert(
      Buffer.byteLength(wire) <= 128 * 1024,
      "Local light request too large",
    );
    const readOnly =
      method === "status" || method === "snapshot" || method === "blockHash";
    let timer: ReturnType<typeof setTimeout> | undefined,
      abort: (() => void) | undefined;
    const response = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      timer = setTimeout(
        () =>
          this.fail(
            "Local light request timed out; its outcome may be unknown",
          ),
        this.requestTimeout,
      );
      if (!readOnly) {
        abort = () =>
          this.fail(
            "Local light request cancelled; its outcome may be unknown",
          );
        signal?.addEventListener("abort", abort, { once: true });
      }
      this.child!.stdin?.write(wire, (error) => {
        if (error) this.fail("Local light request could not be delivered");
      });
    });
    const completed = response.finally(() => {
      clearTimeout(timer);
      if (abort) signal?.removeEventListener("abort", abort);
      this.pending.delete(id);
    });
    // Closing a page cancels its read, not the background sync. Keep only this
    // existing bounded request slot until its exact reply is consumed/discarded.
    // The original deadline remains active; no unbounded late-response tombstones.
    return readOnly && signal ? abortable(completed, signal) : completed;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.current.state = "stopping";
    this.rejectPending("Local light process stopped");
    await this.terminate();
    await this.transition?.catch(() => {});
    await this.cleanup();
    this.profile = undefined;
    this.current = { ...this.current, state: "stopped", error: null };
  }
}
export const createLightRuntime = (
  config: LightRuntimeConfig,
  dependencies?: LightRuntimeDependencies,
) => new LocalLightRuntime(config, dependencies);
