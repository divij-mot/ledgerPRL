import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { accountFromJson, decodeBundle, fromHex } from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  exportWalletBackup,
  importWalletBackup,
  mergeRestoredJournal,
  reservedOutpoints,
  reconcileConfirmed,
  exportPublicRecovery,
  importPublicRecovery,
  recordVerifiedReceive,
  resetUnsignedAttempt,
  recordRecoveryPaths,
  preparePayment,
  parseWatchSnapshot,
  outpoint,
  discoverAccount,
} from "../src/index.js";
const vector = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = accountFromJson(vector.publicAccount),
  bundle = decodeBundle(fromHex(vector.bundleHex));
function signedJournal() {
  const journal = emptyJournal();
  reservePayment(journal, bundle, "payment-fixture", 1000);
  transitionPayment(journal, "payment-fixture", "signing");
  transitionPayment(journal, "payment-fixture", "signed", {
    rawTx: vector.rawTx,
    txid: vector.txid,
  });
  transitionPayment(journal, "payment-fixture", "broadcast-unknown");
  return journal;
}
test("complete backup restores exact verified bytes, uncertain state and reservations in a new journal", () => {
  const original = signedJournal(),
    backup = importWalletBackup(exportWalletBackup(account, original)),
    restored = emptyJournal();
  mergeRestoredJournal(restored, backup.journal);
  assert.equal(restored.payments[0]!.rawTx, vector.rawTx);
  assert.equal(restored.payments[0]!.state, "broadcast-unknown");
  assert.equal(reservedOutpoints(restored).size, 2);
  assert.equal(restored.nextChangeIndex, 1);
});
test("backup restore independently rejects altered signatures, bundle reservations, account and state", () => {
  const initial = JSON.parse(exportWalletBackup(account, signedJournal()));
  for (const mutate of [
    (v: any) =>
      (v.journal.payments[0].rawTx = v.journal.payments[0].rawTx.replace(
        "0baf38",
        "0baf39",
      )),
    (v: any) => (v.journal.payments[0].outpoints = []),
    (v: any) => (v.account.account = 1),
    (v: any) => (v.journal.payments[0].state = "draft"),
    (v: any) => (v.journal.nextChangeIndex = 0),
  ]) {
    const v = structuredClone(initial);
    mutate(v);
    assert.throws(() => importWalletBackup(JSON.stringify(v)));
  }
});
test("old draft backup never downgrades a later uncertain/signature state", () => {
  const old = emptyJournal();
  reservePayment(old, bundle, "payment-fixture");
  const current = signedJournal();
  mergeRestoredJournal(current, old);
  assert.equal(current.payments[0]!.state, "broadcast-unknown");
  assert.equal(current.payments[0]!.rawTx, vector.rawTx);
});
test("same-ID or duplicate outpoint conflicts fail without silently overriding a payment", () => {
  const current = signedJournal(),
    other = structuredClone(current);
  other.payments[0]!.bundleHex = other.payments[0]!.bundleHex + "00";
  assert.throws(() => mergeRestoredJournal(current, other), /Conflicting/);
  const separate = structuredClone(current);
  separate.payments[0]!.id = "different-payment";
  assert.throws(() => mergeRestoredJournal(current, separate), /reservation/);
});
test("confirmed archival retains locks and signed bytes, and reorg unarchives safely", () => {
  const journal = signedJournal(),
    block = { height: 10, hash: "11".repeat(32) };
  const history = [
    {
      txid: vector.txid,
      received: 0n,
      spent: 1n,
      block,
      state: "confirmed" as const,
    },
  ];
  assert.equal(
    reconcileConfirmed(journal, history, { height: 15, hash: "22".repeat(32) }),
    1,
  );
  assert(journal.payments[0]!.archived);
  assert.equal(reservedOutpoints(journal).size, 2);
  assert.equal(
    importWalletBackup(exportWalletBackup(account, journal)).journal
      .payments[0]!.archived,
    undefined,
  );
  reconcileConfirmed(journal, [], { height: 15, hash: "33".repeat(32) });
  assert.equal(journal.payments[0]!.archived, undefined);
  assert.equal(journal.payments[0]!.rawTx, vector.rawTx);
});
test("consecutive receive issuance and public recovery ranges survive export", () => {
  const journal = emptyJournal();
  recordVerifiedReceive(journal, 0);
  assert.throws(() => recordVerifiedReceive(journal, 2), /consecutive/);
  recordVerifiedReceive(journal, 1);
  assert.equal(
    importPublicRecovery(exportPublicRecovery(account, journal))
      .issuedReceiveThrough,
    1,
  );
});
test("failed unsigned initial attempt becomes discardable draft; generic signed state cannot reset", () => {
  const journal = emptyJournal();
  reservePayment(journal, bundle, "payment-fixture");
  const attemptId = "00000000-0000-4000-8000-000000000001";
  transitionPayment(journal, "payment-fixture", "signing").signingAttempt = {
    id: attemptId,
    recovery: false,
  };
  resetUnsignedAttempt(journal, "payment-fixture", attemptId);
  assert.equal(journal.payments[0]!.state, "draft");
  assert.equal(journal.payments[0]!.signingAttempt, undefined);
  assert.throws(() =>
    resetUnsignedAttempt(signedJournal(), "payment-fixture", attemptId),
  );
});

