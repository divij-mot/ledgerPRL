/** Public BIP32 vector only. Boundaries omitted by baseline; immutable ELFs. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { Emulator, pause, type Model } from "./speculos-driver.ts";
import {
  accountFromJson,
  bundleFromJson,
  deriveAddress,
  LedgerPearlClient,
  SpeculosTransport,
  type SigningBundle,
} from "../../../packages/sdk/src/index.ts";
const model = (process.env.SPECULOS_MODEL ||
    process.argv[2] ||
    "nanosp") as Model,
  target = model === "nanosp" ? "nanosplus" : model;
const repo = resolve(import.meta.dirname, "../../..");
const root = process.env.PEARL_DISPLAY_EVIDENCE;
assert(
  root,
  "Set PEARL_DISPLAY_EVIDENCE to a fresh evidence root on a sufficiently large filesystem",
);
const e = new Emulator(
  model,
  process.env.PEARL_APP_ELF ||
    join(repo, `apps/ledger/target/artifacts/pearl-${target}-simnet.elf`),
  `${root}/extreme-paths-${model}-r1`,
  Number(process.env.SPECULOS_API_PORT) ||
    5181 + ["nanosp", "nanox", "stax", "flex", "apex_p"].indexOf(model) * 2,
);
const f = JSON.parse(
  await readFile(join(repo, "fixtures/protocol-v1.json"), "utf8"),
);
const expected = JSON.parse(
  await readFile(`${root}/baseline-${model}-simnet-r1/expected.json`, "utf8"),
);
const account = accountFromJson(expected.account),
  maxAccount = accountFromJson(expected.maxAccount);
function normal(): SigningBundle {
  return bundleFromJson({ ...f.bundle, network: "simnet" });
}
const checks: any[] = [];
try {
  await e.start();
  const client = new LedgerPearlClient(new SpeculosTransport(e.url), "simnet");
  const b = normal();
  b.account = 2147483647;
  b.inputs = [
    {
      ...b.inputs[0]!,
      amount: 2100000000000000000n,
      index: 2147483647,
      scriptPubKey: deriveAddress(maxAccount, 0, 2147483647).scriptPubKey,
    },
  ];
  b.outputs = [
    { ...b.outputs[0]!, amount: 1n },
    {
      ...b.outputs[1]!,
      amount: 1n,
      index: 2147483647,
      scriptPubKey: deriveAddress(maxAccount, 1, 2147483647).scriptPubKey,
    },
  ];
  await e.approve(
    () => client.signBundle(b, maxAccount),
    "Sign Pearl transfer",
    "all-warnings-max",
  );
  const all = e.screens
    .filter((s) => s.label === "all-warnings-max")
    .map((s) => s.text)
    .join("\n");
  for (const name of [
    "Unusual account",
    "Unusual input path",
    "Unusual change path",
    "High transaction fee",
  ])
    assert(all.includes(name), name);
  const occurrences = e.screens.filter(
    (s) =>
      s.label === "all-warnings-max" &&
      s.events.some((v) => v.text === "Review anyway"),
  ).length;
  assert.equal(occurrences, 4);
  checks.push({
    case: "all-warnings-max",
    explicitWarningApprovals: occurrences,
    account: 2147483647,
    inputIndex: 2147483647,
    changeIndex: 2147483647,
    fee: "20999999999.99999998 PRL",
    nativeSignatureVerified: true,
  });
  for (const [name, total, recipient, expectedWarning] of [
    ["zero-fee", 1n, 1n, false],
    ["max-amount-zero-fee", 2100000000000000000n, 2100000000000000000n, false],
    ["high-fee-below", 100001n, 90001n, false],
    ["high-fee-ceiling", 100001n, 90000n, true],
    ["small-total-exception", 100000n, 1n, false],
  ] as const) {
    const x = normal();
    x.inputs = [{ ...x.inputs[0]!, amount: total }];
    x.outputs = [{ ...x.outputs[0]!, amount: recipient }];
    await e.approve(
      () => client.signBundle(x, account),
      "Sign Pearl transfer",
      name,
    );
    const warned = e.screens.some(
      (s) => s.label === name && s.text.includes("High transaction fee"),
    );
    assert.equal(warned, expectedWarning, name);
    checks.push({
      case: name,
      inputGrains: total.toString(),
      recipientGrains: recipient.toString(),
      feeGrains: (total - recipient).toString(),
      warning: warned,
      nativeSignatureVerified: true,
    });
  }
  await writeFile(
    `${e.output}/results.json`,
    JSON.stringify(
      { status: "passed", model, firmware: e.provenance, checks },
      null,
      2,
    ),
  );
  console.log("EXTREME PATHS COMPLETE", model);
} finally {
  await e.stop();
}
