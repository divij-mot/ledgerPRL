import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Emulator, type Model } from "./speculos-driver.ts";
import {
  accountFromJson,
  bundleFromJson,
  LedgerPearlClient,
  SpeculosTransport,
  deriveAddress,
  scriptToAddress,
  formatPrl,
} from "../../../packages/sdk/src/index.ts";
const model = (process.env.SPECULOS_MODEL ||
  process.argv[2] ||
  "nanosp") as Model;
const target = model === "nanosp" ? "nanosplus" : model;
const repo = resolve(import.meta.dirname, "../../..");
const root = process.env.PEARL_DISPLAY_EVIDENCE;
assert(
  root,
  "Set PEARL_DISPLAY_EVIDENCE to a fresh evidence root on a sufficiently large filesystem",
);
const network = (process.argv[3] || "simnet") as "mainnet" | "simnet";
const port =
  Number(process.env.SPECULOS_API_PORT) ||
  5181 + ["nanosp", "nanox", "stax", "flex", "apex_p"].indexOf(model) * 2;
const e = new Emulator(
  model,
  process.env.PEARL_APP_ELF ||
    join(repo, `apps/ledger/target/artifacts/pearl-${target}-${network}.elf`),
  `${root}/baseline-${model}-${network}-${process.env.REVIEW_RUN || "r1"}`,
  port,
);
const f = JSON.parse(
  await readFile(join(repo, "fixtures/protocol-v1.json"), "utf8"),
);
try {
  await e.start();
  const c = new LedgerPearlClient(new SpeculosTransport(e.url), network);
  const account = await e.approve(
    () => c.exportAccount(0),
    "Approve export",
    "account-0",
  );
  await e.approve(() => c.verifyAddress(account, 0, 0), "Confirm", "receive-0");
  const maxAccount = await e.approve(
    () => c.exportAccount(2147483647),
    "Approve export",
    "account-max",
  );
  await e.approve(
    () => c.verifyAddress(maxAccount, 1, 2147483647),
    "Confirm",
    "address-max",
  );
  const b = bundleFromJson({ ...f.bundle, network });
  b.inputs = [
    {
      ...b.inputs[0]!,
      amount: 2100000000000000000n,
      scriptPubKey: deriveAddress(account, 0, 0).scriptPubKey,
    },
  ];
  b.outputs = [
    { ...b.outputs[0]!, amount: 2099999999999999998n },
    {
      ...b.outputs[1]!,
      amount: 1n,
      scriptPubKey: deriveAddress(account, 1, 0).scriptPubKey,
    },
  ];
  await e.approve(
    () => c.signBundle(b, account),
    "Sign Pearl transfer",
    "max-amount",
  );
  b.outputs = [{ ...b.outputs[0]!, amount: 1n }];
  await e.approve(
    () => c.signBundle(b, account),
    "Sign Pearl transfer",
    "max-fee",
  );
  const expected = {
    account,
    maxAccount,
    recipient: scriptToAddress(b.outputs[0]!.scriptPubKey, network),
    change: deriveAddress(account, 1, 0).address,
    receive: deriveAddress(account, 0, 0).address,
    extreme: deriveAddress(maxAccount, 1, 2147483647).address,
    maxAmount: "20999999999.99999998 PRL",
    maxFee: "20999999999.99999999 PRL",
  };
  await writeFile(
    `${e.output}/expected.json`,
    JSON.stringify(
      expected,
      (_k, v) => (v instanceof Uint8Array ? Buffer.from(v).toString("hex") : v),
      2,
    ),
  );
  console.log("BASELINE COMPLETE", model, network);
} finally {
  await e.stop();
}