test("interrupted signing requires an owned initial attempt; recovery and old records cannot reset", () => {
  const j = emptyJournal(),
    id = "payment-fixture",
    attemptId = "00000000-0000-4000-8000-000000000001";
  reservePayment(j, bundle, id);
  const p = transitionPayment(j, id, "signing");
  assert.throws(() => resetUnsignedAttempt(j, id, attemptId));
  p.signingAttempt = { id: attemptId, recovery: true };
  assert.throws(() => resetUnsignedAttempt(j, id, attemptId));
  p.signingAttempt.recovery = false;
  assert.throws(() =>
    resetUnsignedAttempt(j, id, "00000000-0000-4000-8000-000000000002"),
  );
  p.rawTx = "";
  assert.throws(() => resetUnsignedAttempt(j, id, attemptId));
  delete p.rawTx;
  p.txid = vector.txid;
  assert.throws(() => resetUnsignedAttempt(j, id, attemptId));
  delete p.txid;
  assert.equal(p.state, "signing");
  assert.equal(reservedOutpoints(j).size, bundle.inputs.length);
});

test("backup ownership is strictly validated then stripped; legacy signing ambiguity survives", () => {
  const j = emptyJournal();
  reservePayment(j, bundle, "payment-fixture");
  const p = transitionPayment(j, "payment-fixture", "signing");
  p.signingAttempt = {
    id: "00000000-0000-4000-8000-000000000001",
    recovery: true,
  };
  const backup = exportWalletBackup(account, j);
  assert(!backup.includes("signingAttempt"));
  assert(p.signingAttempt, "export must not mutate the live attempt");
  const restored = importWalletBackup(backup).journal;
  assert.equal(restored.payments[0]!.state, "signing");
  assert.equal(restored.payments[0]!.signingAttempt, undefined);
  assert.equal(reservedOutpoints(restored).size, 2);
  const input = JSON.parse(backup);
  input.journal.payments[0].signingAttempt = p.signingAttempt;
  assert.equal(
    importWalletBackup(JSON.stringify(input)).journal.payments[0]!
      .signingAttempt,
    undefined,
  );
  for (const invalid of [
    { id: "bad", recovery: true },
    { id: p.signingAttempt.id, recovery: "yes" },
    { ...p.signingAttempt, extra: 1 },
  ]) {
    input.journal.payments[0].signingAttempt = invalid;
    assert.throws(() => importWalletBackup(JSON.stringify(input)));
  }
});

