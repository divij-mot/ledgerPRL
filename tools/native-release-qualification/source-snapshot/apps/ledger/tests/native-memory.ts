import { tmpdir } from "node:os";
/** Instrumented public-test firmware ONLY. Release ELFs reject this measurement command. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import {
  accountFromJson,
  bundleFromJson,
  deriveAddress,
  LedgerPearlClient,
  SpeculosTransport,
  type SigningBundle,
} from "../../../packages/sdk/src/index.ts";
import { Emulator, type Model } from "./speculos-driver.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL || "nanox") as Model;
const target = model === "nanosp" ? "nanosplus" : model;
const elf = join(
  root,
  `apps/ledger/target/memory-measurement/pearl-${target}-simnet-INSTRUMENTED.elf`,
);
const output =
  process.env.PEARL_EVIDENCE ||
  (await mkdtemp(join(tmpdir(), `pearl-native-${model}-memory-`)));
const emulator = new Emulator(model, elf, output, 5063);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = accountFromJson({
  ...fixture.publicAccount,
  network: "simnet",
});
const nm = execFileSync(
  process.env.LLVM_NM || "llvm-nm",
  ["--numeric-sort", elf],
  { encoding: "utf8" },
);
const symbol = (name: string) => {
  const match = nm.match(new RegExp(`^([a-fA-F0-9]+) \\w ${name}$`, "m"));
  assert(match, `Missing linker symbol ${name}`);
  return parseInt(match[1]!, 16);
};
const stackSpan = symbol("_estack") - symbol("_stack");
const measurements: unknown[] = [];
function bundle(
  warnings: boolean,
  owner = account,
  extreme = false,
): SigningBundle {
  const b = bundleFromJson({
    ...fixture.bundle,
    network: "simnet",
    account: owner.account,
  });
  b.inputs = Array.from({ length: 16 }, (_, i) => {
    const index = extreme ? 0x7fff_ffff - 15 + i : warnings ? 50_001 + i : i;
    return {
      ...b.inputs[0]!,
      vout: i,
      index,
      amount: extreme ? 2_100_000_000_000_000_000n / 16n : 100_000_000n,
      scriptPubKey: deriveAddress(owner, 0, index).scriptPubKey,
    };
  });
  b.outputs[0] = {
    ...b.outputs[0]!,
    amount: extreme ? 1_000_000_000_000_000_000n : 800_000_000n,
  };
  const index = extreme ? 0x7fff_ffff : warnings ? 50_001 : 0;
  b.outputs[1] = {
    ...b.outputs[1]!,
    index,
    amount: extreme
      ? 500_000_000_000_000_000n
      : warnings
        ? 480_000_000n
        : 799_990_000n,
    scriptPubKey: deriveAddress(owner, 1, index).scriptPubKey,
  };
  return b;
}
try {
  await emulator.start();
  const transport = new SpeculosTransport(emulator.url);
  const client = new LedgerPearlClient(transport, "simnet");
  for (const flow of [
    "max16-ordinary",
    "max16-all-warnings",
    "max16-absolute-bounds",
  ]) {
    const extreme = flow === "max16-absolute-bounds";
    const warnings = flow !== "max16-ordinary";
    const init = Buffer.from(
      await transport.exchange(Buffer.from("b057000100", "hex")),
    );
    assert.equal(
      init.length,
      18,
      "Requires test-only allocator instrumentation",
    );
    assert.equal(init.subarray(-2).toString("hex"), "9000");
    const owner = extreme
      ? await emulator.approve(
          () => client.exportAccount(0x7fff_ffff),
          "Approve export",
          "maximum-account-export",
        )
      : account;
    const signed = await emulator.approve(
      () => client.signBundle(bundle(warnings, owner, extreme), owner),
      "Sign Pearl transfer",
      flow,
    );
    assert.equal(signed.signatures.length, 16);
    const response = Buffer.from(
      await transport.exchange(Buffer.from("b057010100", "hex")),
    );
    assert.equal(response.length, 18);
    assert.equal(response.subarray(-2).toString("hex"), "9000");
    const [stackUsed, heapPeak, heapCurrent, heapCapacity] = [0, 4, 8, 12].map(
      (i) => response.readUInt32BE(i),
    );
    assert(
      stackUsed! > 0 && stackUsed! < stackSpan,
      "App stack exceeds linker capacity",
    );
    assert(
      heapPeak! > 0 && heapPeak! <= heapCapacity!,
      "Allocator exceeds configured capacity",
    );
    const result = {
      flow: flow,
      stackSpan,
      stackUsed,
      stackRemaining: stackSpan - stackUsed!,
      heapPeak,
      heapCurrent,
      heapCapacity,
      heapRemaining: heapCapacity! - heapPeak!,
    };
    measurements.push(result);
    console.log("MEMORY", model, JSON.stringify(result));
  }
  const hash = async (path: string) =>
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(
      {
        status: "passed",
        firmware: emulator.provenance,
        instrumentationPatchSha256: await hash(
          join(root, "apps/ledger/patches/memory-instrumentation.patch"),
        ),
        releasePatchSha256: await hash(
          join(root, "apps/ledger/patches/strict-transport.patch"),
        ),
        compiler: "nightly-2025-12-05",
        features: ["simnet", "ledger_device_sdk/stack_usage"],
        measurement:
          "SDK stack paint/high-water and allocator used() sampled after every allocation",
        limitations: [
          "Separate instrumented ELF, not release binary",
          "OS/syscall stack unmeasured",
          "Allocator peak occupancy does not establish worst-case fragmentation",
          "Speculos does not establish physical device margin",
        ],
        measurements,
      },
      null,
      2,
    ),
  );
} finally {
  await emulator.stop();
}
