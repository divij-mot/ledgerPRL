import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountFromJson,
  bundleFromJson,
  finalizeTransaction,
  fromHex,
} from "@pearl-ledger/sdk";
import { importWalletBackup } from "@pearl-ledger/wallet";
import { signedRecoveryBackup } from "../src/signed-recovery.js";
const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = accountFromJson(fixture.publicAccount),
  bundle = bundleFromJson(fixture.bundle);
const result = finalizeTransaction(bundle, fixture.signatures.map(fromHex));

test("storage-failure recovery uses the standard independently validated backup format", () => {
  const restored = importWalletBackup(
    signedRecoveryBackup(
      account,
      bundle,
      result,
      "emergency-public-fixture",
      1000,
    ),
  );
  assert.equal(restored.journal.payments.length, 1);
  const payment = restored.journal.payments[0]!;
  assert.equal(payment.state, "signed");
  assert.equal(payment.rawTx, result.rawTx);
  assert.equal(payment.txid, result.txid);
  assert.equal(payment.createdAt, 1000);
  assert.equal(payment.outpoints.length, bundle.inputs.length);
  assert.equal(restored.account.network, account.network);
});
test("storage-failure export refuses altered bytes, transaction IDs and invalid signatures", () => {
  assert.throws(() =>
    signedRecoveryBackup(
      account,
      bundle,
      { ...result, rawTx: result.rawTx + "00" },
      "fixture",
      1000,
    ),
  );
  assert.throws(() =>
    signedRecoveryBackup(
      account,
      bundle,
      { ...result, txid: "00".repeat(32) },
      "fixture",
      1000,
    ),
  );
  assert.throws(() =>
    signedRecoveryBackup(
      account,
      bundle,
      {
        ...result,
        signatures: result.signatures.map(() => new Uint8Array(64)),
      },
      "fixture",
      1000,
    ),
  );
});