test("equal-state ambiguous backup merge revokes rollback without importing ownership", () => {
  const j = emptyJournal(),
    id = "payment-fixture",
    attemptId = "00000000-0000-4000-8000-000000000001";
  reservePayment(j, bundle, id);
  const p = transitionPayment(j, id, "signing");
  p.signingAttempt = { id: attemptId, recovery: false };
  const incoming = structuredClone(j),
    before = structuredClone(j);
  incoming.payments[0]!.signingAttempt = {
    id: "00000000-0000-4000-8000-000000000002",
    recovery: true,
  };
  mergeRestoredJournal(j, incoming);
  assert.equal(p.signingAttempt, undefined);
  delete before.payments[0]!.signingAttempt;
  assert.deepEqual(j, before);
  assert.throws(() => resetUnsignedAttempt(j, id, attemptId));
  const empty = emptyJournal();
  mergeRestoredJournal(empty, incoming);
  assert.equal(empty.payments[0]!.signingAttempt, undefined);
  assert.equal(empty.payments[0]!.state, "signing");
  const draft = emptyJournal();
  reservePayment(draft, bundle, id);
  mergeRestoredJournal(draft, incoming);
  assert.equal(draft.payments[0]!.state, "signing");
  assert.equal(draft.payments[0]!.signingAttempt, undefined);
  assert.throws(() => resetUnsignedAttempt(draft, id, attemptId));
});

import {
  accountToJson,
  deriveAddress,
  concat,
  i32,
  u32,
  u64,
  compactSize,
  hex,
  parseTransaction,
  NETWORKS,
} from "@pearl-ledger/sdk";
import { publicAccount, blockHash } from "./fixtures.js";
function highIndexCoin(branch: 0 | 1, index: number) {
  const script = deriveAddress(publicAccount, branch, index).scriptPubKey;
  const raw = concat(
    i32(1),
    Uint8Array.of(1),
    new Uint8Array(32).fill(0x11),
    u32(0),
    Uint8Array.of(0),
    u32(0xffffffff),
    Uint8Array.of(1),
    u64(500000000n),
    compactSize(script.length),
    script,
    u32(0),
  );
  return {
    txid: parseTransaction(raw).txid,
    vout: 0,
    rawTransaction: hex(raw),
    branch,
    index,
    block: { height: 1, hash: blockHash(1) },
  };
}
for (const branch of [0, 1] as const)
  test(`no-change payment preserves branch ${branch} input recovery bounds on reservation and legacy restore`, () => {
    const coin = highIndexCoin(branch, 110);
    const snapshot = parseWatchSnapshot(
      JSON.stringify({
        schema: 1,
        account: accountToJson(publicAccount),
        genesisHash: NETWORKS.regtest.genesisHash,
        tip: { height: 200, hash: blockHash(200) },
        coverage: {
          externalScannedThrough: 999,
          changeScannedThrough: 999,
          gapLimit: 20,
        },
        coins: [coin],
      }),
    );
    const payment = preparePayment(snapshot, {
      selected: [outpoint(coin)],
      recipient: deriveAddress(publicAccount, 0, 1).address,
      amountPrl: "4.99999000",
      feePrl: "0.00001000",
      changeIndex: 0,
    });
    assert.equal(payment.outputs.length, 1);
    const journal = emptyJournal();
    reservePayment(journal, payment, "high-index-payment", 1000);
    assert.equal(
      branch === 0 ? journal.issuedReceiveThrough : journal.nextChangeIndex,
      branch === 0 ? 110 : 111,
    );
    // Legacy journals may have missed input paths before this fix. Ownership and
    // canonical bundle bytes, not an unverified coverage claim, restore the range.
    journal.issuedReceiveThrough = -1;
    journal.nextChangeIndex = 0;
    const restored = importWalletBackup(
      exportWalletBackup(publicAccount, journal),
    ).journal;
    assert.equal(
      branch === 0 ? restored.issuedReceiveThrough : restored.nextChangeIndex,
      branch === 0 ? 110 : 111,
    );
  });
