/** Regenerate published, worthless deterministic vectors. Never use these keys with funds. */
import { mkdirSync, writeFileSync } from "node:fs";
import {
  accountToJson,
  bundleToJson,
  computeSighash,
  deriveAddress,
  hex,
  MAX_GRAINS,
  scriptToAddress,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import {
  buildPrlPsbt,
  serializePrlPsbt,
  verifyAndFinalize,
} from "../src/index.js";
import {
  p2mrFixture,
  publicFixture,
  signFixture,
  withAmount,
} from "./fixtures.js";
const { account } = publicFixture();
const fixtures: [string, SigningBundle][] = [
  ["max-grains-payment", withAmount(MAX_GRAINS)],
  ["p2mr-payment", p2mrFixture().bundle],
];
const directory = new URL("fixtures/", import.meta.url);
mkdirSync(directory, { recursive: true });
for (const [name, bundle] of fixtures) {
  const signatures = signFixture(bundle),
    final = verifyAndFinalize(
      bundle,
      account,
      signatures.map((signature, inputIndex) => ({
        inputIndex,
        signature,
        pubkey: bundle.inputs[inputIndex]!.scriptPubKey.slice(2),
      })),
    );
  const value = {
    description:
      "PUBLIC TEST VECTOR ONLY: published BIP32 vector 1. No real node, device, broadcast or funds.",
    pearlRevision: "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701",
    ledgerRevision: "44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a",
    publicAccount: accountToJson(account),
    bundle: bundleToJson(bundle),
    psbtHex: hex(serializePrlPsbt(buildPrlPsbt(bundle, account))),
    sighashes: bundle.inputs.map((_, i) => hex(computeSighash(bundle, i))),
    signatures: signatures.map(hex),
    addresses: {
      input: deriveAddress(
        account,
        bundle.inputs[0]!.branch,
        bundle.inputs[0]!.index,
      ).address,
      recipient: scriptToAddress(
        bundle.outputs[0]!.scriptPubKey,
        bundle.network,
      ),
    },
    rawTx: final.rawTx,
    txid: final.txid,
    wtxid: final.wtxid,
    vsize: final.vsize,
  };
  writeFileSync(
    new URL(`${name}.json`, directory),
    JSON.stringify(value, null, 2) + "\n",
  );
}
