import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  accountFromJson,
  decodeBundle,
  encodeBundle,
  fromHex,
  hex,
  parseTransaction,
  concat,
  compactSize,
  i32,
  u32,
  u64,
} from "@pearl-ledger/sdk";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  validateStoredJournal,
  exportWalletBackup,
  importWalletBackup,
  mergeRestoredJournal,
  type WalletJournal,
} from "../src/index.js";

const fixture = JSON.parse(
  readFileSync(
    new URL("../../../fixtures/protocol-v1.json", import.meta.url),
    "utf8",
  ),
);
const account = accountFromJson(fixture.publicAccount),
  bundle = decodeBundle(fromHex(fixture.bundleHex));
function signed() {
  const j = emptyJournal();
  reservePayment(j, bundle, "integrity-payment", 1000);
  transitionPayment(j, "integrity-payment", "signing");
  transitionPayment(j, "integrity-payment", "signed", {
    rawTx: fixture.rawTx,
    txid: fixture.txid,
  });
  return j;
}
function distinct(n: number) {
  const b = structuredClone(bundle);
  b.inputs.forEach((input, i) => {
    input.txid = BigInt(n * 16 + i + 1)
      .toString(16)
      .padStart(64, "0");
  });
  const j = emptyJournal();
  reservePayment(j, b, `distinct-payment-${n}`, 1000);
  return j;
}

function rawTransaction(tx: ReturnType<typeof parseTransaction>): string {
  return hex(
    concat(
      i32(tx.version),
      Uint8Array.of(0, 1),
      compactSize(tx.inputs.length),
      ...tx.inputs.map((input) =>
        concat(
          fromHex(input.txid).reverse(),
          u32(input.vout),
          compactSize(input.scriptSig.length),
          input.scriptSig,
          u32(input.sequence),
        ),
      ),
      compactSize(tx.outputs.length),
      ...tx.outputs.map((output) =>
        concat(
          u64(output.amount),
          compactSize(output.scriptPubKey.length),
          output.scriptPubKey,
        ),
      ),
      ...tx.inputs.map((input) =>
        concat(
          compactSize(input.witness.length),
          ...input.witness.map((item) =>
            concat(compactSize(item.length), item),
          ),
        ),
      ),
      u32(tx.lockTime),
    ),
  );
}

test("stored-row validation distinguishes absent storage from corrupt null and retains legacy rows", () => {
  assert.deepEqual(validateStoredJournal(undefined), emptyJournal());
  for (const bad of [null, [], false, 0, "", {}, { schema: 1 }])
    assert.throws(() => validateStoredJournal(bad));
  const legacy = { schema: 1, nextChangeIndex: 0, payments: [] };
  assert.deepEqual(validateStoredJournal(legacy), emptyJournal());
  const j = signed(),
    prior = structuredClone(j);
  delete (j as Partial<WalletJournal>).issuedReceiveThrough;
  const normalized = validateStoredJournal(j);
  assert.deepEqual(normalized.payments, prior.payments);
  assert.equal(normalized.nextChangeIndex, prior.nextChangeIndex);
  assert.equal(normalized.issuedReceiveThrough, prior.issuedReceiveThrough);
});

test("stored recovery bounds are bounded safe integers, with no null or unknown-field default", () => {
  for (const value of [
    -1,
    0.5,
    0x80000000,
    Number.MAX_SAFE_INTEGER,
    null,
    undefined,
    "1",
    false,
  ]) {
    const j: any = emptyJournal();
    j.nextChangeIndex = value;
    assert.throws(() => validateStoredJournal(j));
  }
  for (const value of [
    -2,
    0.5,
    0x80000000,
    Number.MAX_SAFE_INTEGER,
    null,
    undefined,
    "1",
    false,
  ]) {
    const j: any = emptyJournal();
    j.issuedReceiveThrough = value;
    assert.throws(() => validateStoredJournal(j));
  }
  assert.throws(() =>
    validateStoredJournal({ ...emptyJournal(), extra: true }),
  );
  assert.deepEqual(
    validateStoredJournal({
      ...emptyJournal(),
      nextChangeIndex: 0x7fffffff,
      issuedReceiveThrough: 0x7fffffff,
    }),
    {
      ...emptyJournal(),
      nextChangeIndex: 0x7fffffff,
      issuedReceiveThrough: 0x7fffffff,
    },
  );
});

