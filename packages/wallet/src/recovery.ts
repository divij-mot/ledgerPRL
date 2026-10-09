import {
  assert,
  accountFromJson,
  accountToJson,
  type AccountPublicKey,
  checkedIndex,
} from "@pearl-ledger/sdk";
import { type WalletJournal } from "./journal.js";
import { record, exactKeys, safeInteger } from "./watch.js";
/** Public recovery metadata is not a seed backup and does not contain private material. */
export function exportPublicRecovery(
  account: AccountPublicKey,
  journal: WalletJournal,
): string {
  return JSON.stringify(
    {
      schema: 1,
      kind: "pearl-public-recovery",
      account: accountToJson(account),
      issuedReceiveThrough: journal.issuedReceiveThrough,
      nextChangeIndex: journal.nextChangeIndex,
    },
    null,
    2,
  );
}
export function importPublicRecovery(text: string): {
  account: AccountPublicKey;
  issuedReceiveThrough: number;
  nextChangeIndex: number;
} {
  assert(text.length < 4096, "Public recovery record too large");
  const value = record(JSON.parse(text), "public account");
  if (!Object.hasOwn(value, "kind"))
    return {
      account: accountFromJson(value),
      issuedReceiveThrough: -1,
      nextChangeIndex: 0,
    };
  exactKeys(
    value,
    ["schema", "kind", "account", "issuedReceiveThrough", "nextChangeIndex"],
    "public recovery",
  );
  assert(
    value.schema === 1 && value.kind === "pearl-public-recovery",
    "Unknown public recovery format",
  );
  assert(
    typeof value.issuedReceiveThrough === "number" &&
      Number.isInteger(value.issuedReceiveThrough) &&
      value.issuedReceiveThrough >= -1 &&
      value.issuedReceiveThrough < 0x80000000,
    "Invalid receive recovery range",
  );
  return {
    account: accountFromJson(value.account),
    issuedReceiveThrough: value.issuedReceiveThrough,
    nextChangeIndex: safeInteger(value.nextChangeIndex, 0x7fffffff),
  };
}
export function recordVerifiedReceive(
  journal: WalletJournal,
  index: number,
): void {
  checkedIndex(index);
  assert(
    index <= journal.issuedReceiveThrough + 1,
    "Use the next consecutive receive index or restore its public recovery record",
  );
  journal.issuedReceiveThrough = Math.max(journal.issuedReceiveThrough, index);
}

