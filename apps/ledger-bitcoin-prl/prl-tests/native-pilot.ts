/** Real secure SDK app in Speculos. Public BIP32 vector-one seed only. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HDKey } from "@scure/bip32";
import { Emulator, type Model } from "./emulator.ts";
import {
  accountFromJson,
  accountToJson,
  bundleFromJson,
  bundleToJson,
  deriveAddress,
  parsePrl,
  scriptToAddress,
  SpeculosTransport,
  validateBundle,
} from "../../../packages/sdk/src/index.ts";
import { LedgerBitcoinPrlClient } from "../../../packages/bitcoin-prl-adapter/src/index.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL ?? "nanosp") as Model;
const target = model === "nanosp" ? "nanos2" : model;
const network = process.env.PEARL_TEST_NETWORK ?? "regtest";
assert(
  network === "regtest" || network === "mainnet",
  "Unsupported pilot network",
);
const recipientType = process.env.PEARL_TEST_RECIPIENT ?? "p2tr";
assert(
  recipientType === "p2tr" || recipientType === "p2mr",
  "Unsupported pilot recipient",
);
const output =
  process.env.PEARL_EVIDENCE ??
  (await mkdtemp("/workspace/shared/prl-bitcoin-pilot-"));
const elf =
  process.env.PEARL_APP_ELF ??
  join(root, `apps/ledger-bitcoin-prl/build/${target}/bin/app.elf`);
const emulator = new Emulator(
  model,
  elf,
  output,
  Number(process.env.SPECULOS_API_PORT ?? 5121),
);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const expected = accountFromJson({
  ...fixture.publicAccount,
  network,
});
if (network === "mainnet") {
  // Public vector-one test seed only; signing still happens exclusively in Speculos.
  const master = HDKey.fromMasterSeed(
    Buffer.from("000102030405060708090a0b0c0d0e0f", "hex"),
  );
  const key = master.derive("m/86'/808276'/0'");
  expected.publicKey = Uint8Array.from(key.publicKey!);
  expected.chainCode = Uint8Array.from(key.chainCode!);
  key.wipePrivateData();
  master.wipePrivateData();
}
const bundle = bundleFromJson({ ...fixture.bundle, network });
if (recipientType === "p2mr")
  bundle.outputs[0]!.scriptPubKey = Uint8Array.from([
    0x52,
    0x20,
    ...new Uint8Array(32).fill(255),
  ]);
if (network === "mainnet") {
  for (const input of bundle.inputs)
    input.scriptPubKey = deriveAddress(
      expected,
      input.branch,
      input.index,
    ).scriptPubKey;
  for (const output of bundle.outputs)
    if (output.role === "change")
      output.scriptPubKey = deriveAddress(
        expected,
        output.branch,
        output.index,
      ).scriptPubKey;
}
try {
  await emulator.start();
  const client = new LedgerBitcoinPrlClient(
    new SpeculosTransport(emulator.url),
    network,
  );
  assert.equal((await client.capabilities()).capabilityFlags, 3);
  const account = await emulator.approve(
    () => client.exportAccount(0),
    "Approve public key",
    "account",
  );
  assert.deepEqual(accountToJson(account), accountToJson(expected));
  const address = await emulator.approve(
    () => client.verifyAddress(account, 0, 0),
    "Confirm",
    "address",
  );
  assert.equal(address, deriveAddress(account, 0, 0).address);
  const signed = await emulator.approve(
    () => client.signBundle(bundle, account),
    "Sign transaction",
    "sign",
  );
  assert.equal(signed.signatures.length, 2);
  let reviewed;
  if (recipientType === "p2mr") {
    assert(
      model === "nanosp" || model === "nanox",
      "Pilot display assertions require Nano layout",
    );
    const screens = emulator.screens.filter(
      (screen) => screen.label === "sign",
    );
    const value = (title: RegExp) =>
      screens
        .filter((screen) => title.test(screen.events[0]?.text ?? ""))
        .map((screen) =>
          screen.events
            .slice(1)
            .map((event) => event.text)
            .join(""),
        )
        .join("");
    const recipient = scriptToAddress(bundle.outputs[0]!.scriptPubKey, network);
    assert.equal(
      value(/^To(?: \(\d+\/\d+\))?$/),
      recipient,
      "Incomplete or wrong recipient display",
    );
    assert.equal(value(/^Recipient type$/), "P2MR");
    const amount = value(/^Amount$/),
      fee = value(/^Fees$/);
    assert(amount.endsWith(" PRL") && fee.endsWith(" PRL"));
    assert.equal(parsePrl(amount.slice(0, -4)), bundle.outputs[0]!.amount);
    assert.equal(
      parsePrl(fee.slice(0, -4)),
      validateBundle(bundle, account).fee,
    );
    reviewed = { recipient, amount, fee, recipientType: "P2MR" };
  }
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        network,
        recipientType,
        reviewed,
        firmware: emulator.provenance,
        publicAccount: accountToJson(account),
        bundle: bundleToJson(bundle),
        txid: signed.txid,
        rawTx: Buffer.from(signed.bytes).toString("hex"),
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${model}: tagged app-bitcoin PRL fork, full account/address/signature proof`,
  );
} finally {
  await emulator.stop();
}
