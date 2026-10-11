/** Full-width amounts and path limits on the real native trusted display. */
import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { join, resolve } from "node:path";
import { HDKey } from "@scure/bip32";
import { Emulator, type Model } from "./emulator.ts";
import { LedgerBitcoinPrlClient } from "../../../packages/bitcoin-prl-adapter/src/index.ts";
import {
  SpeculosTransport,
  accountToJson,
  bundleFromJson,
  bundleToJson,
  computeSighash,
  deriveAddress,
  fromHex,
  hex,
  MAX_GRAINS,
  scriptToAddress,
} from "../../../packages/sdk/src/index.ts";
const root = resolve(import.meta.dirname, "../../..");
const model = (process.env.SPECULOS_MODEL ?? "nanosp") as Model,
  target = model === "nanosp" ? "nanos2" : model;
const elf =
  process.env.PEARL_APP_ELF ??
  join(
    root,
    `apps/ledger-bitcoin-prl/build-artifacts/${target}-regtest/app.elf`,
  );
const output =
  process.env.PEARL_EVIDENCE ??
  (await mkdtemp("/workspace/shared/prl-bitcoin-display-"));
const e = new Emulator(
  model,
  elf,
  output,
  Number(process.env.SPECULOS_API_PORT ?? 5191),
  1_000_000,
);
const fixture = JSON.parse(
  await readFile(join(root, "fixtures/protocol-v1.json"), "utf8"),
);
const results: { name: string; amount: string; fee: string; txid: string }[] =
  [];
try {
  await e.start();
  const client = new LedgerBitcoinPrlClient(
    new SpeculosTransport(e.url),
    "regtest",
  );
  const account = await e.approve(
    () => client.exportAccount(0),
    "Approve public key",
    "account",
  );
  const cases = [
    {
      name: "two53-minus-one",
      amount: (1n << 53n) - 1n,
      fee: 1000n,
      shown: "90071992.54740991 PRL",
    },
    {
      name: "two53-plus-one",
      amount: (1n << 53n) + 1n,
      fee: 1000n,
      shown: "90071992.54740993 PRL",
    },
    {
      name: "max-minus-one",
      amount: MAX_GRAINS - 1n,
      fee: 1n,
      shown: "20999999999.99999999 PRL",
    },
    {
      name: "fraction-leading-zeros",
      amount: 100000001n,
      fee: 1000n,
      shown: "1.00000001 PRL",
    },
    {
      name: "fee-multiplication-overflow",
      amount: 200000000000000000n,
      fee: 1900000000000000000n,
      shown: "2000000000 PRL",
    },
    {
      name: "p2mr-opaque-ff-root",
      amount: 100000001n,
      fee: 1000n,
      shown: "1.00000001 PRL",
      p2mr: true,
    },
  ];
  for (const c of cases) {
    const b = bundleFromJson(fixture.bundle);
    b.inputs = b.inputs.slice(0, 1);
    b.outputs = b.outputs.slice(0, 1);
    b.inputs[0]!.amount = c.amount + c.fee;
    b.outputs[0]!.amount = c.amount;
    if (c.p2mr) b.outputs[0]!.scriptPubKey = fromHex("5220" + "ff".repeat(32));
    const signed = await e.approve(
      () => client.signBundle(b, account),
      "Sign transaction",
      c.name,
    );
    const screens = e.screens.filter((s) => s.label === c.name);
    const text = screens
      .map((s) => s.events.map((x) => x.text).join(""))
      .join("")
      .replace(/\s/g, "");
    assert(
      text.includes(c.shown.replace(/\s/g, "")),
      `${c.name}: exact displayed amount missing`,
    );
    if (c.p2mr) {
      assert(text.includes("P2MR"));
      assert(
        text.includes(scriptToAddress(b.outputs[0]!.scriptPubKey, "regtest")),
      );
    }
    if (c.name === "fee-multiplication-overflow") {
      assert(text.includes("19000000000PRL"));
      assert(/high|higher/i.test(text), "Missing high-fee warning");
    }
    const oracle = {
      description:
        "Native emulator, public vector-one seed only. No broadcast.",
      publicAccount: accountToJson(account),
      bundle: bundleToJson(b),
      sighashes: b.inputs.map((_, i) => hex(computeSighash(b, i))),
      signatures: signed.signatures.map(hex),
      rawTx: signed.rawTx,
      txid: signed.txid,
      wtxid: signed.wtxid,
      vsize: signed.vsize,
    };
    await writeFile(
      join(output, c.name + "-oracle.json"),
      JSON.stringify(oracle, null, 2) + "\n",
    );
    results.push({
      name: c.name,
      amount: c.amount.toString(),
      fee: c.fee.toString(),
      txid: signed.txid,
    });
  }
  const max = 0x7fffffff;
  const last = await e.approve(
    () => client.exportAccount(max),
    "Approve public key",
    "max-account",
  );
  const expected = HDKey.fromMasterSeed(
    fromHex("000102030405060708090a0b0c0d0e0f"),
  ).derive("m/86'/1'/2147483647'");
  assert.equal(hex(last.publicKey), hex(expected.publicKey!));
  assert.equal(hex(last.chainCode), hex(expected.chainCode!));
  expected.wipePrivateData();
  const address = await e.approve(
    () => client.verifyAddress(last, 1, max),
    "Confirm",
    "max-address",
  );
  assert.equal(address, deriveAddress(last, 1, max).address);
  const pathText = e.screens
    .filter((s) => s.label === "max-address")
    .map((s) => s.events.map((x) => x.text).join(""))
    .join("")
    .replace(/\s/g, "");
  assert(
    pathText.includes("m/86'/1'/2147483647'/1/2147483647"),
    "Full maximum path not shown",
  );
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        firmware: e.provenance,
        results,
        maxPath: { account: max, branch: 1, index: max, address },
      },
      null,
      2,
    ),
  );
  console.log(
    `PASS ${model}: exact amount, fee, P2MR and full 31-bit path displays; ${output}`,
  );
} finally {
  await e.stop();
}
