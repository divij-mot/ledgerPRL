import { tmpdir } from "node:os";
/** Real application smoke test on all device emulators, never a software signer. */
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  accountFromJson,
  accountToJson,
  bundleFromJson,
  deriveAddress,
  LedgerPearlClient,
  SpeculosTransport,
  command,
  concat,
  u16,
  sha256,
  encodeBundle,
  hex,
} from "../../../packages/sdk/src/index.ts";
import { Emulator, type Model } from "./speculos-driver.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL || "stax") as Model;
const target = model === "nanosp" ? "nanosplus" : model;
const elf =
  process.env.PEARL_APP_ELF ||
  join(root, `apps/ledger/target/artifacts/pearl-${target}-simnet.elf`);
const output =
  process.env.PEARL_EVIDENCE ||
  (await mkdtemp(join(tmpdir(), `pearl-native-${model}-smoke-`)));
const emulator = new Emulator(model, elf, output);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const expected = accountFromJson({
  ...fixture.publicAccount,
  network: "simnet",
});
const bundle = bundleFromJson({ ...fixture.bundle, network: "simnet" });
try {
  await emulator.start();
  const client = new LedgerPearlClient(
    new SpeculosTransport(emulator.url),
    "simnet",
  );
  const account = await emulator.approve(
    () => client.exportAccount(0),
    "Approve export",
    "account",
  );
  assert.deepEqual(accountToJson(account), accountToJson(expected));
  // Send invalid external recipient x-only keys directly so the native SDK
  // point validator is exercised even though the host encoder rejects them.
  const transport = new SpeculosTransport(emulator.url);
  for (const fill of [0, 255]) {
    const malformed = encodeBundle(bundle);
    const recipientKeyOffset = 19 + 87 * bundle.inputs.length + 8 + 2;
    malformed.fill(fill, recipientKeyOffset, recipientKeyOffset + 32);
    assert.equal(
      hex(
        await transport.exchange(
          command(0x10, concat(u16(malformed.length), sha256(malformed))),
        ),
      ),
      "9000",
    );
    for (let offset = 0; offset < malformed.length; offset += 253)
      assert.equal(
        hex(
          await transport.exchange(
            command(
              0x11,
              concat(u16(offset), malformed.slice(offset, offset + 253)),
            ),
          ),
        ),
        "9000",
      );
    assert.equal(hex(await transport.exchange(command(0x12))), "6a80");
  }
  const receive = await emulator.approve(
    () => client.verifyAddress(account, 0, 0),
    "Confirm",
    "address",
  );
  assert.equal(receive, deriveAddress(expected, 0, 0).address);
  const signed = await emulator.approve(
    () => client.signBundle(bundle, account),
    "Sign Pearl transfer",
    "sign",
  );
  assert.equal(signed.signatures.length, 2);
  await writeFile(
    join(output, "evidence.json"),
    JSON.stringify(
      {
        status: "passed",
        firmware: emulator.provenance,
        checks: [
          "exact-public-account-fixture",
          "invalid-xonly-zero",
          "invalid-xonly-ff",
          "SDK-BN-cleanup-recovery",
          "verified-full-address",
          "two-native-BIP340-signatures",
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${model}: account fixture, invalid recipient point rejection/BN cleanup, trusted full address, two native BIP340 signatures independently verified`,
  );
} finally {
  await emulator.stop();
}