test("stored older input recovery ranges grow conservatively only after all records pass", () => {
  for (const branch of [0, 1] as const) {
    const b = structuredClone(bundle);
    b.inputs[0]!.branch = branch;
    b.inputs[0]!.index = 700;
    const j = emptyJournal();
    reservePayment(j, b, `older-path-${branch}`, 1000);
    j.issuedReceiveThrough = -1;
    j.nextChangeIndex = 1;
    const beforePayments = structuredClone(j.payments);
    validateStoredJournal(j);
    assert.equal(
      branch === 0 ? j.issuedReceiveThrough : j.nextChangeIndex,
      branch === 0 ? 700 : 701,
    );
    assert.deepEqual(j.payments, beforePayments);
    j.issuedReceiveThrough = -1;
    j.nextChangeIndex = 1;
    j.payments.push({
      ...structuredClone(j.payments[0]!),
      id: "later-conflict",
    });
    const before = structuredClone(j);
    assert.throws(() => validateStoredJournal(j));
    assert.deepEqual(
      j,
      before,
      "failed validation must not partially increase bounds",
    );
  }
});

test("stored canonical reservations reject missing, changed, duplicate, cross-payment and reordered inputs", () => {
  for (const mutation of [
    (p: any) => (p.outpoints = []),
    (p: any) => delete p.outpoints,
    (p: any) => p.outpoints.reverse(),
    (p: any) => (p.outpoints[0] = p.outpoints[1]),
    (p: any) => (p.outpoints[0] += "0"),
    (p: any) => (p.bundleHex = p.bundleHex.toUpperCase()),
    (p: any) => (p.bundleHex += "00"),
    (p: any) => (p.bundleHex = "00"),
  ]) {
    const j = signed();
    mutation(j.payments[0]);
    const before = structuredClone(j);
    assert.throws(() => validateStoredJournal(j));
    assert.deepEqual(j, before);
  }
  const duplicate = signed();
  duplicate.payments.push({ ...duplicate.payments[0]!, id: "distinct-id" });
  assert.throws(
    () => validateStoredJournal(duplicate),
    /Duplicate stored reserved/,
  );
  const reusedChange = signed();
  reusedChange.nextChangeIndex = 0;
  assert.throws(() => validateStoredJournal(reusedChange), /change allocation/);
});

test("stored local signing owner and archive survive checks without restoring or stripping authority", () => {
  const j = distinct(1),
    p = transitionPayment(j, j.payments[0]!.id, "signing");
  p.signingAttempt = {
    id: "11111111-1111-4111-8111-111111111111",
    recovery: false,
  };
  const before = structuredClone(j);
  assert.equal(validateStoredJournal(j), j);
  assert.deepEqual(j, before);
  const saved = signed();
  saved.payments[0]!.archived = {
    status: "confirmed",
    block: { height: 1, hash: "ab".repeat(32) },
    checkedAt: 1000,
  };
  const savedBefore = structuredClone(saved);
  assert.equal(validateStoredJournal(saved), saved);
  assert.deepEqual(saved, savedBefore);
});

test("stored state and signed-byte identity cannot be made discardable or mismatch the bundle", () => {
  for (const mutation of [
    (p: any) => (p.state = "draft"),
    (p: any) => (p.state = "signing"),
    (p: any) => (p.state = "rejected"),
    (p: any) => delete p.rawTx,
    (p: any) => (p.rawTx = ""),
    (p: any) => (p.rawTx += "00"),
    (p: any) => (p.txid = "00".repeat(32)),
    (p: any) => (p.createdAt = -1),
    (p: any) => {
      const b = decodeBundle(fromHex(p.bundleHex));
      b.outputs[0]!.amount--;
      p.bundleHex = hex(encodeBundle(b));
    },
    (p: any) =>
      (p.signingAttempt = {
        id: "11111111-1111-4111-8111-111111111111",
        recovery: false,
      }),
  ]) {
    const j = signed();
    mutation(j.payments[0]);
    assert.throws(() => validateStoredJournal(j));
  }
});

test("stored signed bytes bind every unsigned field even with a matching recomputed transaction ID", () => {
  const mutations: ((tx: ReturnType<typeof parseTransaction>) => void)[] = [
    (tx) => tx.version++,
    (tx) => tx.lockTime++,
    (tx) => (tx.inputs[0]!.txid = "ab".repeat(32)),
    (tx) => tx.inputs[0]!.vout++,
    (tx) => tx.inputs[0]!.sequence--,
    (tx) => (tx.inputs[0]!.scriptSig = Uint8Array.of(1)),
    (tx) => tx.inputs.reverse(),
    (tx) => {
      tx.inputs.pop();
    },
    (tx) => tx.outputs[0]!.amount--,
    (tx) => {
      tx.outputs[0]!.scriptPubKey[2]! ^= 1;
    },
    (tx) => tx.outputs.reverse(),
    (tx) => {
      tx.outputs.pop();
    },
    (tx) => (tx.inputs[0]!.witness = []),
    (tx) => (tx.inputs[0]!.witness = [new Uint8Array(65)]),
    (tx) => tx.inputs[0]!.witness.push(new Uint8Array(64)),
  ];
  for (const mutate of mutations) {
    const j = signed();
    validateStoredJournal(j); // Exercise the warm-cache boundary, too.
    const tx = parseTransaction(j.payments[0]!.rawTx!);
    mutate(tx);
    j.payments[0]!.rawTx = rawTransaction(tx);
    j.payments[0]!.txid = parseTransaction(j.payments[0]!.rawTx!).txid;
    assert.throws(() => validateStoredJournal(j));
  }
});