test("recovery path bounds are monotonic and reject exhausted change atomically", () => {
  const journal = emptyJournal();
  recordRecoveryPaths(journal, [
    { branch: 0, index: 100 },
    { branch: 1, index: 110 },
  ]);
  recordRecoveryPaths(journal, [
    { branch: 0, index: 2 },
    { branch: 1, index: 3 },
  ]);
  assert.equal(journal.issuedReceiveThrough, 100);
  assert.equal(journal.nextChangeIndex, 111);
  const before = structuredClone(journal);
  assert.throws(
    () =>
      recordRecoveryPaths(journal, [
        { branch: 0, index: 200 },
        { branch: 1, index: 0x7fffffff },
      ]),
    /exhausted/,
  );
  assert.deepEqual(journal, before);
});
test("known paths beyond the light discovery bound require an extended scan", async () => {
  const journal = emptyJournal();
  recordRecoveryPaths(journal, [{ branch: 0, index: 1000 }]);
  let addresses = 0;
  await assert.rejects(
    discoverAccount(
      {
        network: "regtest",
        tip: async () => ({
          tip: { height: 200, hash: blockHash(200) },
          genesisHash: NETWORKS.regtest.genesisHash,
        }),
        address: async () => {
          addresses++;
          throw new Error("No truncated scan allowed");
        },
        transaction: async () => {
          throw new Error("No transaction needed");
        },
        blockHash: async (h) => blockHash(h),
      },
      publicAccount,
      {
        minimumIndex: [
          journal.issuedReceiveThrough,
          journal.nextChangeIndex - 1,
        ],
      },
    ),
    /extended scan/,
  );
  assert.equal(addresses, 0);
});

test("accepted same-byte retry returns to uncertain state without releasing reservations", () => {
  const journal = signedJournal();
  transitionPayment(journal, "payment-fixture", "accepted");
  const points = [...reservedOutpoints(journal)];
  transitionPayment(journal, "payment-fixture", "broadcast-unknown");
  assert.equal(journal.payments[0]!.state, "broadcast-unknown");
  assert.equal(journal.payments[0]!.rawTx, vector.rawTx);
  assert.equal(journal.payments[0]!.txid, vector.txid);
  assert.deepEqual([...reservedOutpoints(journal)], points);
  assert.throws(() => transitionPayment(journal, "payment-fixture", "signing"));
});
test("archival receipt must be reconciled before a same-byte retry transition", () => {
  const journal = signedJournal();
  transitionPayment(journal, "payment-fixture", "accepted");
  journal.payments[0]!.archived = {
    status: "confirmed",
    block: { height: 95, hash: "ab".repeat(32) },
    checkedAt: 1000,
  };
  const before = structuredClone(journal);
  assert.throws(
    () => transitionPayment(journal, "payment-fixture", "broadcast-unknown"),
    /Archived/,
  );
  assert.deepEqual(journal, before);
});
test("signed bytes and txid cannot be individually replaced or unset by a state transition", () => {
  for (const data of [
    { txid: "ab".repeat(32) },
    { rawTx: "" },
    { rawTx: undefined },
    { txid: undefined },
  ]) {
    const journal = signedJournal();
    transitionPayment(journal, "payment-fixture", "accepted");
    const before = structuredClone(journal);
    assert.throws(
      () =>
        transitionPayment(
          journal,
          "payment-fixture",
          "broadcast-unknown",
          data as Parameters<typeof transitionPayment>[3],
        ),
      /Cannot replace/,
    );
    assert.deepEqual(journal, before);
  }
});
test("backup merging cannot clear retry uncertainty in either matching-byte direction", () => {
  const uncertain = signedJournal();
  const accepted = structuredClone(uncertain);
  transitionPayment(accepted, "payment-fixture", "accepted");
  for (const [local, backup] of [
    [uncertain, accepted],
    [accepted, uncertain],
  ]) {
    const merged = structuredClone(local!);
    const restored = importWalletBackup(
      exportWalletBackup(account, backup!),
    ).journal;
    mergeRestoredJournal(merged, restored);
    assert.equal(merged.payments[0]!.state, "broadcast-unknown");
    assert.equal(merged.payments[0]!.rawTx, vector.rawTx);
    assert.equal(merged.payments[0]!.txid, vector.txid);
    assert.equal(reservedOutpoints(merged).size, 2);
  }
});
