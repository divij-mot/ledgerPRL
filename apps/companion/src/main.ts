import {
  LedgerBitcoinPrlClient,
  VerifiedSigningResultError,
} from "@pearl-ledger/bitcoin-prl-adapter";
import {
  type AccountPublicKey,
  type NetworkName,
  type SigningBundle,
  type FinalizedTransaction,
  accountFromJson,
  accountToJson,
  deriveAddress,
  addressToScript,
  formatPrl,
  MAX_INPUTS,
  NETWORKS,
  assert,
  finalizeTransaction,
  validateBundle,
  parseTransaction,
  scriptToAddress,
  parseGrains,
} from "@pearl-ledger/sdk";
import { readBoundedText, readBoundedJson } from "@pearl-ledger/sdk";
import {
  discoverAccount,
  type WatchSnapshot,
  type ChainValidation,
  type WalletJournal,
  type PaymentRecord,
  type PaymentRequest,
  type HistoryEntry,
  record,
  exactKeys,
  safeInteger,
  hash,
  chainTip,
  parseWatchSnapshot,
  snapshotToJson,
  accountId,
  balances,
  confirmations,
  coinEligibility,
  outpoint,
  preparePayment,
  previewPaymentPolicy,
  assertPaymentPolicy,
  reservedOutpoints,
  reservePayment,
  transitionPayment,
  discardDraft,
  exportWalletBackup,
  mergeRestoredJournal,
  reconcileConfirmed,
  exportPublicRecovery,
  importPublicRecovery,
  recordVerifiedReceive,
  recordRecoveryPaths,
  paymentBundle,
  emptyJournal,
  applyValidation,
  requireFreshValidation,
} from "@pearl-ledger/wallet";
import { connectLedger, type PearlTransport } from "./device.js";
import { browserPublicSource } from "./public-source.js";
import { checkLightSnapshot } from "./blockbook-source.js";
import { WatchStorage } from "./storage.js";
import { signedRecoveryBackup } from "./signed-recovery.js";
import { importWalletBackupFile } from "./backup-import.js";
import { countLabel } from "./presentation.js";
import { walletShell, walletButton } from "./ui.js";
import {
  selectPaymentInputs,
  selectablePaymentCoins,
  maximumPayment,
} from "./coin-selection.js";
import { walletMessage } from "./wallet-copy.js";
import {
  FEE_TARGETS,
  loadFeeQuotes,
  quotedPayment,
  type FeeQuote,
} from "./fee-quotes.js";
import { historyConfirmations, pageItems } from "./activity.js";
import { sendForm, reviewFlow, receiveFlow } from "./ledger-ui/index.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
const hostedMode = window.location?.protocol === "https:";
const store = new WatchStorage();
const channel = new BroadcastChannel("pearl-ledger-watch-v1");
let sourceMode: "node" | "public" = "node",
  privacyConsent = false,
  syncComplete = false;
let history: HistoryEntry[] = [],
  lastUsed: [number, number] = [-1, -1];
let page: "overview" | "receive" | "send" | "activity" = "overview";
let network: NetworkName =
    window.location?.pathname === "/live.html"
      ? "mainnet"
      : hostedMode
        ? "testnet2"
        : "regtest",
  accountIndex = 0,
  account: AccountPublicKey | null = null;
let snapshot: WatchSnapshot | null = null,
  validation: ChainValidation | null = null;
let client: LedgerBitcoinPrlClient | null = null,
  transport: PearlTransport | null = null;
let journal: WalletJournal = emptyJournal(),
  activePayment: string | null = null;
let busy = false,
  busyText = "",
  notification = "",
  notificationType = "success";
let receiveIndex = 0,
  verifiedReceive: string | null = null;
let currentAbort: AbortController | null = null;
type SignedRecovery = {
  pending: boolean;
  text: string;
  txid: string;
  ownerId: string;
  paymentId: string;
  bundleHex: string;
  createdAt: number;
  outpoints: string;
};
let emergencySignedRecovery: SignedRecovery | null = null;
let journalRefreshGeneration = 0;
const selected = new Set<string>();
let manualSelection = false;
let coinControlOpen = false;
let settingsOpen = false;
let historyPage = 0,
  paymentPage = 0;
let historyTip: { height: number; hash: string } | null = null;
let sendStep = 0,
  receiveStep = 0;
let signingRequested = false;
let feeQuotes: FeeQuote[] = [];
let feeQuoteNetwork: NetworkName | null = null;
let feeQuoteStatus = "Enter a manual fee or refresh network estimates.";
const form = { recipient: "", amount: "", fee: "0.00001000", changeIndex: "0" };
function clearPaymentForm() {
  feeQuotes = [];
  feeQuoteNetwork = null;
  feeQuoteStatus = "Enter a manual fee or refresh network estimates.";
  historyPage = paymentPage = 0;
  historyTip = null;
  sendStep = receiveStep = 0;
  manualSelection = false;
  Object.assign(form, {
    recipient: "",
    amount: "",
    fee: "0.00001000",
    changeIndex: "0",
  });
  receiveIndex = 0;
}
const e = (value: unknown) =>
  String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const money = (value: bigint) => `${formatPrl(value)} PRL`;