test("local byte checks retain signature uncertainty; backup import still independently verifies signatures", () => {
  const j = signed(),
    tx = parseTransaction(j.payments[0]!.rawTx!);
  tx.inputs[0]!.witness[0]!.fill(0);
  j.payments[0]!.rawTx = rawTransaction(tx);
  const before = structuredClone(j);
  assert.equal(validateStoredJournal(j), j);
  assert.deepEqual(j, before);
  assert.throws(
    () => importWalletBackup(exportWalletBackup(account, j)),
    /Invalid signature/,
  );
});

test("stored payment schema, optional metadata and capacity remain strict on warm cache hits", () => {
  const mutations: ((p: any) => void)[] = [
    (p) => delete p.id,
    (p) => (p.id = "short"),
    (p) => (p.id = "a".repeat(65)),
    (p) => (p.extra = true),
    (p) => delete p.state,
    (p) => delete p.createdAt,
    (p) => (p.createdAt = Number.MAX_SAFE_INTEGER + 1),
    (p) => (p.createdAt = 0.5),
    (p) => (p.createdAt = null),
    (p) => (p.bundleHex = "a".repeat(3015)),
    (p) => (p.rawTx = "a".repeat(20_001)),
    (p) => (p.rawTx = p.rawTx.toUpperCase()),
    (p) => (p.txid = p.txid.toUpperCase()),
    (p) => (p.lastError = null),
    (p) => (p.lastError = "e".repeat(1001)),
    (p) => (p.archived = null),
    (p) => (p.archived = {}),
    (p) =>
      (p.archived = {
        status: "confirmed",
        block: { height: -1, hash: "aa".repeat(32) },
        checkedAt: 1000,
      }),
    (p) =>
      (p.archived = {
        status: "confirmed",
        block: { height: 1, hash: "AA".repeat(32) },
        checkedAt: 1000,
      }),
    (p) =>
      (p.archived = {
        status: "confirmed",
        block: { height: 1, hash: "aa".repeat(32), extra: true },
        checkedAt: 1000,
      }),
    (p) =>
      (p.archived = {
        status: "confirmed",
        block: { height: 1, hash: "aa".repeat(32) },
        checkedAt: -1,
      }),
  ];
  for (const mutate of mutations) {
    const j = signed();
    validateStoredJournal(j);
    mutate(j.payments[0]);
    const before = structuredClone(j);
    assert.throws(() => validateStoredJournal(j));
    assert.deepEqual(j, before);
  }
  for (const attempt of [
    null,
    {},
    { id: "bad", recovery: false },
    { id: "11111111-1111-4111-8111-111111111111", recovery: "false" },
    { id: "11111111-1111-4111-8111-111111111111", recovery: false, extra: 1 },
  ]) {
    const j: any = distinct(1);
    transitionPayment(j, j.payments[0].id, "signing");
    j.payments[0].signingAttempt = attempt;
    assert.throws(() => validateStoredJournal(j));
  }
  const duplicate = signed();
  duplicate.payments.push(structuredClone(duplicate.payments[0]!));
  assert.throws(
    () => validateStoredJournal(duplicate),
    /duplicate stored payment ID/,
  );
  const large = signed();
  large.payments = Array(2001).fill(large.payments[0]);
  assert.throws(() => validateStoredJournal(large), /Too many stored payments/);
});

test("immutable validation cache reuses bytes, rechecks mutable reservations and evicts at its bound", () => {
  const journals = Array.from({ length: 2001 }, (_, i) =>
      distinct(i + 100_000),
    ),
    first = journals[0]!,
    originalLift = secp256k1.ProjectivePoint.fromHex;
  let lifts = 0;
  secp256k1.ProjectivePoint.fromHex = function (...args) {
    lifts++;
    return originalLift.apply(this, args);
  };
  try {
    validateStoredJournal(first);
    assert(lifts > 0);
    const coldLifts = lifts;
    validateStoredJournal(structuredClone(first));
    assert.equal(
      lifts,
      coldLifts,
      "same bytes in a different object are reusable",
    );
    const changed = structuredClone(first);
    changed.payments[0]!.outpoints = [];
    assert.throws(() => validateStoredJournal(changed), /reservations/);
    assert.equal(
      lifts,
      coldLifts,
      "cached bytes never authorize mutable reservations",
    );
    for (const journal of journals.slice(1)) validateStoredJournal(journal);
    const beforeEvicted = lifts;
    validateStoredJournal(first);
    assert(lifts > beforeEvicted, "the oldest entry must have been evicted");
  } finally {
    secp256k1.ProjectivePoint.fromHex = originalLift;
  }
});