import {
  decodeBundle,
  fromHex,
  hex,
  encodeBundle,
  validateBundle,
  finalizeTransaction,
  parseTransaction,
} from "@pearl-ledger/sdk";
import { type PaymentRecord, recordRecoveryPaths } from "./journal.js";
import { chainTip, outpoint } from "./watch.js";
export const MAX_BACKUP_BYTES = 16 * 1024 * 1024;
export interface WalletBackup {
  schema: 2;
  kind: "pearl-watch-backup";
  account: AccountPublicKey;
  journal: WalletJournal;
}
export function validateRestoredJournal(
  value: unknown,
  account: AccountPublicKey,
): WalletJournal {
  const v = record(value, "journal");
  exactKeys(
    v,
    ["schema", "issuedReceiveThrough", "nextChangeIndex", "payments"],
    "journal",
  );
  assert(v.schema === 1, "Unsupported journal schema");
  assert(
    typeof v.issuedReceiveThrough === "number" &&
      Number.isInteger(v.issuedReceiveThrough) &&
      v.issuedReceiveThrough >= -1 &&
      v.issuedReceiveThrough < 0x80000000,
    "Invalid issued receive range",
  );
  const nextChangeIndex = safeInteger(v.nextChangeIndex, 0x7fffffff);
  assert(
    Array.isArray(v.payments) && v.payments.length <= 2000,
    "Too many backup records",
  );
  const ids = new Set<string>(),
    reserved = new Set<string>();
  const knownPaths: { branch: 0 | 1; index: number }[] = [];
  const payments = v.payments.map((value): PaymentRecord => {
    const p = record(value, "payment");
    const allowed = [
      "id",
      "state",
      "createdAt",
      "bundleHex",
      "outpoints",
      "txid",
      "rawTx",
      "lastError",
      "signingAttempt",
      "archived",
    ];
    assert(
      Object.keys(p).every((k) => allowed.includes(k)),
      "Unknown payment field",
    );
    assert(
      typeof p.id === "string" &&
        /^[a-zA-Z0-9-]{8,64}$/.test(p.id) &&
        !ids.has(p.id),
      "Invalid or duplicate payment ID",
    );
    ids.add(p.id);
    assert(
      typeof p.state === "string" &&
        [
          "draft",
          "signing",
          "signed",
          "broadcast-unknown",
          "accepted",
        ].includes(p.state),
      "Invalid payment state",
    );
    const createdAt = safeInteger(p.createdAt, Number.MAX_SAFE_INTEGER);
    if (p.signingAttempt !== undefined) {
      const attempt = record(p.signingAttempt, "signing attempt");
      exactKeys(attempt, ["id", "recovery"], "signing attempt");
      assert(
        p.state === "signing" &&
          typeof attempt.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            attempt.id,
          ) &&
          typeof attempt.recovery === "boolean",
        "Invalid signing-attempt metadata",
      );
      // A backup carries ambiguity, never authority for a live callback to undo it.
    }
    assert(
      typeof p.bundleHex === "string" && p.bundleHex.length <= 3014,
      "Invalid backup bundle",
    );
    const bundle = decodeBundle(fromHex(p.bundleHex));
    validateBundle(bundle, account);
    assert(
      hex(encodeBundle(bundle)) === p.bundleHex,
      "Noncanonical backup bundle",
    );
    const points = bundle.inputs.map(outpoint);
    for (const point of points) {
      assert(!reserved.has(point), "Duplicate reserved outpoint in backup");
      reserved.add(point);
    }
    assert(
      Array.isArray(p.outpoints) &&
        JSON.stringify(p.outpoints) === JSON.stringify(points),
      "Restored reservation list differs from canonical bundle",
    );
    const change = bundle.outputs.find((o) => o.role === "change");
    assert(
      !change || change.index < nextChangeIndex,
      "Change allocation was not preserved in backup",
    );
    knownPaths.push(...bundle.inputs, ...(change ? [change] : []));
    const payment: PaymentRecord = {
      id: p.id,
      state: p.state as PaymentRecord["state"],
      createdAt,
      bundleHex: p.bundleHex,
      outpoints: points,
    };
    if (p.state === "draft" || p.state === "signing")
      assert(
        p.rawTx === undefined && p.txid === undefined,
        "Unsigned/uncertain state contains unexpected signed bytes",
      );
    else {
      assert(
        typeof p.rawTx === "string" &&
          p.rawTx.length <= 20_000 &&
          typeof p.txid === "string",
        "Signed backup lacks exact transaction bytes",
      );
      const parsed = parseTransaction(p.rawTx);
      assert(
        parsed.inputs.every(
          (i) =>
            i.scriptSig.length === 0 &&
            i.witness.length === 1 &&
            i.witness[0]?.length === 64,
        ),
        "Unexpected restored witness",
      );
      const checked = finalizeTransaction(
        bundle,
        parsed.inputs.map((i) => i.witness[0]!),
      );
      assert(
        checked.rawTx === p.rawTx && checked.txid === p.txid,
        "Restored signed transaction fails independent signature/byte verification",
      );
      payment.rawTx = p.rawTx;
      payment.txid = p.txid;
    }
    if (p.lastError !== undefined) {
      assert(
        typeof p.lastError === "string" && p.lastError.length <= 1000,
        "Invalid last-error metadata",
      );
      payment.lastError = p.lastError;
    }
    if (p.archived !== undefined) {
      const a = record(p.archived, "archive");
      exactKeys(a, ["status", "block", "checkedAt"], "archive");
      assert(
        a.status === "confirmed" && payment.rawTx,
        "Only signed payments can be archived",
      );
      chainTip(a.block);
      safeInteger(a.checkedAt, Number.MAX_SAFE_INTEGER);
      // Imported archival claims are not fresh chain evidence. Keep the record active until resync.
    }
    return payment;
  });
  const restored: WalletJournal = {
    schema: 1,
    nextChangeIndex,
    issuedReceiveThrough: v.issuedReceiveThrough,
    payments,
  };
  recordRecoveryPaths(restored, knownPaths);
  return restored;
}
/** Compact recovery data stays bounded at 2,000 records; local error diagnostics are not recovery authority. */
export function exportWalletBackup(
  account: AccountPublicKey,
  journal: WalletJournal,
): string {
  const text = JSON.stringify({
    schema: 2,
    kind: "pearl-watch-backup",
    account: accountToJson(account),
    journal: {
      ...journal,
      payments: journal.payments.map(
        ({
          signingAttempt: _localOnly,
          lastError: _diagnosticOnly,
          ...payment
        }) => payment,
      ),
    },
  });
  assert(
    new TextEncoder().encode(text).length <= MAX_BACKUP_BYTES,
    "Backup exceeds 16 MiB",
  );
  return text;
}
export function importWalletBackup(text: string): WalletBackup {
  assert(
    new TextEncoder().encode(text).length <= MAX_BACKUP_BYTES,
    "Backup exceeds 16 MiB",
  );
  const v = record(JSON.parse(text), "wallet backup");
  exactKeys(v, ["schema", "kind", "account", "journal"], "wallet backup");
  assert(
    v.schema === 2 && v.kind === "pearl-watch-backup",
    "Unknown wallet-backup format",
  );
  const account = accountFromJson(v.account);
  return {
    schema: 2,
    kind: "pearl-watch-backup",
    account,
    journal: validateRestoredJournal(v.journal, account),
  };
}
/** Atomic merge only: never replace a local journal or downgrade a known signed/uncertain state. */
export function mergeRestoredJournal(
  existing: WalletJournal,
  incoming: WalletJournal,
): void {
  const rank = {
    draft: 0,
    signing: 1,
    signed: 2,
    "broadcast-unknown": 3,
    accepted: 4,
  };
  for (const restored of incoming.payments) {
    // Even direct merge callers cannot import local callback ownership.
    const restoredPayment = structuredClone(restored);
    delete restoredPayment.signingAttempt;
    const current = existing.payments.find((p) => p.id === restored.id);
    if (!current) {
      assert(
        !restored.outpoints.some((point) =>
          existing.payments.some((p) => p.outpoints.includes(point)),
        ),
        "Restored payment conflicts with an existing reservation; neither journal was replaced",
      );
      existing.payments.push(restoredPayment);
      continue;
    }
    assert(
      current.bundleHex === restored.bundleHex &&
        JSON.stringify(current.outpoints) ===
          JSON.stringify(restored.outpoints),
      "Conflicting payment ID; neither journal was replaced",
    );
    if (current.rawTx && restored.rawTx)
      assert(
        current.rawTx === restored.rawTx && current.txid === restored.txid,
        "Conflicting signed transaction bytes",
      );
    if (current.state === "signing" && restored.state === "signing")
      delete current.signingAttempt;
    // Accepted can become uncertain again after an explicit same-byte retry.
    // A backup is not a fresh node response: uncertainty wins in either merge
    // direction until live reconciliation or submission establishes the result.
    if (
      (rank[restored.state] > rank[current.state] &&
        !(
          current.state === "broadcast-unknown" && restored.state === "accepted"
        )) ||
      (current.state === "accepted" && restored.state === "broadcast-unknown")
    ) {
      delete current.signingAttempt;
      Object.assign(current, restoredPayment);
    }
  }
  existing.nextChangeIndex = Math.max(
    existing.nextChangeIndex,
    incoming.nextChangeIndex,
  );
  existing.issuedReceiveThrough = Math.max(
    existing.issuedReceiveThrough,
    incoming.issuedReceiveThrough,
  );
  assert(
    existing.payments.length <= 2000,
    "Merged journal exceeds 2000 records; source data remains unchanged",
  );
}
