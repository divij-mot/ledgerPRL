import {
  assert,
  encodeBundle,
  hex,
  decodeBundle,
  fromHex,
  checkedIndex,
  parseTransaction,
  equal,
  MAX_BUNDLE_SIZE,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import { outpoint, record, exactKeys, safeInteger, chainTip } from "./watch.js";
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

// Cache only deterministic checks of immutable byte strings, never a payment's
// mutable state, reservations, metadata or recovery bounds. Decoded objects stay
// private. The LRU bound fits one maximum journal and caps retained public data.
const MAX_STORED_PAYMENTS = 2000;
interface CheckedStoredBundle {
  bundle: SigningBundle;
  points: string[];
  signed?: { rawTx: string; txid: string };
}
const checkedStoredBundles = new Map<string, CheckedStoredBundle>();
function checkedStoredBundle(bundleHex: string): CheckedStoredBundle {
  let checked = checkedStoredBundles.get(bundleHex);
  if (checked) checkedStoredBundles.delete(bundleHex);
  else {
    const bundle = decodeBundle(fromHex(bundleHex));
    checked = { bundle, points: bundle.inputs.map(outpoint) };
    if (checkedStoredBundles.size >= MAX_STORED_PAYMENTS)
      checkedStoredBundles.delete(checkedStoredBundles.keys().next().value!);
  }
  checkedStoredBundles.set(bundleHex, checked);
  return checked;
}

function checkStoredSignedBytes(
  checked: CheckedStoredBundle,
  rawTx: string,
  txid: string,
): void {
  if (checked.signed?.rawTx === rawTx) {
    assert(checked.signed.txid === txid, "Stored transaction ID changed");
    return;
  }
  const parsed = parseTransaction(rawTx),
    { bundle } = checked;
  assert(
    parsed.inputs.length === bundle.inputs.length &&
      parsed.inputs.every(
        (i) =>
          i.scriptSig.length === 0 &&
          i.witness.length === 1 &&
          i.witness[0]?.length === 64,
      ),
    "Unexpected stored witness",
  );
  // The parser rejects trailing bytes, noncanonical lengths and witness flags.
  // Compare every unsigned field directly rather than serializing the bundle
  // again (which would repeat its expensive curve-point validation).
  assert(
    parsed.txid === txid &&
      parsed.version === bundle.version &&
      parsed.lockTime === bundle.lockTime &&
      parsed.inputs.every((input, i) => {
        const expected = bundle.inputs[i]!;
        return (
          input.txid === expected.txid &&
          input.vout === expected.vout &&
          input.sequence === expected.sequence
        );
      }) &&
      parsed.outputs.length === bundle.outputs.length &&
      parsed.outputs.every(
        (output, i) =>
          output.amount === bundle.outputs[i]!.amount &&
          equal(output.scriptPubKey, bundle.outputs[i]!.scriptPubKey),
      ),
    "Stored signed bytes differ from canonical payment",
  );
  checked.signed = { rawTx, txid };
}

/**
 * Bounded local-row integrity checks before trusting payment locks. This is not
 * backup import: keep live callback ownership and archival metadata unchanged.
 * Account ownership and Schnorr signatures remain checked at signing/import/
 * broadcast boundaries, rather than repeating costly signature work per read.
 */
export function validateStoredJournal(value: unknown): WalletJournal {
  if (value === undefined) return emptyJournal();
  const v = record(value, "stored journal");
  // Older local rows predate receive-range tracking. Only this absent field has
  // a legacy default; null and malformed persisted rows must never mean empty.
  const legacy = !Object.hasOwn(v, "issuedReceiveThrough");
  exactKeys(
    v,
    legacy
      ? ["schema", "nextChangeIndex", "payments"]
      : ["schema", "nextChangeIndex", "issuedReceiveThrough", "payments"],
    "stored journal",
  );
  assert(v.schema === 1, "Unsupported stored journal schema");
  const nextChangeIndex = safeInteger(v.nextChangeIndex, 0x7fffffff);
  const issuedReceiveThrough = legacy ? -1 : v.issuedReceiveThrough;
  assert(
    typeof issuedReceiveThrough === "number" &&
      Number.isSafeInteger(issuedReceiveThrough) &&
      issuedReceiveThrough >= -1 &&
      issuedReceiveThrough <= 0x7fffffff,
    "Invalid stored receive range",
  );
  let knownReceiveThrough = issuedReceiveThrough,
    knownNextChangeIndex = nextChangeIndex;
  assert(
    Array.isArray(v.payments) && v.payments.length <= MAX_STORED_PAYMENTS,
    "Too many stored payments",
  );
  const ids = new Set<string>(),
    reserved = new Set<string>();
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
  for (const value of v.payments) {
    const p = record(value, "stored payment");
    assert(
      Object.keys(p).every((k) => allowed.includes(k)),
      "Unknown stored payment field",
    );
    assert(
      typeof p.id === "string" &&
        /^[a-zA-Z0-9-]{8,64}$/.test(p.id) &&
        !ids.has(p.id),
      "Invalid or duplicate stored payment ID",
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
      "Invalid stored payment state",
    );
    safeInteger(p.createdAt, Number.MAX_SAFE_INTEGER);
    assert(
      typeof p.bundleHex === "string" &&
        p.bundleHex.length <= MAX_BUNDLE_SIZE * 2 &&
        p.bundleHex === p.bundleHex.toLowerCase(),
      "Invalid stored bundle",
    );
    // The fixed-width decoder checks every field and consumes the whole input;
    // lowercase hex plus that decode is the canonical encoding.
    const checked = checkedStoredBundle(p.bundleHex),
      { bundle, points } = checked;
    // Older rows can predate tracking paths consumed as inputs. Recover only
    // conservative high-water increases from canonical records, as backup
    // import does, and apply them only after the entire row passes validation.
    for (const input of bundle.inputs) {
      if (input.branch === 0)
        knownReceiveThrough = Math.max(knownReceiveThrough, input.index);
      else {
        assert(input.index < 0x7fffffff, "Stored change input index exhausted");
        knownNextChangeIndex = Math.max(knownNextChangeIndex, input.index + 1);
      }
    }
    assert(
      Array.isArray(p.outpoints) &&
        p.outpoints.length === points.length &&
        points.every(
          (point, index) => (p.outpoints as unknown[])[index] === point,
        ),
      "Stored reservations differ from canonical bundle",
    );
    for (const point of points) {
      assert(!reserved.has(point), "Duplicate stored reserved outpoint");
      reserved.add(point);
    }
    const change = bundle.outputs.find((o) => o.role === "change");
    assert(
      !change || change.index < nextChangeIndex,
      "Stored change allocation was not preserved",
    );
    if (p.state === "draft" || p.state === "signing") {
      assert(
        p.rawTx === undefined && p.txid === undefined,
        "Unsigned/uncertain stored state contains signed bytes",
      );
    } else {
      assert(
        typeof p.rawTx === "string" &&
          p.rawTx.length <= 20_000 &&
          p.rawTx === p.rawTx.toLowerCase() &&
          typeof p.txid === "string" &&
          /^[0-9a-f]{64}$/.test(p.txid),
        "Stored signed payment lacks canonical bytes",
      );
      checkStoredSignedBytes(checked, p.rawTx, p.txid);
    }
    if (p.signingAttempt !== undefined) {
      const attempt = record(p.signingAttempt, "stored signing attempt");
      exactKeys(attempt, ["id", "recovery"], "stored signing attempt");
      assert(
        p.state === "signing" &&
          typeof attempt.id === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            attempt.id,
          ) &&
          typeof attempt.recovery === "boolean",
        "Invalid stored signing attempt",
      );
    }
    if (p.lastError !== undefined)
      assert(
        typeof p.lastError === "string" && p.lastError.length <= 1000,
        "Invalid stored error metadata",
      );
    if (p.archived !== undefined) {
      const archive = record(p.archived, "stored archive");
      exactKeys(archive, ["status", "block", "checkedAt"], "stored archive");
      assert(
        archive.status === "confirmed" && p.rawTx,
        "Only signed stored payments may be archived",
      );
      chainTip(archive.block);
      safeInteger(archive.checkedAt, Number.MAX_SAFE_INTEGER);
    }
  }
  v.issuedReceiveThrough = knownReceiveThrough;
  v.nextChangeIndex = knownNextChangeIndex;
  return v as unknown as WalletJournal;
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

/** Only the owning initial attempt may reset after the signer fails without a complete result. */
export function resetUnsignedAttempt(
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