test("failed late backup conflict is atomic for both target and source and retains object identity", () => {
  const existing = distinct(1),
    incoming = distinct(2),
    conflict = structuredClone(existing.payments[0]!);
  conflict.id = "conflicting-new-id";
  incoming.payments.push(conflict);
  const local = importWalletBackup(
    exportWalletBackup(account, existing),
  ).journal;
  const restored = importWalletBackup(
    exportWalletBackup(account, incoming),
  ).journal;
  const before = structuredClone(local),
    sourceBefore = structuredClone(restored),
    reference = local.payments[0];
  assert.throws(() => mergeRestoredJournal(local, restored), /conflicts/);
  assert.deepEqual(local, before);
  assert.deepEqual(restored, sourceBefore);
  assert.equal(local.payments[0], reference);
});

test("late merge failure cannot revoke a live signing callback owner or upgrade a state", () => {
  const existing = distinct(1),
    incoming = structuredClone(existing);
  const p = transitionPayment(existing, existing.payments[0]!.id, "signing");
  p.signingAttempt = {
    id: "11111111-1111-4111-8111-111111111111",
    recovery: false,
  };
  transitionPayment(incoming, incoming.payments[0]!.id, "signing");
  incoming.payments.push({
    ...structuredClone(incoming.payments[0]!),
    id: "conflicting-later-id",
  });
  const before = structuredClone(existing);
  assert.throws(() => mergeRestoredJournal(existing, incoming), /conflicts/);
  assert.deepEqual(existing, before);
  assert.equal(existing.payments[0], p);
  assert(p.signingAttempt);
});

test("late conflict rolls back an earlier signed upgrade, callback revocation and high-water changes", () => {
  const existing = signed(),
    incoming = signed(),
    later = distinct(2).payments[0]!;
  const current = existing.payments[0]!;
  current.state = "signing";
  delete current.rawTx;
  delete current.txid;
  current.signingAttempt = {
    id: "11111111-1111-4111-8111-111111111111",
    recovery: false,
  };
  existing.payments.push(structuredClone(later));
  incoming.payments.push({ ...structuredClone(later), id: "late-conflict-id" });
  incoming.nextChangeIndex = 900;
  incoming.issuedReceiveThrough = 800;
  const restored = importWalletBackup(
      exportWalletBackup(account, incoming),
    ).journal,
    before = structuredClone(existing),
    sourceBefore = structuredClone(restored);
  assert.throws(() => mergeRestoredJournal(existing, restored), /conflicts/);
  assert.deepEqual(existing, before);
  assert.deepEqual(restored, sourceBefore);
  assert.equal(existing.payments[0], current);
});

test("successful atomic merge preserves existing payment identities and detaches additions from the source", () => {
  const existing = signed(),
    incoming = distinct(3),
    current = existing.payments[0]!;
  const before = structuredClone(incoming);
  mergeRestoredJournal(existing, incoming);
  assert.equal(existing.payments[0], current);
  assert.deepEqual(incoming, before);
  assert.notEqual(existing.payments[1], incoming.payments[0]);
  assert.notEqual(
    existing.payments[1]!.outpoints,
    incoming.payments[0]!.outpoints,
  );
  incoming.payments[0]!.outpoints.length = 0;
  assert.equal(existing.payments[1]!.outpoints.length, bundle.inputs.length);
});

test("merged capacity failure leaves all 2000 records and bounds unchanged", () => {
  const base = distinct(1),
    existing = emptyJournal();
  existing.nextChangeIndex = base.nextChangeIndex;
  existing.issuedReceiveThrough = base.issuedReceiveThrough;
  // Serialization-only records isolate the capacity guard; no signature or
  // backup-validity claim is made for this synthetic large journal.
  existing.payments = Array.from({ length: 2000 }, (_, i) => ({
    ...structuredClone(base.payments[0]!),
    id: `capacity-${i}`,
  }));
  const incoming = distinct(2);
  incoming.nextChangeIndex = 900;
  const before = structuredClone(existing);
  assert.throws(() => mergeRestoredJournal(existing, incoming), /exceeds 2000/);
  assert.deepEqual(existing, before);
});