const disabled = (condition = true) => (condition ? "disabled" : "");
function notify(message: string, error = false) {
  notification = message;
  notificationType = error ? "error" : "success";
  render();
}
async function refreshJournal() {
  const owner = account;
  const generation = ++journalRefreshGeneration;
  if (owner) {
    const loaded = await store.journal(accountId(owner));
    if (account !== owner || generation !== journalRefreshGeneration) return;
    journal = loaded;
    form.changeIndex = String(
      Math.max(
        journal.nextChangeIndex,
        lastUsed[1] + 1,
        ...(snapshot?.coins
          .filter((c) => c.branch === 1)
          .map((c) => c.index + 1) ?? [0]),
      ),
    );
  }
}
async function run(
  label: string,
  work: (signal: AbortSignal) => Promise<void>,
) {
  if (busy) return;
  busy = true;
  currentAbort = new AbortController();
  busyText = label;
  notification = "";
  notificationType = "success";
  render();
  try {
    await work(currentAbort.signal);
  } catch (error) {
    notification = error instanceof Error ? error.message : "Operation failed";
    notificationType = "error";
    if (client?.sessionState === "failed") {
      notification +=
        " Exit and reopen the Pearl app on your Ledger before reconnecting. Closing this page does not cancel a review still shown on the device.";
    }
  } finally {
    // A completed signed result can still leave a failed session. Render its
    // invalidation before storage waits, while controls are still busy.
    if (client?.sessionState === "failed") render();
    busy = false;
    busyText = "";
    currentAbort = null;
    await refreshJournal().catch((error) => {
      notification = String(error);
      notificationType = "error";
    });
    await verifyRestoredEmergencyBackup();
    render();
  }
}
async function verifyRestoredEmergencyBackup(
  recovery: SignedRecovery | null = emergencySignedRecovery,
): Promise<boolean> {
  if (!recovery) return true;
  try {
    const durable = await store.journal(recovery.ownerId);
    const saved = durable.payments.find((p) => p.id === recovery.paymentId);
    if (
      !saved?.rawTx ||
      saved.txid !== recovery.txid ||
      saved.bundleHex !== recovery.bundleHex ||
      saved.createdAt !== recovery.createdAt ||
      JSON.stringify(saved.outpoints) !== recovery.outpoints ||
      !["signed", "broadcast-unknown", "accepted"].includes(saved.state)
    )
      return false;
    const bundle = paymentBundle(saved);
    const checked = finalizeTransaction(
      bundle,
      parseTransaction(saved.rawTx).inputs.map((i) => i.witness[0]!),
    );
    if (
      checked.rawTx === saved.rawTx &&
      checked.txid === recovery.txid &&
      emergencySignedRecovery === recovery
    ) {
      emergencySignedRecovery = null;
      return true;
    }
  } catch {
    /* Keep the only available signed recovery copy until durable verification succeeds. */
  }
  return false;
}
function markPendingRecoveryFailed(recovery: SignedRecovery | null) {
  if (recovery && emergencySignedRecovery === recovery) {
    recovery.pending = false;
    render();
  }
}
function getPayment(): PaymentRecord | undefined {
  return journal.payments.find((p) => p.id === activePayment);
}
async function post(
  route: string,
  body: unknown,
  signal: AbortSignal | undefined = currentAbort?.signal,
): Promise<unknown> {
  const response = await fetch(route, {
    method: "POST",
    credentials: "omit",
    redirect: "error",
    cache: "no-store",
    headers: { "content-type": "application/json", "x-pearl-companion": "1" },
    body: JSON.stringify(body),
    signal: AbortSignal.any([
      AbortSignal.timeout(route.endsWith("/discover") ? 300_000 : 90_000),
      ...(signal ? [signal] : []),
    ]),
  });
  let value: unknown;
  try {
    value = await readBoundedJson(response, 4 * 1024 * 1024);
  } catch {
    throw new Error(
      "Local node bridge is unavailable. Start it with authenticated node settings; see docs/companion.md.",
    );
  }
  if (!response.ok)
    throw new Error(
      typeof value === "object" && value && "error" in value
        ? String(value.error)
        : "Node check failed",
    );
  return value;
}
async function checkNode(signal?: AbortSignal) {
  signal = AbortSignal.any([
    AbortSignal.timeout(90_000),
    ...(signal ? [signal] : []),
  ]);
  assert(snapshot, "Import or discover public watch data first");
  assert(
    !hostedMode || sourceMode === "public",
    "Sync this account with the public source first. Private-node access is available only in the local app.",
  );
  const result = applyValidation(
    snapshot,
    sourceMode === "public"
      ? await checkLightSnapshot(
          browserPublicSource(network, privacyConsent, signal),
          snapshot,
        )
      : await post("/api/check", JSON.parse(snapshotToJson(snapshot)), signal),
  );
  signal.throwIfAborted();
  snapshot = result.snapshot;
  validation = result.validation;
  for (const key of selected)
    if (!snapshot.coins.some((c) => outpoint(c) === key)) selected.delete(key);
  notification = result.removed
    ? `Node check removed ${result.removed} spent, detached or unconfirmed outputs. Rebuild any draft affected by the change.`
    : `Node checked ${snapshot.coins.length} outputs at block ${snapshot.tip.height}. This trusts your configured node's chain view.`;
  notificationType = result.removed ? "error" : "success";
}
function render() {
  // Recovery warnings may render before the operation's final cleanup.
  if (client?.sessionState === "failed") verifiedReceive = null;
  const active = getPayment(),
    b = snapshot ? balances(snapshot, reservedOutpoints(journal)) : null;
  const visibleNotification = walletMessage(notification);
  const feedback = `${emergencySignedRecovery ? `<section class="notice ${emergencySignedRecovery.pending ? "busy" : "error"}" role="${emergencySignedRecovery.pending ? "status" : "alert"}"><strong>${emergencySignedRecovery.pending ? "Saving payment" : "Payment could not be saved"}</strong><p>${emergencySignedRecovery.pending ? "Keep this window open while your approved payment is saved. If saving stalls, download a backup." : "Keep this window open and download a backup before continuing."} Keep it private: it can be used to send this payment. These funds remain unavailable; do not create a replacement payment.</p><p class="mono">${e(emergencySignedRecovery.txid)}</p><button id="download-signed-recovery">Download backup</button></section>` : ""}${visibleNotification ? `<div role="status" class="notice ${notificationType}">${e(visibleNotification)} <button id="dismiss" class="ghost" aria-label="Dismiss notification">Dismiss</button></div>` : ""}${busy ? `<div role="status" class="notice busy">${e(busyText)}${currentAbort ? '<button id="cancel-device" class="ghost">Cancel operation</button>' : ""}</div>` : ""}`;
  const hasFlow =
    (page === "receive" && !!account) ||
    (page === "send" && (!!snapshot || !!active));
  const content = `${hasFlow ? "" : feedback}${page === "overview" ? overview(b) : page === "receive" ? receive(feedback) : page === "send" ? send(active, feedback) : activity()}`;
  app.innerHTML = walletShell({
    page,
    network,
    busy,
    settings: settings(),
    content,
  });
  bind();
}
function lightCard() {
  if (!account || !["mainnet", "testnet2"].includes(network)) return "";
  return `<section class="card sync-card"><div><h2>${syncComplete ? "Account synced" : "Sync your account"}</h2><p class="hint">${syncComplete && snapshot ? `Last synced at block ${snapshot.tip.height}. ` : ""}</p><label class="check"><input id="privacy-consent" type="checkbox" ${privacyConsent ? "checked" : ""} ${disabled(busy)}>Use Pearl’s public indexer (shares wallet addresses)</label></div>${walletButton("sync-public", syncComplete ? "Sync account" : "Sync balance & history", busy || !privacyConsent)}<details class="sync-details"><summary>About public sync</summary><p class="hint">Queries share your addresses, transactions and IP with the wallet host and Pearl’s public service. Balances rely on its responses.</p><p class="hint">Service: ${network === "mainnet" ? "blockbook.pearlresearch.ai" : "blockbook.testnet.pearlresearch.ai"}. Public account keys stay in your browser.</p></details></section>`;
}
function paymentStatus(payment: PaymentRecord): string {
  if (payment.archived) return "Confirmed";
  const tx = payment.txid
    ? history.find((h) => h.txid === payment.txid)
    : undefined;
  if (tx?.state === "confirmed") return "Confirmed";
  if (tx?.state === "detached") return "Needs review";
  return {
    draft: "Draft",
    signing: "Needs review",
    signed: "Ready to send",
    "broadcast-unknown": "Status unknown",
    accepted: "Pending confirmation",
  }[payment.state];
}
function pagination(name: string, pageNumber: number, pages: number) {
  return pages <= 1
    ? ""
    : `<div class="activity-pagination"><button id="${name}-prev" class="ghost" ${disabled(busy || pageNumber === 0)}>Previous</button><span class="hint">${pageNumber + 1} / ${pages}</span><button id="${name}-next" class="ghost" ${disabled(busy || pageNumber + 1 >= pages)}>Next</button></div>`;
}
function historyCard(): string {
  if (!history.length) return "";
  const sorted = history
    .slice()
    .sort(
      (a, b) =>
        (b.block?.height ?? Number.MAX_SAFE_INTEGER) -
          (a.block?.height ?? Number.MAX_SAFE_INTEGER) ||
        a.txid.localeCompare(b.txid),
    );
  const slice = pageItems(sorted, historyPage);
  historyPage = slice.page;
  return `<section class="card"><h2>Transactions</h2>${slice.items
    .map((h) => {
      const net = h.received - h.spent;
      const count = historyConfirmations(
        h,
        snapshot?.tip,
        syncComplete ? historyTip : null,
      );
      const status =
        h.state === "pending"
          ? "Pending"
          : h.state === "detached"
            ? "Needs review"
            : count === null
              ? "Confirmation status unavailable"
              : countLabel(count, "confirmation");
      return `<div class="journal-item"><div class="row"><div><b class="small">${net > 0n ? "Received" : net < 0n ? "Sent" : "Transaction"}</b><p class="hint">${status}</p></div><strong class="small">${net > 0n ? "+" : net < 0n ? "−" : ""}${money(net < 0n ? -net : net)}</strong></div><details><summary>Transaction details</summary><p class="mono">${e(h.txid)}</p><button class="ghost" data-copy-txid="${e(h.txid)}" ${disabled(busy)}>Copy transaction ID</button><p class="hint">Received ${money(h.received)} · Spent ${money(h.spent)}.</p></details></div>`;
    })
    .join("")}${pagination("history", slice.page, slice.pages)}</section>`;
}
async function syncPublic() {
  const signal = AbortSignal.any([
    AbortSignal.timeout(300_000),
    ...(currentAbort ? [currentAbort.signal] : []),
  ]);
  assert(
    account && privacyConsent,
    "Select a public account and approve address disclosure first",
  );
  await refreshJournal();
  syncComplete = false;
  const owner = accountId(account),
    minimumIndex: [number, number] = [
      Math.max(lastUsed[0], journal.issuedReceiveThrough),
      Math.max(lastUsed[1], journal.nextChangeIndex - 1),
    ];
  const discovered = await discoverAccount(
    browserPublicSource(network, privacyConsent, signal),
    account,
    { minimumIndex },
  );
  signal.throwIfAborted();
  const result = {
    ...discovered,
    snapshot: JSON.parse(snapshotToJson(discovered.snapshot)),
    history: discovered.history.map((h) => ({
      ...h,
      received: h.received.toString(),
      spent: h.spent.toString(),
    })),
  };
  assert(
    result.complete === true,
    "Public scan incomplete; no final balance available",
  );
  const next = parseWatchSnapshot(JSON.stringify(result.snapshot));
  assert(accountId(next.account) === owner, "Discovered account changed");
  assert(
    Array.isArray(result.history) && result.history.length <= 2000,
    "Invalid history",
  );
  const nextHistory: HistoryEntry[] = result.history.map((value) => {
    const h = record(value, "history transaction");
    assert(
      h.state === "pending" || h.state === "confirmed",
      "Invalid history state",
    );
    return {
      txid: hash(h.txid),
      received: parseGrains(h.received as string),
      spent: parseGrains(h.spent as string),
      block: h.block === null ? null : chainTip(h.block),
      state: h.state,
    };
  });
  for (const old of history)
    if (!nextHistory.some((h) => h.txid === old.txid))
      nextHistory.push({ ...old, block: null, state: "detached" });
  assert(
    Array.isArray(result.lastUsed) && result.lastUsed.length === 2,
    "Invalid discovery checkpoint",
  );
  const nextLastUsed = result.lastUsed as [number, number];
  assert(
    nextLastUsed.every(
      (v, branch) =>
        Number.isInteger(v) &&
        v >= -1 &&
        v <= 979 &&
        v <=
          (branch === 0
            ? next.coverage.externalScannedThrough
            : next.coverage.changeScannedThrough) -
            20,
    ),
    "Invalid discovery recovery range",
  );
  await store.mutate(owner, (j) => {
    signal.throwIfAborted();
    // The same atomic transaction that saves the result checks for recovery
    // ranges learned by another tab while this bounded scan was in flight.
    assert(
      j.issuedReceiveThrough <= minimumIndex[0] &&
        j.nextChangeIndex - 1 <= minimumIndex[1],
      "Recovery bounds changed during discovery; retry the account scan",
    );
    j.issuedReceiveThrough = Math.max(j.issuedReceiveThrough, nextLastUsed[0]);
    j.nextChangeIndex = Math.max(j.nextChangeIndex, nextLastUsed[1] + 1);
    for (const payment of j.payments)
      if (payment.archived) {
        const found = nextHistory.find((h) => h.txid === payment.txid);
        if (
          !found?.block ||
          found.state !== "confirmed" ||
          found.block.hash !== payment.archived.block.hash ||
          next.tip.height - found.block.height + 1 < 6
        )
          delete payment.archived;
      }
  });
  signal.throwIfAborted();
  lastUsed = nextLastUsed;
  // Match a normal UTXO wallet: after discovery, offer an unused receive
  // address. The existing range guard still blocks exhausted recovery ranges.
  if (receiveIndex <= lastUsed[0]) {
    receiveIndex = lastUsed[0] + 1;
    verifiedReceive = null;
  }
  snapshot = next;
  history = nextHistory;
  historyTip = { ...next.tip };
  sourceMode = "public";
  syncComplete = true;
  validation = null;
  selected.clear();
  // Fresh input recheck is mandatory before every signature; discovery alone never bypasses it.
  notification = `Public account discovered through block ${next.tip.height}: ${next.coins.length} outputs and ${nextHistory.length} transactions. ${network === "testnet2" ? "This endpoint is testnet2, despite its testnet hostname." : ""}`;
}
function overview(b: ReturnType<typeof balances> | null) {
  if (!account)
    return `<section class="connect-panel"><h2>Add your Pearl account</h2><p>Open Pearl on your Ledger to get started.</p>${walletButton("connect-inline", "Add account", busy)}</section>`;
  return `<section class="balance-card"><p class="hint">Available balance</p><div class="balance">${b ? formatPrl(b.available) : "—"}<small>PRL</small></div><div class="actions account-actions"><button data-nav="receive" ${disabled(busy)}>Receive</button><button data-nav="send" ${disabled(busy)}>Send</button></div>${b && (b.immature || b.reserved || b.pending) ? `<p class="hint">${b.immature ? `${money(b.immature)} immature · ` : ""}${b.reserved ? `${money(b.reserved)} in pending payments · ` : ""}${b.pending ? `${money(b.pending)} unconfirmed` : ""}</p>` : ""}</section>${lightCard()}${history.length ? historyCard() : `<section class="transactions"><h2>Transactions</h2><p class="hint">${syncComplete ? "No transactions yet" : "Sync your account to see transactions"}</p></section>`}`;
}
function settings() {
  return `<details id="settings" class="settings" ${settingsOpen ? "open" : ""}><summary>Settings</summary><div class="settings-panel"><div class="section-head"><h2>Settings</h2><button id="close-settings" class="ghost">Close</button></div><section><div class="actions">${walletButton("connect", client?.sessionState === "ready" ? "Reconnect Ledger" : "Connect Ledger", busy)}${account ? `<button id="disconnect" class="ghost" ${disabled(busy)}>Close account</button>` : ""}</div><div class="field"><label for="network">Network</label><select id="network" ${disabled(busy || !!account)}>${Object.keys(
    NETWORKS,
  )
    .map((n) => `<option ${network === n ? "selected" : ""}>${n}</option>`)
    .join("")}</select></div></section>
  <details class="advanced"><summary>Advanced</summary><div class="advanced-body"><div class="field"><label for="account-index">Account index</label><input id="account-index" type="number" min="0" max="2147483647" value="${accountIndex}" ${disabled(busy || !!account)}></div>
  ${account ? `<div class="inline-fields"><div class="field"><label for="receive-index">Receive address index</label><input id="receive-index" type="number" min="0" max="${Math.min(979, journal.issuedReceiveThrough + 1)}" value="${receiveIndex}" ${disabled(busy)}></div><div class="field"><label for="change-index">Change address index</label><input id="change-index" value="${e(form.changeIndex)}" type="number" min="${journal.nextChangeIndex}" max="2147483646" ${disabled(busy)}></div></div><p class="mono muted">${e(deriveAddress(account, 0, receiveIndex).path)}</p><div class="actions"><button id="backup-export" class="secondary" ${disabled(busy)}>Export backup</button><button id="export-public" class="secondary" ${disabled(busy)}>Export account</button><button id="save-cache" class="secondary" ${disabled(busy || !snapshot)}>Save account locally</button></div><p class="hint">Keep backups private: anyone with a signed payment can submit it.</p>` : ""}
  ${snapshot ? `<button id="${page === "send" ? "settings-check-node" : "check-node"}" class="secondary" ${disabled(busy)}>Refresh balance</button>` : ""}
  ${notificationType === "error" && notification && walletMessage(notification) !== notification ? `<details><summary>Troubleshooting</summary><p class="hint">${e(notification)}</p></details>` : ""}<h3>Import</h3><div class="field"><label for="backup-file">Wallet backup</label><input id="backup-file" type="file" accept="application/json,.json" ${disabled(busy)}><label for="public-file">Public account</label><input id="public-file" type="file" accept="application/json,.json" ${disabled(busy)}><label for="snapshot-file">Balance snapshot</label><input id="snapshot-file" type="file" accept="application/json,.json" ${disabled(busy)}></div><p class="hint">Public account files only. Never enter a recovery phrase.</p><div class="actions"><button id="restore-cache" class="secondary" ${disabled(busy)}>Restore saved account</button><button id="clear-cache" class="ghost" ${disabled(busy)}>Clear saved balance data</button>${hostedMode ? "" : `<button id="load-demo" class="ghost" ${disabled(busy)}>Load example</button>`}</div><p class="hint">Saved data is visible to anyone using this browser profile.</p><button id="reconcile" class="secondary" ${disabled(busy || !account || (sourceMode === "public" && !syncComplete))}>Refresh payment status</button></div></details>
  <details class="advanced"><summary>About</summary><div class="advanced-body"><p class="hint">Development build. Not audited or Ledger-approved. Use test funds only.</p><a href="/third-party-notices.txt" target="_blank" rel="noopener noreferrer">Third-party notices</a></div></details></div></details>`;
}
function receive(feedback = "") {
  if (!account)
    return `<section class="card empty"><h2>Connect a public account first</h2><button data-nav="overview">Go to account</button></section>`;
  const derived = deriveAddress(account, 0, receiveIndex);
  const verified = verifiedReceive === derived.address;
  return receiveFlow({
    feedback,
    accountName: `Pearl ${accountIndex + 1}`,
    address: derived.address,
    network,
    verified,
    connected: client?.sessionState === "ready",
    busy,
    stage: verified ? 2 : receiveStep,
    rangeError: receiveIndex > Math.min(979, journal.issuedReceiveThrough + 1),
    canNewAddress:
      Math.max(receiveIndex, journal.issuedReceiveThrough, lastUsed[0]) < 979,
  });
}
function currentFeeRequest(): PaymentRequest {
  assert(snapshot, "Sync your account to prepare a payment");
  return {
    selected: manualSelection
      ? [...selected]
      : selectPaymentInputs(
          snapshot,
          form.amount,
          form.fee,
          reservedOutpoints(journal),
        ),
    recipient: form.recipient.trim(),
    amountPrl: form.amount,
    feePrl: form.fee,
    changeIndex: Number(form.changeIndex),
  };
}
function feePolicyHint(): string {
  if (!snapshot) return "Sync your account to prepare a payment.";
  if (!form.amount.trim())
    return "Enter an amount to calculate the minimum fee.";
  try {
    const p = previewPaymentPolicy(
      snapshot,
      currentFeeRequest(),
      reservedOutpoints(journal),
    );
    return `${p.fee < p.minimumFee ? "Fee too low. " : ""}Minimum fee: ${formatPrl(p.minimumFee)} PRL.`;
  } catch (error) {
    return error instanceof Error
      ? walletMessage(error.message)
      : "Complete the payment fields to calculate the minimum fee.";
  }
}
function feeQuoteOptions() {
  if (!snapshot || sourceMode !== "public" || feeQuoteNetwork !== network)
    return [];
  return feeQuotes.map((quote) => {
    try {
      const request = quotedPayment(
        snapshot!,
        currentFeeRequest(),
        reservedOutpoints(journal),
        quote,
        manualSelection,
      );
      return {
        blocks: quote.blocks,
        label: `${quote.blocks}-block target · ${request.feePrl} PRL`,
        disabled: false,
        feePrl: request.feePrl,
      };
    } catch {
      return {
        blocks: quote.blocks,
        label: `${quote.blocks}-block target · unavailable`,
        disabled: true,
        feePrl: null,
      };
    }
  });
}
function send(active: PaymentRecord | undefined, feedback = "") {
  if (active) return review(active, feedback);
  if (!snapshot)
    return `<section class="card empty"><h2>Sync your account to send Pearl</h2><p>Your balance and available funds need to be loaded first.</p><button data-nav="overview">Go to account</button></section>`;
  const reserved = reservedOutpoints(journal);
  return sendForm({
    feedback,
    step: sendStep,
    recipient: form.recipient,
    amount: form.amount,
    fee: form.fee,
    available: money(balances(snapshot, reserved).available),
    maxLabel:
      manualSelection ||
      selectablePaymentCoins(snapshot, reserved).length > MAX_INPUTS
        ? "Max selected inputs"
        : "Max",
    maxDisabled: manualSelection
      ? selected.size === 0
      : selectablePaymentCoins(snapshot, reserved).length === 0,
    feeHint: feePolicyHint(),
    quotes: feeQuoteOptions(),
    quoteStatus:
      sourceMode === "public" && ["mainnet", "testnet2"].includes(network)
        ? feeQuoteStatus
        : "",
    quotesSupported:
      sourceMode === "public" && ["mainnet", "testnet2"].includes(network),
    accountName: `Pearl ${accountIndex + 1}`,
    network,
    busy,
    advanced: `<details id="coin-control" class="card advanced" ${coinControlOpen ? "open" : ""}><summary>Coin control</summary><div class="advanced-body"><button id="check-node" class="secondary" ${disabled(busy)}>Refresh balance</button>${
      snapshot.coins.length
        ? snapshot.coins
            .map((c) => {
              const key = outpoint(c),
                status = reserved.has(key)
                  ? "reserved"
                  : coinEligibility(c, snapshot!.tip);
              return `<label class="coin"><input type="checkbox" data-coin="${e(key)}" ${selected.has(key) ? "checked" : ""} ${disabled(busy || status !== "eligible")}><span class="coin-info"><span class="mono">${e(key)}</span><span class="muted">${c.coinbase ? "Mining reward" : "Transfer"} · ${confirmations(c, snapshot!.tip)} confirmations · ${status === "reserved" ? "pending payment" : status === "eligible" ? "available" : status}</span></span><span class="coin-value">${e(formatPrl(c.amount))}<br><span class="muted">PRL</span></span></label>`;
            })
            .join("")
        : '<p class="hint">No available funds.</p>'
    }<p class="hint">${manualSelection ? countLabel(selected.size, "input") + " selected manually." : "Automatic selection"}</p><button id="auto-inputs" class="secondary" ${disabled(busy)}>Use automatic selection</button></div></details>`,
  });
}
function review(payment: PaymentRecord, feedback = "") {
  const bundle = paymentBundle(payment),
    recipient = bundle.outputs.find((o) => o.role === "recipient")!,
    change = bundle.outputs.find((o) => o.role === "change");
  const total = bundle.inputs.reduce((s, i) => s + i.amount, 0n),
    fee = total - bundle.outputs.reduce((s, o) => s + o.amount, 0n);
  const highFee = fee > 100_000n && fee * 10n >= total;
  const stage =
    signingRequested && busy
      ? 3
      : payment.state === "draft"
        ? 2
        : payment.state === "signing"
          ? 3
          : 4;
  return reviewFlow({
    feedback,
    accountName: `Pearl ${accountIndex + 1}`,
    recipient: scriptToAddress(recipient.scriptPubKey, bundle.network),
    amount: money(recipient.amount),
    fee: money(fee),
    total: money(recipient.amount + fee),
    network: bundle.network,
    busy,
    stage,
    status: payment.archived
      ? "Confirmed"
      : payment.state === "signed"
        ? "Ready to send"
        : payment.state === "accepted"
          ? "Submitted"
          : payment.state === "broadcast-unknown"
            ? "Submission status unknown"
            : paymentStatus(payment),
    warning: highFee
      ? "Unusually high fee. Check it carefully before signing."
      : "",
    details: `<details class="transaction-details"><summary>Transaction details</summary><dl class="data-list"><div><dt>Change</dt><dd>${change ? money(change.amount) : "None"}${change ? `<br><span class="mono">${scriptToAddress(change.scriptPubKey, bundle.network)}</span>` : ""}</dd></div><div><dt>Inputs</dt><dd>${countLabel(bundle.inputs.length, "input")}</dd></div>${payment.txid ? `<div><dt>Transaction ID</dt><dd class="mono">${payment.txid}</dd></div>` : ""}</dl></details>`,
    actions: `${payment.state === "draft" ? `${walletButton("sign", "Confirm on Ledger", busy || client?.sessionState !== "ready")} <button id="discard" class="ghost" ${disabled(busy)}>Discard draft</button>` : !payment.archived && ["signed", "broadcast-unknown", "accepted"].includes(payment.state) ? `<div class="notice ${payment.state === "broadcast-unknown" ? "error" : ""}">${payment.state === "signed" ? "Approved on Ledger. Your payment is ready to send." : payment.state === "accepted" ? "Payment submitted. Confirmation is still being checked. Retrying sends the same payment." : "We could not confirm whether this payment was received. It may already be sent. Retry only this same payment; its funds remain reserved."}</div><label class="check"><input id="broadcast-approval" type="checkbox" ${disabled(busy)}>I approve sending this signed payment on ${bundle.network} through ${sourceMode === "public" ? "Pearl’s public service" : "my configured node"}.</label><button id="broadcast" disabled>${payment.state !== "signed" ? "Retry same payment" : "Send payment"}</button>` : payment.archived ? '<div class="notice success">Payment confirmed. Refresh its status before any retry.</div>' : `<div class="notice error">Signing was interrupted. A signature may already exist, so these funds remain reserved. Reconnect your Ledger to recover and review this same payment.</div><button id="recover-signing" ${disabled(busy || client?.sessionState !== "ready" || !snapshot)}>Recover payment on Ledger</button>`}`,
  });
}
function activity() {
  const slice = pageItems(journal.payments.slice().reverse(), paymentPage);
  paymentPage = slice.page;
  return `${historyCard()}<section class="card"><div class="section-head"><h2>Your payments</h2><span class="tag">${countLabel(journal.payments.length, "record")}</span></div>${slice.items.length ? slice.items.map((p) => `<div class="journal-item"><div class="row"><div><b class="small">${e(paymentStatus(p))}</b><p class="hint">${e(new Date(p.createdAt).toLocaleString())}</p></div><button data-payment="${e(p.id)}" class="secondary" ${disabled(busy)}>View payment</button></div>${p.txid ? `<details><summary>Transaction ID</summary><p class="mono">${e(p.txid)}</p><button class="ghost" data-copy-txid="${e(p.txid)}" ${disabled(busy)}>Copy transaction ID</button></details>` : ""}</div>`).join("") : '<div class="empty"><h3>No payments yet</h3><p>Your payments will appear here.</p></div>'}${pagination("payments", slice.page, slice.pages)}</section>`;
}
function bind() {
  document.getElementById("settings")?.addEventListener("toggle", (event) => {
    settingsOpen = (event.target as HTMLDetailsElement).open;
  });
  const click = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener("click", fn);
  for (const [id, move] of [
    ["history-prev", () => historyPage--],
    ["history-next", () => historyPage++],
    ["payments-prev", () => paymentPage--],
    ["payments-next", () => paymentPage++],
  ] as const)
    click(id, () => {
      if (!busy) {
        move();
        render();
      }
    });
  document
    .querySelectorAll<HTMLButtonElement>("[data-copy-txid]")
    .forEach((el) => {
      el.onclick = () => {
        const txid = el.dataset.copyTxid;
        if (
          busy ||
          !txid ||
          (!history.some((h) => h.txid === txid) &&
            !journal.payments.some((p) => p.txid === txid))
        )
          return;
        void (async () => {
          try {
            await navigator.clipboard.writeText(txid);
            el.textContent = "Copied";
          } catch {
            notify(
              "Could not copy. Select the transaction ID and copy it.",
              true,
            );
          }
        })();
      };
    });
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach(
    (el) =>
      (el.onclick = () => {
        if (!busy) {
          page = el.dataset.nav as typeof page;
          sendStep = receiveStep = 0;
          activePayment = null;
          if (notificationType === "success") notification = "";
          render();
        }
      }),
  );
  document.querySelectorAll<HTMLButtonElement>("[data-payment]").forEach(
    (el) =>
      (el.onclick = () => {
        activePayment = el.dataset.payment!;
        page = "send";
        render();
      }),
  );
  document
    .getElementById("privacy-consent")
    ?.addEventListener("change", (event) => {
      privacyConsent = (event.target as HTMLInputElement).checked;
      render();
    });
  click("sync-public", () => void run("Syncing account…", syncPublic));
  document.getElementById("public-file")?.addEventListener(
    "change",
    (event) =>
      void run("Loading account…", async (signal) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const owner = account;
        const requireCurrent = () => {
          signal.throwIfAborted();
          assert(account === owner, "Account changed during public import");
        };
        assert(file.size < 4096, "Public account file too large");
        const text = await file.text();
        requireCurrent();
        const recovery = importPublicRecovery(text),
          a = recovery.account;
        await store.mutate(accountId(a), (j) => {
          requireCurrent();
          j.issuedReceiveThrough = Math.max(
            j.issuedReceiveThrough,
            recovery.issuedReceiveThrough,
          );
          j.nextChangeIndex = Math.max(
            j.nextChangeIndex,
            recovery.nextChangeIndex,
          );
        });
        channel.postMessage("journal");
        const requireOpen = () =>
          assert(
            !signal.aborted && account === owner,
            "Public recovery range saved; opening the account was cancelled. Saved ranges remain retained.",
          );
        requireOpen();
        const previous = transport;
        await previous?.close();
        if (transport === previous) {
          transport = null;
          client = null;
          verifiedReceive = null;
        }
        requireOpen();
        clearPaymentForm();
        account = a;
        network = a.network;
        accountIndex = a.account;
        snapshot = null;
        validation = null;
        syncComplete = false;
        sourceMode = "node";
        history = [];
        lastUsed = [-1, -1];
        privacyConsent = false;
        verifiedReceive = null;
        activePayment = null;
        selected.clear();
        await refreshJournal();
        notification =
          "Public account loaded. Approve public address disclosure to discover balances, or connect the matching Ledger.";
      }),
  );
  click(
    "backup-export",
    () =>
      void run("Exporting backup…", async () => {
        if (!account) return;
        const owner = account;
        download(
          "pearl-watch-wallet-backup.json",
          exportWalletBackup(owner, await store.journal(accountId(owner))),
        );
      }),
  );
  document.getElementById("backup-file")?.addEventListener(
    "change",
    (event) =>
      void run("Restoring backup…", async (signal) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const owner = account;
        const backup = await importWalletBackupFile(file, signal);
        const requireCurrent = () => {
          signal.throwIfAborted();
          assert(account === owner, "Account changed during backup validation");
        };
        requireCurrent();
        await store.mutate(accountId(backup.account), (j) => {
          // The storage read may have queued behind another tab's write.
          requireCurrent();
          mergeRestoredJournal(j, backup.journal);
        });
        channel.postMessage("journal");
        const requireOpen = () =>
          assert(
            !signal.aborted && account === owner,
            "Backup merged; opening the restored account was cancelled. Reservations remain saved.",
          );
        requireOpen();
        await transport?.close();
        transport = null;
        client = null;
        verifiedReceive = null;
        requireOpen();
        clearPaymentForm();
        account = backup.account;
        network = account.network;
        accountIndex = account.account;
        snapshot = null;
        validation = null;
        syncComplete = false;
        history = [];
        lastUsed = [-1, -1];
        sourceMode = "node";
        privacyConsent = false;
        verifiedReceive = null;
        receiveIndex = 0;
        activePayment = null;
        selected.clear();
        await refreshJournal();
        page = "activity";
        notification =
          "Complete watch backup merged. Reservations and exact signed bytes restored; prior verification, consent and archival claims require fresh checks.";
      }),
  );
  click(
    "reconcile",
    () =>
      void run("Refreshing payment status…", async (signal) => {
        if (sourceMode === "node") {
          await reconcileNodePayments(signal);
          return;
        }
        assert(
          account && snapshot && syncComplete,
          "Complete source resync required",
        );
        const count = await store.mutate(accountId(account), (j) =>
          reconcileConfirmed(j, history, snapshot!.tip),
        );
        channel.postMessage("journal");
        notification = `${count} confirmed records archived; exact signed bytes and all input locks retained. Unknown or conflicted records were not released.`;
      }),
  );
  click("close-settings", () => {
    settingsOpen = false;
    render();
  });
  click(
    "settings-check-node",
    () => void run("Checking available funds…", checkNode),
  );
  click("dismiss", () => {
    notification = "";
    render();
  });
  click("download-signed-recovery", () => {
    if (emergencySignedRecovery)
      download(
        "pearl-signed-payment-backup.json",
        emergencySignedRecovery.text,
      );
  });
  const closeFlow = () => {
    if (!busy) {
      page = "overview";
      activePayment = null;
      render();
    }
  };
  click("flow-close", closeFlow);
  click("recipient-continue", () => {
    if (busy) return;
    try {
      addressToScript(form.recipient.trim(), network);
      form.recipient = form.recipient.trim();
      sendStep = 1;
      notification = "";
      render();
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Check the recipient address",
        true,
      );
    }
  });
  click("send-back-recipient", () => {
    if (!busy) {
      sendStep = 0;
      render();
    }
  });
  click("receive-continue", () => {
    if (!busy) {
      receiveStep = 1;
      render();
    }
  });
  click("receive-back", () => {
    if (!busy) {
      receiveStep = 0;
      render();
    }
  });
  const dialog = document.getElementById(
    "ledger-flow",
  ) as HTMLDialogElement | null;
  if (dialog && typeof dialog.showModal === "function") {
    dialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeFlow();
    });
    dialog.showModal();
  }
  click("connect", () => void connect());
  click("connect-inline", () => void connect());
  click(
    "disconnect",
    () =>
      void run("Closing device session", async () => {
        await transport?.close();
        transport = null;
        client = null;
        account = null;
        clearPaymentForm();
        snapshot = null;
        validation = null;
        history = [];
        syncComplete = false;
        privacyConsent = false;
        lastUsed = [-1, -1];
        journal = emptyJournal();
        activePayment = null;
        verifiedReceive = null;
        selected.clear();
      }),
  );
  document.getElementById("network")?.addEventListener("change", (event) => {
    network = (event.target as HTMLSelectElement).value as NetworkName;
    clearPaymentForm();
    verifiedReceive = null;
    render();
  });
  document
    .getElementById("account-index")
    ?.addEventListener("change", (event) => {
      accountIndex = Number((event.target as HTMLInputElement).value);
    });
  document.getElementById("snapshot-file")?.addEventListener(
    "change",
    (event) =>
      void run("Checking imported account data…", async (signal) => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const owner = account;
        assert(file.size <= 4 * 1024 * 1024, "Snapshot exceeds 4 MiB");
        await importSnapshot(await file.text(), signal, owner);
        notification =
          "Imported public outputs. Chain and completeness claims remain unverified until checked against your source.";
      }),
  );
  click(
    "load-demo",
    () =>
      void run("Loading public example", async (signal) => {
        const owner = account;
        const response = await fetch("/example-watch.json", { signal });
        assert(response.ok, "Example unavailable");
        await importSnapshot(
          await readBoundedText(response, 4 * 1024 * 1024),
          signal,
          owner,
        );
        notification =
          "Public synthetic example loaded. These outputs are not real funds and cannot pass a real node check.";
      }),
  );
  click(
    "restore-cache",
    () =>
      void run("Restoring saved account…", async (signal) => {
        const owner = account;
        const text = await store.load<string>("last-snapshot");
        assert(text, "No locally saved watch data");
        await importSnapshot(text, signal, owner);
        notification =
          "Restored public watch data. Device verification and node freshness have been cleared.";
      }),
  );
  click(
    "clear-cache",
    () =>
      void run("Clearing saved balance data…", async () => {
        await store.removeSavedSnapshot();
        notification =
          "Saved watch snapshot removed. The current account and payment recovery records are unchanged.";
      }),
  );
  click(
    "save-cache",
    () =>
      void run("Saving account…", async () => {
        assert(snapshot, "No snapshot");
        await store.save("last-snapshot", snapshotToJson(snapshot));
        notification =
          "Public watch data saved in this browser profile. No signing keys are stored.";
      }),
  );
  click(
    "export-public",
    () =>
      void run("Exporting account…", async () => {
        if (!account) return;
        const owner = account;
        download(
          "pearl-public-recovery.json",
          exportPublicRecovery(owner, await store.journal(accountId(owner))),
        );
      }),
  );
  document
    .getElementById("receive-index")
    ?.addEventListener("change", (event) => {
      const next = Number((event.target as HTMLInputElement).value);
      if (Number.isInteger(next) && next >= 0 && next < 0x80000000) {
        receiveIndex = next;
        verifiedReceive = null;
        render();
      } else notify("Invalid receive index", true);
    });
  click(
    "new-receive",
    () =>
      void run("Preparing address…", async (signal) => {
        assert(
          account &&
            verifiedReceive === deriveAddress(account, 0, receiveIndex).address,
          "Verify the current address first",
        );
        const owner = account;
        verifiedReceive = null;
        receiveStep = 1;
        render();
        await refreshJournal();
        signal.throwIfAborted();
        assert(account === owner, "Account changed; select the account again");
        const next =
          Math.max(receiveIndex, journal.issuedReceiveThrough, lastUsed[0]) + 1;
        assert(
          next <= 979 && next <= journal.issuedReceiveThrough + 1,
          "No new address available in this account's supported range",
        );
        receiveIndex = next;
        notification = "";
      }),
  );
  click(
    "verify-receive",
    () =>
      void run("Approve the receive address on your Ledger", async (signal) => {
        assert(client && account, "Connect your Ledger");
        verifiedReceive = null;
        assert(
          receiveIndex <= Math.min(979, journal.issuedReceiveThrough + 1),
          "Receive index outside saved recovery range",
        );
        const owner = account,
          device = client,
          index = receiveIndex;
        const expected = deriveAddress(owner, 0, index).address;
        signal.throwIfAborted();
        // Save the public recovery range before an address can be shown on the
        // device. Rejection/cancellation must not roll this range back.
        await store.mutate(accountId(owner), (j) => {
          signal.throwIfAborted();
          recordVerifiedReceive(j, index);
        });
        signal.throwIfAborted();
        assert(
          account === owner && client === device && receiveIndex === index,
          "Receive account changed; reconnect and verify again",
        );
        const returned = await device.verifyAddress(owner, 0, index, signal);
        signal.throwIfAborted();
        assert(
          returned === expected,
          "Ledger address does not match the public account",
        );
        assert(
          account === owner && client === device && receiveIndex === index,
          "Receive account changed; reconnect and verify again",
        );
        signal.throwIfAborted();
        verifiedReceive = expected;
        notification =
          "Full receive address matched the Ledger-confirmed result.";
      }),
  );
  click(
    "copy-address",
    () =>
      void run("Copying verified address", async () => {
        assert(verifiedReceive, "Verify address first");
        await navigator.clipboard.writeText(verifiedReceive);
        notification = "Verified receive address copied.";
      }),
  );
  click("check-node", () => void run("Checking available funds…", checkNode));
  for (const [id, key] of [
    ["recipient", "recipient"],
    ["amount", "amount"],
    ["fee", "fee"],
    ["change-index", "changeIndex"],
  ] as const)
    document.getElementById(id)?.addEventListener("input", (event) => {
      form[key] = (event.target as HTMLInputElement).value;
      const hint = document.getElementById("fee-policy");
      if (hint) hint.textContent = feePolicyHint();
      for (const option of feeQuoteOptions()) {
        const button = document.getElementById(
          `fee-target-${option.blocks}`,
        ) as HTMLButtonElement | null;
        if (button) {
          button.textContent = option.label;
          button.disabled = busy || option.disabled;
        }
      }
    });
  document.querySelectorAll<HTMLInputElement>("[data-coin]").forEach(
    (el) =>
      (el.onchange = () => {
        manualSelection = true;
        el.checked
          ? selected.add(el.dataset.coin!)
          : selected.delete(el.dataset.coin!);
        render();
      }),
  );
  document
    .getElementById("coin-control")
    ?.addEventListener("toggle", (event) => {
      coinControlOpen = (event.target as HTMLDetailsElement).open;
    });
  click(
    "refresh-fees",
    () =>
      void run("Getting network fee estimates…", async (signal) => {
        assert(
          sourceMode === "public" && ["mainnet", "testnet2"].includes(network),
          "Use a manual fee on this network",
        );
        const requestedNetwork = network;
        let quotes: FeeQuote[] = [];
        try {
          quotes = await loadFeeQuotes(
            browserPublicSource(
              requestedNetwork,
              true,
              AbortSignal.any([signal, AbortSignal.timeout(15_000)]),
            ),
          );
        } catch {
          signal.throwIfAborted();
        }
        signal.throwIfAborted();
        assert(
          network === requestedNetwork && sourceMode === "public",
          "Network changed; request new estimates",
        );
        feeQuotes = quotes;
        feeQuoteNetwork = requestedNetwork;
        feeQuoteStatus = quotes.length
          ? "Block targets are estimates, not guarantees. Choose a total fee to apply it."
          : "Estimates unavailable. Enter a manual fee; the relay minimum is shown above.";
      }),
  );
  for (const blocks of FEE_TARGETS)
    click(
      `fee-target-${blocks}`,
      () =>
        void run("Applying fee estimate…", async (signal) => {
          assert(
            snapshot &&
              account &&
              sourceMode === "public" &&
              feeQuoteNetwork === network,
            "Request estimates for this network first",
          );
          const owner = account,
            watch = snapshot,
            quote = feeQuotes.find((item) => item.blocks === blocks);
          const displayed = feeQuoteOptions().find(
            (item) => item.blocks === blocks,
          )?.feePrl;
          assert(
            quote && displayed,
            "Fee estimate unavailable or expired; refresh estimates",
          );
          await refreshJournal();
          signal.throwIfAborted();
          assert(
            account === owner && snapshot === watch,
            "Account changed; review the fee again",
          );
          const next = quotedPayment(
            watch,
            currentFeeRequest(),
            reservedOutpoints(journal),
            quote,
            manualSelection,
          );
          assert(
            next.feePrl === displayed,
            "Available inputs changed; review the refreshed estimate",
          );
          form.fee = next.feePrl;
        }),
    );
  click(
    "send-max",
    () =>
      void run("Calculating maximum…", async (signal) => {
        assert(snapshot && account, "Sync your account first");
        const owner = account,
          watch = snapshot;
        await refreshJournal();
        signal.throwIfAborted();
        assert(
          snapshot === watch && account === owner,
          "Account changed; review the amount again",
        );
        const maximum = maximumPayment(
          watch,
          {
            recipient: form.recipient.trim(),
            feePrl: form.fee,
            changeIndex: Number(form.changeIndex),
          },
          reservedOutpoints(journal),
          manualSelection ? [...selected] : undefined,
        );
        form.amount = maximum.amountPrl;
        selected.clear();
        for (const id of maximum.selected) selected.add(id);
        manualSelection = true;
      }),
  );
  click("auto-inputs", () => {
    manualSelection = false;
    selected.clear();
    render();
  });
  click(
    "prepare",
    () =>
      void run("Preparing payment…", async (signal) => {
        assert(snapshot && account, "Load account");
        const owner = account,
          watch = snapshot,
          source = sourceMode,
          useManualSelection = manualSelection,
          request = {
            selected: [...selected],
            recipient: form.recipient.trim(),
            amountPrl: form.amount,
            feePrl: form.fee,
            changeIndex: Number(form.changeIndex),
          };
        const requireCurrent = () => {
          signal.throwIfAborted();
          assert(
            account === owner &&
              snapshot === watch &&
              sourceMode === source &&
              network === owner.network,
            "Payment context changed; review and prepare again",
          );
        };
        requireCurrent();
        if (source === "public")
          assert(
            request.changeIndex < 980,
            "Change index is outside light recovery bounds",
          );
        const id = crypto.randomUUID();
        await store.mutate(accountId(owner), (j) => {
          requireCurrent();
          const reserved = reservedOutpoints(j);
          if (!useManualSelection)
            request.selected = selectPaymentInputs(
              watch,
              request.amountPrl,
              request.feePrl,
              reserved,
            );
          const bundle = preparePayment(watch, request, reserved);
          reservePayment(j, bundle, id);
        });
        channel.postMessage("journal");
        assert(
          !signal.aborted &&
            account === owner &&
            snapshot === watch &&
            sourceMode === source &&
            network === owner.network,
          "Unsigned payment saved; opening the review was cancelled. Inputs remain reserved; review or discard the draft from activity.",
        );
        activePayment = id;
        notification = "";
      }),
  );
  click(
    "discard",
    () =>
      void run("Discarding unsigned draft", async () => {
        assert(account && activePayment, "No draft");
        await store.mutate(accountId(account), (j) =>
          discardDraft(j, activePayment!),
        );
        activePayment = null;
        selected.clear();
        channel.postMessage("journal");
        notification =
          "Unsigned draft discarded. Inputs released; allocated change index will not be reused.";
      }),
  );
  click("sign", () => void signFromView());
  click("recover-signing", () => void signFromView(true));
  click("cancel-device", () => currentAbort?.abort());
  document
    .getElementById("broadcast-approval")
    ?.addEventListener("change", (event) => {
      const button = document.getElementById("broadcast") as HTMLButtonElement;
      button.disabled = busy || !(event.target as HTMLInputElement).checked;
    });
  click("broadcast", () => {
    if (busy) return;
    const approved = (
      document.getElementById("broadcast-approval") as HTMLInputElement | null
    )?.checked;
    const payment = getPayment();
    if (!approved || !account || !payment?.rawTx || !payment.txid) {
      notify("Approve this exact signed payment before broadcasting", true);
      return;
    }
    const approval: BroadcastApproval = Object.freeze({
      ownerId: accountId(account),
      paymentId: payment.id,
      network,
      source: sourceMode,
      rawTx: payment.rawTx,
      txid: payment.txid,
    });
    void run("Sending payment…", (signal) => broadcast(signal, approval));
  });
  click("back-payments", () => {
    activePayment = null;
    page = "activity";
    render();
  });
}
async function importSnapshot(
  text: string,
  signal?: AbortSignal,
  owner: AccountPublicKey | null = account,
) {
  const requireCurrent = () => {
    signal?.throwIfAborted();
    assert(account === owner, "Account changed during snapshot import");
  };
  requireCurrent();
  const imported = parseWatchSnapshot(text);
  await store.mutate(accountId(imported.account), (j) => {
    requireCurrent();
    recordRecoveryPaths(j, imported.coins);
  });
  channel.postMessage("journal");
  const requireOpen = () =>
    assert(
      !signal?.aborted && account === owner,
      "Snapshot recovery paths saved; opening the account was cancelled. Saved ranges remain retained.",
    );
  requireOpen();
  if (account && accountId(account) !== accountId(imported.account)) {
    const previous = transport;
    await previous?.close();
    if (transport === previous) {
      transport = null;
      client = null;
      verifiedReceive = null;
    }
    requireOpen();
  }
  syncComplete = false;
  sourceMode = "node";
  history = [];
  lastUsed = [-1, -1];
  privacyConsent = false;
  if (!account || accountId(account) !== accountId(imported.account))
    clearPaymentForm();
  account = imported.account;
  network = account.network;
  accountIndex = account.account;
  snapshot = imported;
  validation = null;
  verifiedReceive = null;
  activePayment = null;
  selected.clear();
  receiveIndex = 0;
  await refreshJournal();
}
async function connect() {
  // Call discovery synchronously from the click before any await breaks the picker gesture.
  if (busy) return;
  const beginConnection = () =>
    connectLedger(
      () => {
        verifiedReceive = null;
        client = null;
        currentAbort?.abort();
        notification =
          "Ledger disconnected. Exit and reopen the Pearl app on the device before reconnecting; payment reservations remain locked.";
        notificationType = "error";
        render();
      },
      "bitcoin-prl",
      network,
    );
  // WebHID needs the click gesture. Ledger Wallet instead reuses a single
  // host transport ID, so finish the old close before requesting a new one.
  // Observe early picker rejection while old-session cleanup is still pending.
  const connecting =
    window.location?.pathname === "/live.html"
      ? null
      : beginConnection().then(
          (transport) => ({ transport }),
          (error: unknown) => ({ error }),
        );
  await run(
    "Open Pearl on your Ledger and approve the account.",
    async (signal) => {
      const previous = transport;
      transport = null;
      client = null;
      verifiedReceive = null;
      try {
        await previous?.close();
      } catch (error) {
        // Own the gesture-started picker even if old-session cleanup fails.
        if (connecting) {
          const outcome = await connecting;
          if ("transport" in outcome)
            await outcome.transport.close().catch(() => {});
        }
        throw error;
      }
      if (!connecting) signal.throwIfAborted();
      const outcome = connecting
        ? await connecting
        : { transport: await beginConnection() };
      if ("error" in outcome) throw outcome.error;
      const connected = outcome.transport;
      try {
        signal.throwIfAborted();
        transport = connected;
        client = new LedgerBitcoinPrlClient(connected, network);
        render();
        const capabilities = await client.capabilities(signal);
        signal.throwIfAborted();
        assert(
          capabilities.protocol === "ledger-bitcoin-prl-v1" &&
            capabilities.network === network,
          "Wrong Pearl app/network",
        );
        const exported = await client.exportAccount(accountIndex, signal);
        signal.throwIfAborted();
        if (account && accountId(account) !== accountId(exported)) {
          clearPaymentForm();
          snapshot = null;
          validation = null;
          activePayment = null;
          history = [];
          lastUsed = [-1, -1];
          sourceMode = "node";
          syncComplete = false;
          privacyConsent = false;
          receiveIndex = 0;
          selected.clear();
        }
        account = exported;
        await refreshJournal();
        signal.throwIfAborted();
        notification = `Pearl PSBT signer connected. Public account ${exported.account} approved on the device.`;
      } catch (error) {
        await connected.close();
        if (transport === connected) {
          transport = null;
          client = null;
          verifiedReceive = null;
        }
        throw error;
      }
    },
  );
}
async function signFromView(recovery = false) {
  if (busy) return;
  signingRequested = true;
  try {
    await run(
      recovery ? "Recovering payment…" : "Checking payment…",
      (signal) => sign(signal, recovery),
    );
  } finally {
    signingRequested = false;
    render();
  }
}
async function sign(signal: AbortSignal, recovery = false) {
  assert(
    !emergencySignedRecovery,
    "Save and restore the signed-payment recovery backup before further signing",
  );
  assert(
    client && account && snapshot && activePayment,
    "Connect Ledger and load the reserved payment's watch data",
  );
  const owner = account,
    ownerId = accountId(owner),
    paymentId = activePayment,
    device = client;
  assert(
    device.sessionState === "ready",
    "Exit and reopen the Pearl app on your Ledger, then reconnect before signing",
  );
  assert(
    network === owner.network && accountId(snapshot.account) === ownerId,
    "Signing account or network differs from watch data",
  );
  signal.throwIfAborted();
  const payment = (await store.journal(ownerId)).payments.find(
    (p) => p.id === paymentId,
  );
  signal.throwIfAborted();
  assert(
    payment?.state === (recovery ? "signing" : "draft") &&
      payment.rawTx === undefined &&
      payment.txid === undefined &&
      !payment.archived,
    recovery
      ? "Only an interrupted signing record without saved bytes can be recovered"
      : "Only a fresh unsigned draft may be signed",
  );
  const bundle = paymentBundle(payment);
  validateBundle(bundle, owner);
  assert(
    JSON.stringify(payment.outpoints) ===
      JSON.stringify(bundle.inputs.map(outpoint)),
    "Saved reservations differ from the canonical payment",
  );
  assertPaymentPolicy(bundle);
  await checkNode(signal);
  signal.throwIfAborted();
  requireFreshValidation(snapshot, validation, bundle);
  const attemptId = crypto.randomUUID();
  const signingRecord = await store.mutate(ownerId, (j) => {
    signal.throwIfAborted();
    const current = j.payments.find((p) => p.id === paymentId);
    assert(
      current && JSON.stringify(current) === JSON.stringify(payment),
      "Payment changed during input validation; review it again",
    );
    assertPaymentPolicy(paymentBundle(current));
    if (!recovery) transitionPayment(j, paymentId, "signing");
    current.signingAttempt = { id: attemptId, recovery };
    return JSON.stringify(current);
  });
  signal.throwIfAborted();
  await refreshJournal();
  signal.throwIfAborted();
  channel.postMessage("journal");
  if (recovery) {
    // Claim callback ownership before any recovery APDU. Failed sessions must
    // reconnect; ready sessions still require fresh device-approved identity.
    const exported = await device.exportAccount(owner.account, signal);
    signal.throwIfAborted();
    assert(
      accountId(exported) === ownerId,
      "Recovery Ledger account does not match the reserved payment",
    );
    const now = Date.now();
    if (
      !validation ||
      now < validation.checkedAt ||
      now - validation.checkedAt > 60_000
    ) {
      // Human approval can take longer than the input-check lifetime. Refresh
      // once, never loop or infer unspent status from an unavailable source.
      await checkNode(signal);
      signal.throwIfAborted();
    }
    const current = (await store.journal(ownerId)).payments.find(
      (p) => p.id === paymentId,
    );
    signal.throwIfAborted();
    assert(
      JSON.stringify(current) === signingRecord,
      "Payment changed during recovery approval; review its current state",
    );
  }
  // An account-export approval can take longer than the source-check lifetime.
  requireFreshValidation(snapshot, validation, bundle);
  signal.throwIfAborted();
  busyText = "Check network, recipient, amount, fee and change on your Ledger";
  render();
  let persistedRawTx: string | null = null;
  let stagedRecovery: SignedRecovery | null = null;
  const persistVerifiedSigned = async (result: FinalizedTransaction) => {
    const recoveryText = signedRecoveryBackup(
      owner,
      bundle,
      result,
      paymentId,
      payment.createdAt,
    );
    // Preserve a verified recovery copy before the first storage await. A
    // navigation or stalled transaction must not precede the unload warning.
    const recovery: SignedRecovery = {
      pending: true,
      text: recoveryText,
      txid: result.txid,
      ownerId,
      paymentId,
      bundleHex: payment.bundleHex,
      createdAt: payment.createdAt,
      outpoints: JSON.stringify(payment.outpoints),
    };
    stagedRecovery = recovery;
    emergencySignedRecovery = recovery;
    render();
    // Once signatures return, cancellation cannot discard independently verified
    // bytes. Concurrent completions may have a different valid witness, but must
    // describe exactly the same canonical payment and transaction ID.
    const checked = finalizeTransaction(bundle, result.signatures);
    assert(
      checked.rawTx === result.rawTx && checked.txid === result.txid,
      "Final transaction mismatch",
    );
    const retained = await store.mutate(ownerId, (j) => {
      const current = j.payments.find((p) => p.id === paymentId);
      assert(
        current &&
          current.bundleHex === payment.bundleHex &&
          current.createdAt === payment.createdAt &&
          JSON.stringify(current.outpoints) ===
            JSON.stringify(payment.outpoints),
        "Reserved payment changed before signed storage; existing record retained",
      );
      if (current.rawTx !== undefined || current.txid !== undefined) {
        assert(
          ["signed", "broadcast-unknown", "accepted"].includes(current.state) &&
            current.rawTx &&
            current.txid,
          "Inconsistent saved signed payment; existing record retained",
        );
        const saved = finalizeTransaction(
          bundle,
          parseTransaction(current.rawTx).inputs.map((i) => i.witness[0]!),
        );
        assert(
          saved.rawTx === current.rawTx &&
            saved.txid === current.txid &&
            saved.txid === checked.txid,
          "Concurrent signed payment failed verification; existing record retained",
        );
        return true;
      }
      assert(
        current.state === "signing" && !current.archived,
        "Signing reservation changed; existing record retained",
      );
      transitionPayment(j, paymentId, "signed", {
        rawTx: checked.rawTx,
        txid: checked.txid,
      });
      return false;
    });
    // A successful update acknowledgement alone does not clear the recovery
    // copy. Read back and independently verify the complete saved payment.
    assert(
      await verifyRestoredEmergencyBackup(recovery),
      "Signed storage read-back could not be verified; retain the signed-payment recovery backup",
    );
    channel.postMessage("journal");
    notification = retained
      ? "Another tab's independently verified signed bytes were preserved. Broadcast still requires separate explicit approval."
      : "Signatures independently verified and exact signed bytes saved. Broadcast requires a separate approval.";
    persistedRawTx = result.rawTx;
  };
  // Persist at the last independently verified signature yield, before the
  // final device ACK. A missing ACK must not discard a spendable transaction.
  let result;
  try {
    result = await device.signBundle(bundle, owner, {
      signal,
      onVerifiedSigned: persistVerifiedSigned,
    });
  } catch (error) {
    markPendingRecoveryFailed(stagedRecovery);
    // The callback normally stages recovery before touching storage. Preserve
    // the adapter's verified result if failure preceded that staging boundary.
    if (error instanceof VerifiedSigningResultError && !stagedRecovery) {
      const signed = error.signedTransaction;
      emergencySignedRecovery = {
        pending: false,
        text: signedRecoveryBackup(
          owner,
          bundle,
          signed,
          paymentId,
          payment.createdAt,
        ),
        txid: signed.txid,
        ownerId,
        paymentId,
        bundleHex: payment.bundleHex,
        createdAt: payment.createdAt,
        outpoints: JSON.stringify(payment.outpoints),
      };
      render();
    }
    throw error;
  }
  if (persistedRawTx === null) await persistVerifiedSigned(result);
  assert(
    persistedRawTx === result.rawTx,
    "Returned signed bytes differ from durable result",
  );
  if (result.completionWarning) {
    notification =
      "Signed bytes were verified and saved, but the final device acknowledgement was not confirmed. Reconnect before another operation. Broadcast still requires separate approval.";
    notificationType = "error";
  }
}
/** Recheck known local-node payments without claiming a complete account scan. */
async function reconcileNodePayments(signal: AbortSignal) {
  assert(account, "Load a public account first");
  const owner = account,
    id = accountId(owner);
  // Local verification has a fixed record/signature bound and yields for Cancel.
  // Slow cryptography must not consume the later bounded network allowance.
  let operation = signal;
  let deadline: number | undefined;
  const checkBudget = () => {
    operation.throwIfAborted();
    assert(
      deadline === undefined || performance.now() < deadline,
      "Reconciliation deadline exceeded; journal unchanged",
    );
  };
  checkBudget();
  const saved = await store.journal(id),
    original = JSON.stringify(saved.payments);
  checkBudget();
  assert(
    saved.payments.length <= 2000,
    "Reconciliation journal limit exceeded",
  );
  const signed = saved.payments.filter(
    (p) => p.rawTx !== undefined || p.txid !== undefined,
  );
  assert(
    new Set(signed.map((p) => p.txid)).size === signed.length,
    "Duplicate known signed transaction in journal",
  );
  const active: {
    payment: PaymentRecord;
    payload: { bundleHex: string; rawTx: string; expectedTxid: string };
  }[] = [];
  const receipts = new Map<
    string,
    { block: ReturnType<typeof chainTip>; payments: PaymentRecord[] }
  >();
  for (const [index, payment] of signed.entries()) {
    // Yield during large local verification passes so Cancel remains
    // observable before any node request.
    if (index % 10 === 0)
      await new Promise((resolve) => setTimeout(resolve, 0));
    checkBudget();
    assert(
      payment.rawTx &&
        payment.txid &&
        ["signed", "broadcast-unknown", "accepted"].includes(payment.state),
      "Corrupt signed payment; do not clear its reservation",
    );
    const bundle = paymentBundle(payment);
    validateBundle(bundle, owner);
    const raw = parseTransaction(payment.rawTx);
    const checked = finalizeTransaction(
      bundle,
      raw.inputs.map((i) => i.witness[0]!),
    );
    assert(
      checked.rawTx === payment.rawTx && checked.txid === payment.txid,
      "Saved signed payment bytes failed verification",
    );
    let receipt: ReturnType<typeof chainTip> | undefined;
    if (payment.archived) {
      try {
        assert(
          payment.archived.status === "confirmed",
          "Invalid archival status",
        );
        safeInteger(payment.archived.checkedAt, Number.MAX_SAFE_INTEGER);
        receipt = chainTip(payment.archived.block);
      } catch {
        /* A malformed legacy receipt must requalify by exact raw lookup. */
      }
    }
    if (receipt) {
      const key = `${receipt.height}:${receipt.hash}`;
      const group = receipts.get(key) ?? { block: receipt, payments: [] };
      group.payments.push(payment);
      receipts.set(key, group);
    } else
      active.push({
        payment,
        payload: {
          bundleHex: payment.bundleHex,
          rawTx: payment.rawTx,
          expectedTxid: payment.txid,
        },
      });
  }
  const knownHistory: HistoryEntry[] = [];
  let tip: ReturnType<typeof chainTip> | undefined,
    calls = 0,
    detached = 0;
  // At most 20 batches, with the same 80-second allowance for each necessary
  // batch. Per-request timeouts, RPC ceilings and one stable tip still apply.
  const networkBudgetMs = 80_000 * Math.max(1, Math.ceil(active.length / 100));
  const networkAbort = new AbortController();
  let networkTimer: ReturnType<typeof setTimeout> | undefined;
  const forwardCancel = () => {
    if (networkTimer !== undefined) clearTimeout(networkTimer);
    networkAbort.abort(signal.reason);
  };
  if (signal.aborted) forwardCancel();
  else {
    signal.addEventListener("abort", forwardCancel, { once: true });
    networkTimer = setTimeout(
      () =>
        networkAbort.abort(
          new Error("Reconciliation deadline exceeded; journal unchanged"),
        ),
      networkBudgetMs,
    );
  }
  operation = networkAbort.signal;
  deadline = performance.now() + networkBudgetMs;
  try {
    for (let offset = 0; offset < Math.max(1, active.length); offset += 100) {
      checkBudget();
      const batch = active.slice(offset, offset + 100),
        checkpoints =
          offset === 0 ? [...receipts.values()].map((r) => r.block) : [];
      const result = record(
        await post(
          "/api/reconcile",
          { payments: batch.map((p) => p.payload), checkpoints },
          operation,
        ),
        "reconciliation response",
      );
      checkBudget();
      exactKeys(
        result,
        [
          "network",
          "genesisHash",
          "tip",
          "checkedAt",
          "rpcCalls",
          "transactions",
          "checkpoints",
        ],
        "reconciliation response",
      );
      assert(
        result.network === owner.network &&
          result.genesisHash === NETWORKS[owner.network].genesisHash,
        "Reconciliation network mismatch",
      );
      const currentTip = chainTip(result.tip);
      assert(
        !tip ||
          (currentTip.hash === tip.hash && currentTip.height === tip.height),
        "Node tip changed between reconciliation batches; retry",
      );
      tip = currentTip;
      safeInteger(result.checkedAt, Number.MAX_SAFE_INTEGER);
      calls += safeInteger(result.rpcCalls, 2108);
      assert(calls <= 4160, "Total reconciliation RPC budget exhausted");
      assert(
        Array.isArray(result.transactions) &&
          result.transactions.length === batch.length &&
          Array.isArray(result.checkpoints) &&
          result.checkpoints.length === checkpoints.length,
        "Incomplete reconciliation coverage",
      );
      const expected = new Set(batch.map((p) => p.payload.expectedTxid));
      for (const value of result.transactions) {
        const tx = record(value, "known transaction"),
          txid = hash(tx.txid);
        assert(
          expected.delete(txid),
          "Unexpected or duplicate reconciliation transaction",
        );
        assert(
          ["confirmed", "pending", "unknown", "detached"].includes(
            String(tx.state),
          ),
          "Invalid reconciliation state",
        );
        if (tx.state === "confirmed") {
          exactKeys(
            tx,
            ["txid", "state", "block", "confirmations"],
            "confirmed transaction",
          );
          const block = chainTip(tx.block),
            confirmations = safeInteger(tx.confirmations);
          assert(
            confirmations > 0 &&
              confirmations === tip.height - block.height + 1,
            "Inconsistent reconciliation confirmation count",
          );
          knownHistory.push({
            txid,
            received: 0n,
            spent: 0n,
            block,
            state: "confirmed",
          });
        } else {
          exactKeys(tx, ["txid", "state"], "unconfirmed transaction");
          if (tx.state === "detached") detached++;
        }
      }
      const expectedCheckpoints = new Set(
        checkpoints.map((c) => `${c.height}:${c.hash}`),
      );
      for (const value of result.checkpoints) {
        const c = record(value, "archival checkpoint"),
          block = chainTip({ height: c.height, hash: c.hash }),
          key = `${block.height}:${block.hash}`;
        assert(
          expectedCheckpoints.delete(key),
          "Unexpected or duplicate archival checkpoint",
        );
        assert(
          ["confirmed", "insufficient", "unknown", "detached"].includes(
            String(c.state),
          ),
          "Invalid archival checkpoint state",
        );
        if (c.state === "confirmed") {
          exactKeys(
            c,
            ["height", "hash", "state", "confirmations"],
            "confirmed checkpoint",
          );
          const confirmations = safeInteger(c.confirmations);
          assert(
            confirmations >= 6 &&
              confirmations === tip.height - block.height + 1,
            "Invalid archival checkpoint depth",
          );
          for (const payment of receipts.get(key)!.payments)
            knownHistory.push({
              txid: payment.txid!,
              received: 0n,
              spent: 0n,
              block,
              state: "confirmed",
            });
        } else {
          exactKeys(c, ["height", "hash", "state"], "unconfirmed checkpoint");
          if (c.state === "detached")
            detached += receipts.get(key)!.payments.length;
        }
      }
    }
    checkBudget();
    assert(tip, "Missing reconciliation tip");
    const checkedTip = tip;
    const count = await store.mutate(id, (j) => {
      checkBudget();
      assert(
        JSON.stringify(j.payments) === original,
        "Payment journal changed during reconciliation; retry",
      );
      return reconcileConfirmed(j, knownHistory, checkedTip);
    });
    channel.postMessage("journal");
    notification = `${signed.length} known signed payments checked against the configured node at block ${tip.height}; ${count} confirmed records archived. ${signed.length - count} records remain active or unresolved, including ${detached} detached. All exact bytes and input locks retained. This trusts the node's chain view; a later reorg can change confirmation.`;
  } finally {
    if (networkTimer !== undefined) clearTimeout(networkTimer);
    signal.removeEventListener("abort", forwardCancel);
    networkAbort.abort(new Error("Reconciliation scope completed"));
  }
}
type BroadcastApproval = Readonly<{
  ownerId: string;
  paymentId: string;
  network: NetworkName;
  source: "node" | "public";
  rawTx: string;
  txid: string;
}>;
async function broadcast(
  signal: AbortSignal | undefined = currentAbort?.signal,
  approval?: BroadcastApproval,
) {
  assert(
    account && activePayment && approval,
    "Explicit signed-payment approval required",
  );
  const owner = account,
    ownerId = accountId(owner),
    paymentId = activePayment;
  assert(
    network === owner.network,
    "Selected broadcast network differs from account",
  );
  assert(
    approval.ownerId === ownerId &&
      approval.paymentId === paymentId &&
      approval.network === network &&
      approval.source === sourceMode,
    "Broadcast context changed; review and approve again",
  );
  const requireApproval = () => {
    signal?.throwIfAborted();
    assert(
      account === owner &&
        accountId(owner) === approval.ownerId &&
        activePayment === approval.paymentId &&
        network === approval.network &&
        network === owner.network &&
        sourceMode === approval.source,
      "Broadcast context changed; review and approve again",
    );
    assert(
      approval.source !== "public" || privacyConsent,
      "Public address disclosure approval required",
    );
  };
  requireApproval();
  const payment = (await store.journal(ownerId)).payments.find(
    (p) => p.id === paymentId,
  );
  requireApproval();
  assert(
    payment &&
      ["signed", "broadcast-unknown", "accepted"].includes(payment.state) &&
      payment.rawTx &&
      payment.txid,
    "No verified signed transaction",
  );
  assert(
    payment.rawTx === approval.rawTx && payment.txid === approval.txid,
    "Signed payment changed; review and approve again",
  );
  assert(
    approval.source !== "public" || privacyConsent,
    "Public address disclosure approval required",
  );
  assert(
    !payment.archived,
    "Reconcile the archived payment before an explicit rebroadcast",
  );
  const bundle = paymentBundle(payment);
  validateBundle(bundle, owner);
  const parsed = parseTransaction(payment.rawTx),
    checked = finalizeTransaction(
      bundle,
      parsed.inputs.map((i) => i.witness[0]!),
    );
  assert(
    checked.rawTx === payment.rawTx && checked.txid === payment.txid,
    "Persisted signed transaction failed verification",
  );
  await store.mutate(ownerId, (j) => {
    requireApproval();
    const current = j.payments.find((p) => p.id === paymentId);
    assert(
      current && !current.archived,
      "Reconcile the archived payment before an explicit rebroadcast",
    );
    assert(
      JSON.stringify(current) === JSON.stringify(payment),
      "Payment changed before broadcast; review and retry",
    );
    transitionPayment(j, paymentId, "broadcast-unknown");
  });
  requireApproval();
  channel.postMessage("journal");
  const payload = {
    bundleHex: payment.bundleHex,
    rawTx: payment.rawTx,
    expectedTxid: payment.txid,
  };
  // The transaction-completion await can dispatch queued UI events. Check
  // authority again at the last synchronous boundary before sending bytes.
  requireApproval();
  const result = await post(
    approval.source === "public" ? "/api/indexer/broadcast" : "/api/broadcast",
    approval.source === "public"
      ? {
          network: owner.network,
          consent: privacyConsent,
          rawTx: payment.rawTx,
          expectedTxid: payment.txid,
        }
      : payload,
    signal,
  );
  assert(
    result &&
      typeof result === "object" &&
      "txid" in result &&
      result.txid === payment.txid,
    "Unexpected node response; acceptance remains unknown",
  );
  await store.mutate(ownerId, (j) => {
    const current = j.payments.find((p) => p.id === paymentId);
    assert(
      current &&
        current.rawTx === payment.rawTx &&
        current.txid === payment.txid &&
        current.bundleHex === payment.bundleHex,
      "Payment changed after submission; preserve the signed bytes and reconcile",
    );
    if (current.state !== "accepted")
      transitionPayment(j, paymentId, "accepted");
  });
  channel.postMessage("journal");
  notification =
    "Node accepted the exact signed transaction. Confirmation is still pending.";
}
function download(name: string, text: string) {
  const url = URL.createObjectURL(
    new Blob([text], { type: "application/json" }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
channel.onmessage = () => {
  void refreshJournal()
    .then(() => {
      if (!busy) render();
    })
    .catch(() =>
      notify(
        "Unable to refresh cross-tab reservations; stop before preparing a payment",
        true,
      ),
    );
};
window.addEventListener("beforeunload", (event) => {
  if (emergencySignedRecovery) {
    event.preventDefault();
    event.returnValue = "";
  }
  currentAbort?.abort();
  void transport?.close();
});
render();
