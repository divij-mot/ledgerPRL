import {
  assert,
  encodeBundle,
  hex,
  decodeBundle,
  fromHex,
  checkedIndex,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import { outpoint } from "./watch.js";
export type PaymentState =
  | "draft"
  | "signing"
  | "signed"
  | "broadcast-unknown"
  | "accepted";
export interface PaymentRecord {
  id: string;
  state: PaymentState;
  createdAt: number;
  bundleHex: string;
  outpoints: string[];
  txid?: string;
  rawTx?: string;
  lastError?: string;
  /** Local callback ownership only; backups cannot restore this authority. */
  signingAttempt?: { id: string; recovery: boolean };
  archived?: {
    status: "confirmed";
    block: import("./watch.js").ChainTip;
    checkedAt: number;
  };
}
export interface WalletJournal {
  schema: 1;
  nextChangeIndex: number;
  issuedReceiveThrough: number;
  payments: PaymentRecord[];
}
export function emptyJournal(): WalletJournal {
  return {
    schema: 1,
    nextChangeIndex: 0,
    issuedReceiveThrough: -1,
    payments: [],
  };
}
export function reservedOutpoints(journal: WalletJournal): Set<string> {
  return new Set(journal.payments.flatMap((p) => p.outpoints));
}
/** Record only account-owned paths from validated snapshots or canonical bundles, never claimed scan coverage. */
export function recordRecoveryPaths(
  journal: WalletJournal,
  paths: ReadonlyArray<{ branch: 0 | 1; index: number }>,
): void {
  let receive = journal.issuedReceiveThrough,
    change = journal.nextChangeIndex;
  for (const path of paths) {
    checkedIndex(path.index);
    assert(path.branch === 0 || path.branch === 1, "Invalid recovery branch");
    if (path.branch === 0) receive = Math.max(receive, path.index);
    else {
      assert(path.index < 0x7fffffff, "Change index exhausted");
      change = Math.max(change, path.index + 1);
    }
  }
  journal.issuedReceiveThrough = receive;
  journal.nextChangeIndex = change;
}
export function reservePayment(
  journal: WalletJournal,
  bundle: SigningBundle,
  id: string,
  now = Date.now(),
): PaymentRecord {
  assert(
    journal.payments.filter((p) => !p.archived).length < 100 &&
      journal.payments.length < 2000,
    "Payment journal is full; reconcile it before creating more payments",
  );
  assert(
    /^[a-zA-Z0-9-]{8,64}$/.test(id) &&
      !journal.payments.some((p) => p.id === id),
    "Invalid or duplicate payment ID",
  );
  const points = bundle.inputs.map(outpoint),
    reserved = reservedOutpoints(journal);
  assert(
    !points.some((p) => reserved.has(p)),
    "An input is reserved by another payment or browser tab",
  );
  const change = bundle.outputs.find((o) => o.role === "change");
  if (change) {
    assert(
      change.index >= journal.nextChangeIndex,
      "Change index was already allocated; choose the next index",
    );
    assert(change.index < 0x7fffffff, "Change index exhausted");
  }
  const payment: PaymentRecord = {
    id,
    state: "draft",
    createdAt: now,
    bundleHex: hex(encodeBundle(bundle)),
    outpoints: points,
  };
  recordRecoveryPaths(journal, [...bundle.inputs, ...(change ? [change] : [])]);
  journal.payments.push(payment);
  return payment;
}
export function paymentBundle(payment: PaymentRecord): SigningBundle {
  return decodeBundle(fromHex(payment.bundleHex));
}
export function transitionPayment(
  journal: WalletJournal,
  id: string,
  next: PaymentState,
  data: { txid?: string; rawTx?: string; lastError?: string } = {},
): PaymentRecord {
  const payment = journal.payments.find((p) => p.id === id);
  assert(payment, "Payment missing");
  const transitions: Record<PaymentState, PaymentState[]> = {
    draft: ["signing"],
    signing: ["signed"],
    signed: ["broadcast-unknown"],
    "broadcast-unknown": ["broadcast-unknown", "accepted"],
    accepted: ["broadcast-unknown"],
  };
  assert(
    transitions[payment.state].includes(next),
    `Cannot move payment from ${payment.state} to ${next}`,
  );
  if (next === "broadcast-unknown")
    assert(
      !payment.archived,
      "Archived payment requires reconciliation before rebroadcast",
    );
  if (next === "signed")
    assert(
      typeof data.rawTx === "string" && typeof data.txid === "string",
      "Signed transaction bytes and txid required",
    );
  if (payment.rawTx !== undefined && Object.hasOwn(data, "rawTx"))
    assert(data.rawTx === payment.rawTx, "Cannot replace a signed transaction");
  if (payment.txid !== undefined && Object.hasOwn(data, "txid"))
    assert(
      data.txid === payment.txid,
      "Cannot replace a signed transaction ID",
    );
  Object.assign(payment, data, { state: next });
  if (next === "signed") delete payment.signingAttempt;
  return payment;
}
export function discardDraft(journal: WalletJournal, id: string): void {
  const payment = journal.payments.find((p) => p.id === id);
  assert(payment, "Payment missing");
  assert(
    payment.state === "draft",
    "A signing, signed or broadcast payment cannot be released automatically",
  );
  journal.payments = journal.payments.filter((p) => p.id !== id);
}

/** Only the owning initial attempt may undo its protocol-proven REVIEW rejection. */
export function rejectBeforeSigning(
  journal: WalletJournal,
  id: string,
  attemptId: string,
): void {
  const payment = journal.payments.find((p) => p.id === id);
  assert(
    payment?.state === "signing" &&
      payment.rawTx === undefined &&
      payment.txid === undefined &&
      typeof attemptId === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        attemptId,
      ) &&
      payment.signingAttempt?.id === attemptId &&
      payment.signingAttempt.recovery === false,
    "Cannot reset an uncertain or signed payment",
  );
  payment.state = "draft";
  delete payment.signingAttempt;
}

/**
 * Reconcile only confirmed matching transaction IDs from a completed authenticated source view.
 * Archived records retain exact signed bytes AND reservations, so a later reorg cannot reuse inputs.
 */
export function reconcileConfirmed(
  journal: WalletJournal,
  history: import("./discovery.js").HistoryEntry[],
  tip: import("./watch.js").ChainTip,
  now = Date.now(),
): number {
  let count = 0;
  for (const payment of journal.payments) {
    const tx = payment.txid
      ? history.find((h) => h.txid === payment.txid)
      : undefined;
    if (
      tx?.state === "confirmed" &&
      tx.block &&
      tip.height - tx.block.height + 1 >= 6 &&
      payment.rawTx
    ) {
      payment.archived = {
        status: "confirmed",
        block: tx.block,
        checkedAt: now,
      };
      count++;
    } else if (payment.archived) {
      delete payment.archived;
    }
  }
  return count;
}
