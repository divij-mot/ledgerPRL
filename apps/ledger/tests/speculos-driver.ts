/** Public-test-only physical UI driver. Does not patch the firmware or bypass consent. */
import assert from "node:assert/strict";
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { createWriteStream, constants } from "node:fs";
import { mkdir, writeFile, copyFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";
export type Model = "nanosp" | "nanox" | "stax" | "flex" | "apex_p";
export type ScreenEvent = {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
};
const dimensions = {
  nanosp: [128, 64],
  nanox: [128, 64],
  stax: [400, 672],
  flex: [480, 600],
  apex_p: [300, 400],
} as const;
export const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
export class Emulator {
  child?: ChildProcess;
  readonly url: string;
  provenance: unknown;
  readonly approvalTimings: {
    label: string;
    gestureToResultMs: number;
    gesture: string;
  }[] = [];
  readonly screens: { label: string; text: string; events: ScreenEvent[] }[] =
    [];
  constructor(
    readonly model: Model,
    readonly elf: string,
    readonly output: string,
    readonly port = 5031,
  ) {
    this.url = `http://127.0.0.1:${port}`;
  }
  async start() {
    await mkdir(this.output, { recursive: true });
    // Snapshot before execution: parallel rebuilds must never mutate mapped ELF bytes.
    const snapshot = join(this.output, "tested-firmware.elf");
    // A caller-supplied output directory must be fresh. Never replace an
    // existing snapshot that another live emulator may have mapped.
    await copyFile(this.elf, snapshot, constants.COPYFILE_EXCL);
    console.log(`EVIDENCE ${this.output}`);
    const log = createWriteStream(join(this.output, "speculos.log"));
    const injector = process.env.SPECULOS_INJECTOR;
    const sha256 = (data: Uint8Array) =>
      createHash("sha256").update(data).digest("hex");
    const version = execFileSync(
      process.env.SPECULOS_PYTHON || "python3",
      [
        "-c",
        "import importlib.metadata;print(importlib.metadata.version('speculos'))",
      ],
      { encoding: "utf8" },
    ).trim();
    assert.equal(
      version,
      "0.27.1",
      "Use the pinned Speculos version for reproducible evidence",
    );
    this.provenance = {
      model: this.model,
      sourceElf: this.elf,
      testedSnapshot: snapshot,
      sha256: sha256(await readFile(snapshot)),
      speculos: version,
      publicTestSeed: "000102030405060708090a0b0c0d0e0f",
      injector: injector
        ? {
            path: injector,
            sha256: sha256(await readFile(injector)),
            purpose:
              "Numeric SEPH input generator only; firmware and syscalls unmodified",
          }
        : null,
    };
    await writeFile(
      join(this.output, "firmware.json"),
      JSON.stringify(this.provenance, null, 2),
    );
    this.child = spawn(
      injector
        ? process.env.SPECULOS_PYTHON || "python3"
        : process.env.SPECULOS_BIN || "speculos",
      [
        ...(injector ? [injector] : []),
        "--display",
        "headless",
        "--model",
        this.model,
        "--api-port",
        String(this.port),
        "--apdu-port",
        String(this.port + 1),
        "--seed",
        "hex:000102030405060708090a0b0c0d0e0f",
        snapshot,
      ],
      { env: process.env, stdio: ["ignore", "pipe", "pipe"] },
    );
    this.child.stdout!.pipe(log);
    this.child.stderr!.pipe(log);
    let startupError: unknown;
    for (let i = 0; i < 100; i++) {
      if (this.child.exitCode !== null)
        throw new Error(`Speculos exited ${this.child.exitCode}`);
      try {
        await this.events();
        await pause(200);
        return;
      } catch (error) {
        startupError = error;
        await pause(100);
      }
    }
    throw new Error("Speculos API did not become reachable", {
      cause: startupError,
    });
  }
  async stop() {
    // A rejected start must not touch another run's existing evidence.
    if (!this.child) return;
    try {
      await writeFile(
        join(this.output, "screens.json"),
        JSON.stringify(this.screens, null, 2),
      );
    } finally {
      // Evidence storage failure must never leak an emulator process.
      this.child?.kill("SIGTERM");
    }
  }
  async json(path: string, data?: unknown) {
    const response = await fetch(this.url + path, {
      method: data === undefined ? "GET" : "POST",
      headers: { "content-type": "application/json" },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(125_000),
    });
    assert(response.ok, `Speculos ${path} HTTP${response.status}`);
    return response.json();
  }
  async events(): Promise<ScreenEvent[]> {
    return (await this.json("/events?currentscreenonly=true")).events;
  }
  async capture(label: string, events: ScreenEvent[]) {
    const text = events.map((e) => e.text).join(" | ");
    this.screens.push({ label, text, events });
    const png = await fetch(this.url + "/screenshot");
    assert(png.ok);
    await writeFile(
      join(
        this.output,
        `${String(this.screens.length).padStart(3, "0")}-${label}.png`,
      ),
      Buffer.from(await png.arrayBuffer()),
    );
    console.log(`UI ${this.model} ${label}: ${text}`);
  }
  async button(
    button: "left" | "right" | "both",
    action = "press-and-release",
  ) {
    return this.json(`/button/${button}`, { action });
  }
  async touch(event: ScreenEvent, delay = 0.15) {
    return this.json("/finger", {
      x: event.x + Math.max(5, Math.floor(event.w / 2)),
      y: event.y + Math.max(5, Math.floor(event.h / 2)),
      action: "press-and-release",
      delay,
    });
  }
  async next() {
    if (this.model === "nanosp" || this.model === "nanox")
      return this.button("right");
    const [w, h] = dimensions[this.model];
    return this.json("/finger", {
      x: Math.floor(w * 0.85),
      y: Math.floor(h * 0.52),
      x2: Math.floor(w * 0.15),
      y2: Math.floor(h * 0.52),
      action: "press-and-release",
      delay: 0.2,
    });
  }
  async approve<T>(
    operation: () => Promise<T>,
    finalLabel: string,
    label: string,
  ): Promise<T> {
    let done = false,
      approved = false,
      prior = "";
    let gestureStarted: number | undefined;
    let finished = 0;
    const pending = operation().finally(() => {
      finished = performance.now();
      done = true;
    });
    pending.catch(() => {});
    for (let i = 0; i < 250 && !done; i++) {
      await pause(180);
      if (done) break;
      const events = await this.events();
      const text = events.map((e) => e.text).join(" | ");
      if (text !== prior) {
        await this.capture(label, events);
        prior = text;
      }
      if (
        text.includes("app is ready") ||
        text.includes("This app enables signing")
      )
        continue;
      const final = events.find((e) => e.text === finalLabel);
      const warning = events.find((e) => e.text === "Review anyway");
      if (this.model === "nanosp" || this.model === "nanox") {
        if (final || warning) {
          if (final) {
            approved = true;
            gestureStarted = performance.now();
          }
          await this.button("both");
        } else await this.next();
      } else {
        const hold = events.find((e) => e.text.startsWith("Hold to"));
        if (final && hold) {
          approved = true;
          gestureStarted = performance.now();
          await this.touch(hold, 2.5);
        } else if (finalLabel === "Confirm" && final) {
          approved = true;
          gestureStarted = performance.now();
          await this.touch(final);
        } else if (warning) await this.touch(warning);
        else await this.next();
      }
    }
    assert(done, `${label}: UI did not finish`);
    const result = await pending;
    assert(approved, `${label}: no explicit physical final approval observed`);
    assert(gestureStarted !== undefined);
    this.approvalTimings.push({
      label,
      gestureToResultMs: finished - gestureStarted,
      gesture:
        this.model === "nanosp" || this.model === "nanox"
          ? "both-button press-and-release"
          : finalLabel === "Confirm"
            ? "touch confirmation"
            : "2.5-second hold",
    });
    return result;
  }
}
