import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountFromJson,
  accountToJson,
  decodeBundle,
  encodeBundle,
  fromHex,
  serializeUnsignedTransaction,
} from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  exportWalletBackup,
  importWalletBackup,
  MAX_BACKUP_BYTES,
  type WalletJournal,
} from "../src/index.js";

const vector = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = accountFromJson(vector.publicAccount);

// A conservative serialization envelope, deliberately not a spendable journal.
// Duplicate dummy records need no cryptographic validation to bound their size.
// The separate preservation test below uses independently verified real fixtures.
function maximumShape(): WalletJournal {
  const bundle = decodeBundle(fromHex(vector.bundleHex));
  bundle.inputs = Array.from({ length: 16 }, (_, vout) => ({
    ...bundle.inputs[0]!,
    vout,
  }));
  assert.equal(encodeBundle(bundle).length, 1507);
  // Exact key-path witnesses add marker/flag and 1 + 1 + 64 bytes per input.
  const rawHexLength =
    2 * (serializeUnsignedTransaction(bundle).length + 2 + 16 * 66);
  assert.equal(rawHexLength, 3620);
  return {
    schema: 1,
    nextChangeIndex: 0x7fffffff,
    issuedReceiveThrough: 0x7fffffff,
    payments: Array.from({ length: 2000 }, () => ({
      id: "a".repeat(64),
      state: "broadcast-unknown",
      createdAt: Number.MAX_SAFE_INTEGER,
      bundleHex: "a".repeat(3014),
      outpoints: Array(16).fill("a".repeat(64) + ":4294967295"),
      txid: "a".repeat(64),
      rawTx: "a".repeat(rawHexLength),
      lastError: "\u0000".repeat(1000),
      archived: {
        status: "confirmed",
        block: { height: 0xffffffff, hash: "a".repeat(64) },
        checkedAt: Number.MAX_SAFE_INTEGER,
      },
    })),
  };
}

test("compact recovery export fits the full canonical 2000-record envelope", () => {
  const largestAccount = {
    ...account,
    network: "testnet2" as const,
    account: 0x7fffffff,
  };
  const encodedAccount = accountToJson(largestAccount);
  assert.deepEqual(
    [
      encodedAccount.masterFingerprint.length,
      encodedAccount.publicKey.length,
      encodedAccount.chainCode.length,
    ],
    [8, 66, 64],
  );
  const journal = maximumShape();
  const full = JSON.stringify({
    schema: 2,
    kind: "pearl-watch-backup",
    account: encodedAccount,
    journal,
  });
  assert.equal(Buffer.byteLength(full), 28618384);
  assert(
    Buffer.byteLength(full) > MAX_BACKUP_BYTES,
    "Compact JSON alone is insufficient",
  );
  const exported = exportWalletBackup(largestAccount, journal);
  assert.equal(Buffer.byteLength(exported), 16588384);
  assert(Buffer.byteLength(exported) < MAX_BACKUP_BYTES);
  const parsed = JSON.parse(exported);
  const expected = {
    ...journal,
    payments: journal.payments.map(
      ({ lastError: _diagnostic, ...payment }) => payment,
    ),
  };
  assert.deepEqual(parsed.account, encodedAccount);
  assert.deepEqual(
    parsed.journal,
    expected,
    "All recovery fields, including archive records, must survive",
  );
  assert.equal(
    journal.payments[0]!.lastError,
    "\u0000".repeat(1000),
    "Export must not mutate the local journal",
  );
});

test("export removes diagnostics and local callback authority while old backups remain readable", () => {
  const journal = emptyJournal();
  reservePayment(
    journal,
    decodeBundle(fromHex(vector.bundleHex)),
    "capacity-fixture",
    1,
  );
  transitionPayment(journal, "capacity-fixture", "signing");
  const p = journal.payments[0]!;
  p.signingAttempt = {
    id: "11111111-1111-4111-8111-111111111111",
    recovery: false,
  };
  p.lastError = "Old diagnostic";
  let encoded = JSON.parse(exportWalletBackup(account, journal));
  assert.equal(encoded.journal.payments[0].signingAttempt, undefined);
  assert.equal(encoded.journal.payments[0].lastError, undefined);
  assert.deepEqual(encoded.journal.payments[0], {
    id: p.id,
    state: p.state,
    createdAt: p.createdAt,
    bundleHex: p.bundleHex,
    outpoints: p.outpoints,
  });
  transitionPayment(journal, p.id, "signed", {
    rawTx: vector.rawTx,
    txid: vector.txid,
  });
  p.archived = {
    status: "confirmed",
    block: { height: 1, hash: "ab".repeat(32) },
    checkedAt: 10,
  };
  encoded = JSON.parse(exportWalletBackup(account, journal));
  assert.deepEqual(encoded.journal.payments[0].archived, p.archived);
  assert.equal(encoded.journal.payments[0].rawTx, vector.rawTx);
  assert.equal(encoded.journal.payments[0].txid, vector.txid);
  encoded.journal.payments[0].lastError = "Legacy diagnostic";
  const restored = importWalletBackup(JSON.stringify(encoded, null, 2));
  assert.equal(restored.journal.payments[0]!.lastError, "Legacy diagnostic");
  assert.equal(restored.journal.payments[0]!.rawTx, vector.rawTx);
  assert.deepEqual(restored.journal.payments[0]!.outpoints, p.outpoints);
  assert.equal(
    restored.journal.payments[0]!.archived,
    undefined,
    "Imported archive evidence still requires rechecking",
  );
});
