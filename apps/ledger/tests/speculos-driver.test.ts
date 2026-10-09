import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ChildProcess } from "node:child_process";
import { Emulator } from "./speculos-driver.ts";

test("evidence-write failure still terminates emulator child", async () => {
  const root = await mkdtemp(join(tmpdir(), "pearl-driver-cleanup-"));
  try {
    await writeFile(join(root, "file"), "cannot contain a child file");
    const emulator = new Emulator("nanosp", "unused", join(root, "file"));
    let killed = false;
    emulator.child = {
      kill(signal: string) {
        assert.equal(signal, "SIGTERM");
        killed = true;
        return true;
      },
    } as unknown as ChildProcess;
    await assert.rejects(emulator.stop());
    assert(killed);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("an existing immutable snapshot is never overwritten", async () => {
  const root = await mkdtemp(join(tmpdir(), "pearl-driver-snapshot-"));
  try {
    const source = join(root, "source.elf"),
      snapshot = join(root, "tested-firmware.elf");
    await writeFile(source, "new source bytes");
    await writeFile(snapshot, "original mapped bytes");
    await writeFile(join(root, "screens.json"), "original UI evidence");
    const emulator = new Emulator("nanosp", source, root);
    await assert.rejects(emulator.start(), { code: "EEXIST" });
    assert.equal(await readFile(snapshot, "utf8"), "original mapped bytes");
    assert.equal(emulator.child, undefined);
    await emulator.stop();
    assert.equal(
      await readFile(join(root, "screens.json"), "utf8"),
      "original UI evidence",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
