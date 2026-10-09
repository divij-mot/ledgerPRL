import { tmpdir } from "node:os";
/** Public fixture benchmark. Wall time includes UI gesture, Speculos, transport and host verification. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  accountFromJson,
  bundleFromJson,
  deriveAddress,
  LedgerPearlClient,
  SpeculosTransport,
} from "../../../packages/sdk/src/index.ts";
import { Emulator, type Model } from "./speculos-driver.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL || "nanox") as Model;
const target = model === "nanosp" ? "nanosplus" : model;
const output =
  process.env.PEARL_EVIDENCE ||
  (await mkdtemp(join(tmpdir(), `pearl-native-${model}-latency-`)));
const emulator = new Emulator(
  model,
  join(root, `apps/ledger/target/artifacts/pearl-${target}-simnet.elf`),
  output,
  5071,
);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const account = accountFromJson({
  ...fixture.publicAccount,
  network: "simnet",
});
try {
  await emulator.start();
  const client = new LedgerPearlClient(
    new SpeculosTransport(emulator.url),
    "simnet",
  );
  for (let round = 0; round < 5; round++) {
    const bundle = bundleFromJson({ ...fixture.bundle, network: "simnet" });
    bundle.inputs = Array.from({ length: 16 }, (_, i) => ({
      ...bundle.inputs[0]!,
      vout: i,
      index: round * 16 + i,
      amount: 100_000_000n,
      scriptPubKey: deriveAddress(account, 0, round * 16 + i).scriptPubKey,
    }));
    bundle.outputs[0] = { ...bundle.outputs[0]!, amount: 800_000_000n };
    bundle.outputs[1] = { ...bundle.outputs[1]!, amount: 799_990_000n };
    const signed = await emulator.approve(
      () => client.signBundle(bundle, account),
      "Sign Pearl transfer",
      `max16-round-${round + 1}`,
    );
    assert.equal(signed.signatures.length, 16);
  }
  const times = emulator.approvalTimings
    .map((t) => t.gestureToResultMs)
    .sort((a, b) => a - b);
  const evidence = {
    status: "passed",
    firmware: emulator.provenance,
    inputCount: 16,
    rounds: 5,
    measurements: emulator.approvalTimings,
    minMs: times[0],
    medianMs: times[2],
    maxMs: times[4],
    scope:
      "Emulator wall time from starting final physical approval gesture through fetching and independently verifying all16 signatures; not device CPU or hardware timing",
    gestureIncludes:
      model === "nanosp" || model === "nanox"
        ? "default button press/release delay"
        : "2.5-second touch hold",
  };
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(evidence, null, 2),
  );
  console.log(
    "LATENCY",
    model,
    JSON.stringify({
      minMs: evidence.minMs,
      medianMs: evidence.medianMs,
      maxMs: evidence.maxMs,
    }),
  );
} finally {
  await emulator.stop();
}
