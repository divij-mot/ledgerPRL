import "./styles.css";
import {
  LedgerPearlClient,
  DeviceError,
  INS,
  type AccountPublicKey,
  type NetworkName,
  type SigningBundle,
  accountFromJson,
  accountToJson,
  deriveAddress,
  formatPrl,
  hex,
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
  type WatchSnapshot,
  type ChainValidation,
  type WalletJournal,
  type PaymentRecord,
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
  reservedOutpoints,
  reservePayment,
  transitionPayment,
  discardDraft,
  exportWalletBackup,
  importWalletBackup,
  mergeRestoredJournal,
  reconcileConfirmed,
  MAX_BACKUP_BYTES,
  rejectBeforeSigning,
  exportPublicRecovery,
  importPublicRecovery,
  recordVerifiedReceive,
  recordRecoveryPaths,
  paymentBundle,
  emptyJournal,
  applyValidation,
  requireFreshValidation,
} from "@pearl-ledger/wallet";
import { connectLedger, type DmkPearlTransport } from "./ledger.js";
import { WatchStorage } from "./storage.js";

const app = document.querySelector<HTMLDivElement>("#app")!;
const store = new WatchStorage();
const channel = new BroadcastChannel("pearl-ledger-watch-v1");
let sourceMode: "node" | "public" = "node",
  privacyConsent = false,
  syncComplete = false;
let history: HistoryEntry[] = [],
  lastUsed: [number, number] = [-1, -1];
let page: "overview" | "receive" | "send" | "activity" = "overview";
let network: NetworkName = "regtest",
  accountIndex = 0,
  account: AccountPublicKey | null = null;
let snapshot: WatchSnapshot | null = null,
  validation: ChainValidation | null = null;
let client: LedgerPearlClient | null = null,
  transport: DmkPearlTransport | null = null;
let journal: WalletJournal = emptyJournal(),
  activePayment: string | null = null;
let busy = false,
  busyText = "",
  notification = "",
  notificationType = "success";
let receiveIndex = 0,
  verifiedReceive: string | null = null;
let currentAbort: AbortController | null = null;
const selected = new Set<string>();
const form = { recipient: "", amount: "", fee: "0.00001000", changeIndex: "0" };
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
  if (account) {
    journal = await store.journal(accountId(account));
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
  render();
  try {
    await work(currentAbort.signal);
  } catch (error) {
    notification = error instanceof Error ? error.message : "Operation failed";
    notificationType = "error";
  } finally {
    busy = false;
    busyText = "";
    currentAbort = null;
    await refreshJournal().catch((error) => {
      notification = String(error);
      notificationType = "error";
    });
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
async function checkNode() {
  assert(snapshot, "Import or discover public watch data first");
  const result = applyValidation(
    snapshot,
    await post(
      sourceMode === "public" ? "/api/light/check" : "/api/check",
      sourceMode === "public"
        ? {
            network,
            consent: privacyConsent,
            snapshot: JSON.parse(snapshotToJson(snapshot)),
          }
        : JSON.parse(snapshotToJson(snapshot)),
    ),
  );
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
  const active = getPayment(),
    b = snapshot ? balances(snapshot, reservedOutpoints(journal)) : null;
  app.innerHTML = `<div class="layout"><aside class="sidebar"><div><div class="brand"><span class="pearl" aria-hidden="true"></span>pearl</div><div class="subtitle">Ledger companion</div></div><nav class="nav" aria-label="Main navigation">${(["overview", "receive", "send", "activity"] as const).map((p, i) => `<button data-nav="${p}" class="${page === p ? "active" : ""}" ${disabled(busy)}><span aria-hidden="true">${["◫", "↙", "↗", "≋"][i]}</span>${p[0]!.toUpperCase() + p.slice(1)}</button>`).join("")}</nav><div class="sidebar-bottom"><span class="status-dot"></span>Watch-only by design<br>Your keys stay on your Ledger.<br><br>Protocol v1 · Development build<br>No recovery phrase needed.</div></aside><main class="main"><header class="topbar"><div><p class="eyebrow">Your Pearl, under your control</p><h1>${{ overview: "Account overview", receive: "Receive Pearl", send: "Send with confidence", activity: "Payment activity" }[page]}</h1></div><div class="actions"><span class="tag ${network === "mainnet" ? "warn" : ""}">${e(network)}</span><button id="connect" ${disabled(busy)}>${client?.sessionState === "ready" ? "Reconnect Ledger" : "Connect Ledger"}</button></div></header><div class="notice">Development prototype. Not audited, Ledger-approved or verified on physical hardware. Use disposable test funds only. Classical Taproot custody; no post-quantum claim.</div>${notification ? `<div role="status" class="notice ${notificationType}">${e(notification)} <button id="dismiss" class="ghost" aria-label="Dismiss notification">Dismiss</button></div>` : ""}${busy ? `<div role="status" class="notice busy">${e(busyText)}${currentAbort ? '<button id="cancel-device" class="ghost">Cancel operation</button>' : ""}</div>` : ""}${page === "overview" ? overview(b) : page === "receive" ? receive() : page === "send" ? send(active) : activity()}<footer class="footer"><span>Public data only. Never enter recovery words or private keys.</span><span>Empty-tree BIP86 · PRL protocol v1</span></footer></main></div>`;
  bind();
}
function lightCard() {
  if (!account || !["mainnet", "testnet2"].includes(network)) return "";
  return `<section class="card"><p class="eyebrow">No local full node required</p><h2>Public light sync</h2><p class="hint">Discover balances and transaction history through Pearl’s ${network === "mainnet" ? "blockbook.pearlresearch.ai" : "blockbook.testnet.pearlresearch.ai"} service over HTTPS. The operator can link queried addresses and your IP. Public account keys stay in this local app.</p><label class="check"><input id="privacy-consent" type="checkbox" ${privacyConsent ? "checked" : ""} ${disabled(busy)}>I allow this session to query my receive/change addresses and transaction IDs with this public service and trust its chain view.</label><button id="sync-public" ${disabled(busy || !privacyConsent)}>${syncComplete ? "Resync account & history" : "Discover watch account"}</button><p class="hint">Both branches · gap 20 · bounded recovery scan. No recovery words. Current limit: index 999 per branch, 2,000 history transactions and 256 UTXOs. Limit exhaustion is reported as incomplete.</p></section>`;
}
function paymentStatus(payment: PaymentRecord): string {
  if (payment.archived)
    return `archived: confirmed at block ${payment.archived.block.height} (locks retained)`;
  if (!payment.txid) return payment.state;
  const tx = history.find((h) => h.txid === payment.txid);
  return tx?.state === "confirmed"
    ? `confirmed (${snapshot ? Math.max(0, snapshot.tip.height - tx.block!.height + 1) : "?"})`
    : tx?.state === "detached"
      ? "detached / conflicted; review required"
      : payment.state === "accepted"
        ? "previously accepted; current confirmation unverified"
        : payment.state;
}
function historyCard(): string {
  if (!history.length) return "";
  return `<section class="card"><h2>Discovered transaction history</h2><p class="hint">Rebuilt from the public source on each explicit resync. Detached records stay visible. Node/indexer acceptance is not confirmation.</p>${history
    .slice()
    .sort(
      (a, b) =>
        (b.block?.height ?? Number.MAX_SAFE_INTEGER) -
        (a.block?.height ?? Number.MAX_SAFE_INTEGER),
    )
    .map(
      (h) =>
        `<div class="journal-item"><div class="row"><b class="small">${e(h.state)}${h.block ? ` · block ${h.block.height}` : ""}</b><span class="small">Received ${money(h.received)} / spent ${money(h.spent)}</span></div><p class="mono">${e(h.txid)}</p></div>`,
    )
    .join("")}</section>`;
}
async function syncPublic() {
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
  const result = record(
    await post("/api/light/discover", {
      network,
      consent: true,
      account: accountToJson(account),
      minimumIndex,
    }),
    "discovery response",
  );
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
  await store.mutate(owner, (j) => {
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
  lastUsed = nextLastUsed;
  snapshot = next;
  history = nextHistory;
  sourceMode = "public";
  syncComplete = true;
  validation = null;
  selected.clear();
  // Fresh input recheck is mandatory before every signature; discovery alone never bypasses it.
  notification = `Public account discovered through block ${next.tip.height}: ${next.coins.length} outputs and ${nextHistory.length} transactions. ${network === "testnet2" ? "This endpoint is testnet2, despite its testnet hostname." : ""}`;
}
function overview(b: ReturnType<typeof balances> | null) {
  return `<div class="grid"><div><section class="card balance-card"><p class="eyebrow">${snapshot ? (syncComplete ? "Discovered eligible balance" : "Imported eligible balance") : "Watch-only balance"}</p><div class="balance">${b ? formatPrl(b.available) : "Data unavailable"}${b ? "<small>PRL</small>" : ""}</div><span class="small">${validation ? "Checked against your authenticated source" : snapshot ? "Imported estimates. Recheck your selected source before spending." : "Load public watch data to view funds. No automatic zero balance."}</span><div class="balance-row"><div><label>Immature mining</label>${b ? e(formatPrl(b.immature)) : "—"}</div><div><label>Reserved</label>${b ? e(formatPrl(b.reserved)) : "—"}</div><div><label>Unconfirmed</label>${b ? e(formatPrl(b.pending)) : "—"}</div></div></section><section class="card"><div class="section-head"><h2>Public account</h2><span class="tag">${client?.sessionState === "ready" ? "Device connected" : "Watch only"}</span></div><div class="inline-fields"><div class="field"><label for="network">Network</label><select id="network" ${disabled(busy || !!account)}>${Object.keys(
    NETWORKS,
  )
    .map((n) => `<option ${network === n ? "selected" : ""}>${n}</option>`)
    .join(
      "",
    )}</select></div><div class="field"><label for="account-index">Account index</label><input id="account-index" type="number" min="0" max="2147483647" value="${accountIndex}" ${disabled(busy || !!account)}></div></div>${account ? `<dl class="data-list"><div><dt>Derivation</dt><dd class="mono">${e(deriveAddress(account, 0, 0).path.replace("/0/0", ""))}</dd></div><div><dt>Fingerprint</dt><dd class="mono">${hex(account.masterFingerprint)}</dd></div><div><dt>Public key</dt><dd class="mono">${hex(account.publicKey)}</dd></div></dl><div class="actions"><button id="backup-export" class="secondary" ${disabled(busy)}>Back up full watch wallet</button><button id="export-public" class="secondary" ${disabled(busy)}>Export public recovery record</button><button id="save-cache" class="secondary" ${disabled(busy || !snapshot)}>Save watch data locally</button><button id="disconnect" class="ghost" ${disabled(busy)}>Close account</button></div><p class="hint">Saving exposes public addresses and balances to anyone using this browser profile. Payment reservations are always kept locally to prevent accidental reuse.</p>` : `<div class="empty"><div class="symbol" aria-hidden="true">◇</div><h3>Start with your Ledger</h3><p>Open the matching Pearl app, then connect and approve the public account export. Your device stays in charge of every signature.</p><button id="connect-inline" ${disabled(busy)}>Connect Ledger</button></div>`}</section>${snapshot ? `<section class="card"><div class="section-head"><h2>${syncComplete ? "Synced watch account" : "Watch data"}</h2><span class="tag ${validation ? "ok" : "warn"}">${validation ? (sourceMode === "public" ? "HTTPS indexer checked" : "Node checked") : "Chain metadata unverified"}</span></div><dl class="data-list"><div><dt>Snapshot block</dt><dd>${snapshot.tip.height}<br><span class="mono">${snapshot.tip.hash}</span></dd></div><div><dt>Address coverage</dt><dd>Receive 0–${snapshot.coverage.externalScannedThrough}; change 0–${snapshot.coverage.changeScannedThrough}; gap ${snapshot.coverage.gapLimit}</dd></div><div><dt>Outputs</dt><dd>${snapshot.coins.length} · ${money(b!.total)} observed total</dd></div></dl><p class="hint">${syncComplete ? "Scanned both branches through a gap of 20 unused addresses. This trusts the selected indexer and is not SPV." : "Imported data is not a complete scan or proof of chain inclusion."} Coinbase outputs need 100 confirmations. Reorgs invalidate detached outputs; reserved inputs remain locked.</p><button id="check-node" class="secondary" ${disabled(busy)}>Refresh input status</button></section>` : ""}</div><div>${lightCard()}<section class="card"><p class="eyebrow">Three deliberate steps</p><h2>Your device is the signer</h2><div class="steps"><div class="step"><span class="number">1</span><div><b>Verify your receive address</b><span class="muted">Compare the full address on your Ledger before using it for payouts.</span></div></div><div class="step"><span class="number">2</span><div><b>Review every detail</b><span class="muted">Choose inputs, recipient, amount, exact fee and derived change.</span></div></div><div class="step"><span class="number">3</span><div><b>Sign, then broadcast</b><span class="muted">Signatures are verified independently. Broadcast is a separate explicit action.</span></div></div></div></section><section class="card"><h2>Import public watch data</h2><p class="hint">Use the documented JSON snapshot format. Raw transactions are parsed locally to check exact grain amounts, transaction IDs and ownership. Never import a seed or private key.</p><div class="field"><label for="backup-file">Complete watch-wallet backup</label><input id="backup-file" type="file" accept="application/json,.json" ${disabled(busy)}><label for="public-file">Public account / range recovery JSON</label><input id="public-file" type="file" accept="application/json,.json" ${disabled(busy)}><label for="snapshot-file">Public snapshot JSON</label><input id="snapshot-file" type="file" accept="application/json,.json" ${disabled(busy)}></div><div class="actions"><button id="restore-cache" class="secondary" ${disabled(busy)}>Restore saved data</button><button id="load-demo" class="ghost" ${disabled(busy)}>Explore public example</button></div></section><section class="card"><h2>Browser support</h2><p class="hint">Ledger connection uses current DMK + WebHID. Desktop Chrome / Edge on localhost or HTTPS are the intended test targets. Mobile, Safari and Firefox are not qualified.</p><p class="hint">${window.isSecureContext && "hid" in navigator ? "WebHID is available in this browser." : "WebHID is unavailable here. Public watch data remains viewable."}</p></section></div></div>`;
}
function receive() {
  if (!account)
    return `<section class="card empty"><h2>Connect a public account first</h2><p>Receive addresses must be derived from the device-approved account.</p><button data-nav="overview">Go to account</button></section>`;
  const derived = deriveAddress(account, 0, receiveIndex);
  return `<div class="grid"><section class="card"><div class="section-head"><h2>Receive address</h2><span class="tag ${verifiedReceive === derived.address ? "ok" : "warn"}">${verifiedReceive === derived.address ? "Verified on device" : "Not device verified"}</span></div><div class="field"><label for="receive-index">Receive index</label><input id="receive-index" type="number" min="0" max="${Math.min(979, journal.issuedReceiveThrough + 1)}" value="${receiveIndex}" ${disabled(busy)}></div><p class="mono muted">${e(derived.path)}</p>${receiveIndex > Math.min(979, journal.issuedReceiveThrough + 1) ? '<div class="notice error">This address is outside the saved consecutive recovery range. Use the next receive index, or restore a public recovery record. The bounded companion supports issued indexes 0–979.</div>' : ""}<div class="address">${e(derived.address)}</div><div class="actions"><button id="verify-receive" ${disabled(busy || client?.sessionState !== "ready" || receiveIndex > Math.min(979, journal.issuedReceiveThrough + 1))}>Verify on Ledger</button><button id="copy-address" class="secondary" ${disabled(busy || verifiedReceive !== derived.address)}>Copy verified address</button></div><p class="hint">Latest saved receive index: ${journal.issuedReceiveThrough < 0 ? "none" : journal.issuedReceiveThrough}. Export your public recovery record after issuing addresses; it records skipped/unused ranges for a restored browser. Use consecutive receive indexes to preserve gap-limit recovery. Skipping 20 or more unused addresses requires an extended recovery scan. Verify the full address on the Ledger screen. This label is cleared when you change account, address index or device session.</p></section><section class="card"><h2>Mining payouts</h2><p class="hint">A verified public receive address can be used for compatible Pearl miner or pool payouts. Mining stays on your host. Ledger only derives addresses and signs spending transactions.</p><p class="hint">Coinbase rewards remain immature until 100 confirmations. Imported chain metadata alone cannot establish spendability.</p></section></div>`;
}
function send(active: PaymentRecord | undefined) {
  if (active) return review(active);
  if (!snapshot)
    return `<section class="card empty"><h2>Load watch data to prepare a payment</h2><p>Select known public UTXOs, then verify their current status through your local node.</p><button data-nav="overview">Go to account</button></section>`;
  const reserved = reservedOutpoints(journal);
  return `<div class="grid"><section class="card"><h2>1. Choose inputs</h2><p class="hint">Select 1–16 confirmed, mature inputs. Amounts come from raw previous transactions. Input selection links these outputs publicly.</p>${
    snapshot.coins.length
      ? snapshot.coins
          .map((c) => {
            const key = outpoint(c),
              status = reserved.has(key)
                ? "reserved"
                : coinEligibility(c, snapshot!.tip);
            return `<label class="coin"><input type="checkbox" data-coin="${e(key)}" ${selected.has(key) ? "checked" : ""} ${disabled(busy || status !== "eligible")}><span class="coin-info"><span class="mono">${e(key)}</span><span class="muted">${c.coinbase ? "Mining reward" : "Transfer"} · ${confirmations(c, snapshot!.tip)} confirmations · ${status}</span></span><span class="coin-value">${e(formatPrl(c.amount))}<br><span class="muted">PRL</span></span></label>`;
          })
          .join("")
      : '<p class="hint">No outputs in this watch snapshot.</p>'
  }<p class="hint">${selected.size} inputs selected. Balances and confirmations reflect the current imported/node view.</p><button id="check-node" class="secondary" ${disabled(busy)}>Refresh node status</button></section><section class="card"><h2>2. Set the payment</h2><div class="field"><label for="recipient">Recipient P2TR address</label><input id="recipient" value="${e(form.recipient)}" autocomplete="off" spellcheck="false" placeholder="${NETWORKS[network].hrp}1p…" ${disabled(busy)}></div><div class="field"><label for="amount">Amount in PRL</label><input id="amount" value="${e(form.amount)}" inputmode="decimal" placeholder="0.00000000" ${disabled(busy)}></div><div class="field"><label for="fee">Exact total fee in PRL</label><input id="fee" value="${e(form.fee)}" inputmode="decimal" ${disabled(busy)}></div><div class="field"><label for="change-index">Change index (branch 1)</label><input id="change-index" value="${e(form.changeIndex)}" type="number" min="${journal.nextChangeIndex}" max="2147483646" ${disabled(busy)}></div><p class="hint">Remaining value returns to the device-derived change address. Fee is explicit, not a market estimate. Dust under the default policy is rejected.</p><button id="prepare" ${disabled(busy || !selected.size)}>Prepare & reserve inputs</button><p class="hint">Preparation saves public transaction details and input reservations in this browser profile. Signing requires a fresh authenticated node check.</p></section></div>`;
}
function review(payment: PaymentRecord) {
  const bundle = paymentBundle(payment),
    recipient = bundle.outputs.find((o) => o.role === "recipient")!,
    change = bundle.outputs.find((o) => o.role === "change");
  const total = bundle.inputs.reduce((s, i) => s + i.amount, 0n),
    fee = total - bundle.outputs.reduce((s, o) => s + o.amount, 0n);
  const highFee = fee > 100_000n && fee * 10n >= total;
  return `<div class="grid"><section class="card review"><div class="section-head"><h2>Review the exact payment</h2><span class="tag">${e(paymentStatus(payment))}</span></div>${highFee ? '<div class="notice error"><b>Unusually high fee.</b> The fee exceeds 100,000 grains and is at least 10% of the selected input value. Review the fee carefully on the Ledger.</div>' : ""}<dl class="data-list"><div><dt>Network</dt><dd>${bundle.network}</dd></div><div><dt>Recipient</dt><dd class="mono">${scriptToAddress(recipient.scriptPubKey, bundle.network)}</dd></div><div><dt>Amount</dt><dd>${money(recipient.amount)}</dd></div><div><dt>Exact fee</dt><dd>${money(fee)}</dd></div><div><dt>Change</dt><dd>${change ? money(change.amount) : "None"}${change ? `<br><span class="mono">${scriptToAddress(change.scriptPubKey, bundle.network)}</span><br>Branch 1 / index ${change.index}` : ""}</dd></div><div><dt>Inputs</dt><dd>${bundle.inputs.length} reserved outputs</dd></div>${payment.txid ? `<div><dt>Transaction ID</dt><dd class="mono">${payment.txid}</dd></div>` : ""}</dl>${payment.state === "draft" ? `<button id="sign" ${disabled(busy || client?.sessionState !== "ready")}>Review & sign on Ledger</button> <button id="discard" class="ghost" ${disabled(busy)}>Discard unsigned draft</button>` : !payment.archived && ["signed", "broadcast-unknown", "accepted"].includes(payment.state) ? `<div class="notice ${payment.state === "broadcast-unknown" ? "error" : ""}">${payment.state === "signed" ? "Signatures independently verified. Nothing has been broadcast by this app." : payment.state === "accepted" ? "Previously accepted by the node; current confirmation is unverified. An explicit retry sends only these same signed bytes and transaction ID." : "Broadcast outcome may be unknown. This exact transaction may already be accepted. Keep inputs reserved; never construct a replacement payment just because of a timeout."}</div><label class="check"><input id="broadcast-approval" type="checkbox" ${disabled(busy)}>I approve broadcasting these exact signed bytes to ${sourceMode === "public" ? "the public Pearl Blockbook service" : "the configured local node"} on ${bundle.network}.</label><button id="broadcast" disabled>${payment.state !== "signed" ? "Explicitly rebroadcast exact bytes" : "Broadcast signed transaction"}</button>` : payment.archived ? '<div class="notice success">A confirmed receipt is archived. Reconcile its current chain status before retrying these bytes; all input locks remain retained.</div>' : '<div class="notice error">Signing was started. The result may be unknown after an interruption. Inputs remain reserved. Inspect the device and reconcile the transaction before reusing funds.</div>'}</section><section class="card"><h2>Check your Ledger screen</h2><div class="steps"><div class="step"><span class="number">1</span><div><b>Network and full recipient</b><span class="muted">Compare the entire address, not only its first or last characters.</span></div></div><div class="step"><span class="number">2</span><div><b>Amount, fee and change</b><span class="muted">The device recomputes the signing digest from this complete transaction.</span></div></div><div class="step"><span class="number">3</span><div><b>Physical approval</b><span class="muted">Reject if any detail differs. No blind-sign or software-signing fallback exists.</span></div></div></div><button id="back-payments" class="ghost" ${disabled(busy)}>Back to activity</button></section></div>`;
}
function activity() {
  return `<section class="card"><div class="section-head"><h2>Reserved payments</h2><span class="tag">${journal.payments.length} records</span></div><p class="hint">Reservations are shared atomically across this browser's tabs and persist after restart. They do not coordinate separate browser profiles or computers. Signed or interrupted payments never auto-expire. Browser eviction or profile loss can remove this state: export a complete backup before switching profiles.</p><div class="actions"><button id="backup-export" class="secondary" ${disabled(busy || !account)}>Back up full watch wallet</button><button id="reconcile" class="secondary" ${disabled(busy || !account || (sourceMode === "public" && !syncComplete))}>Archive confirmed records</button></div><p class="hint">Archival requires six confirmations in a completed source view. Archived exact bytes and outpoint locks are retained through reorgs; they no longer count against the 100-active-payment limit. Conflicted/unknown records remain reserved.</p>${
    journal.payments.length
      ? journal.payments
          .slice()
          .reverse()
          .map(
            (p) =>
              `<div class="journal-item"><div class="row"><div><b class="small">${e(paymentStatus(p))}</b><p class="hint">${p.outpoints.length} inputs · ${e(new Date(p.createdAt).toLocaleString())}</p></div><button data-payment="${e(p.id)}" class="secondary" ${disabled(busy)}>Review</button></div>${p.txid ? `<p class="mono">${e(p.txid)}</p>` : ""}</div>`,
          )
          .join("")
      : '<div class="empty"><div class="symbol">≋</div><h3>No prepared payments yet</h3><p>Transactions appear here after you reserve inputs, before a signature is requested.</p></div>'
  }</section>${historyCard()}`;
}
function bind() {
  const click = (id: string, fn: () => void) =>
    document.getElementById(id)?.addEventListener("click", fn);
  document.querySelectorAll<HTMLButtonElement>("[data-nav]").forEach(
    (el) =>
      (el.onclick = () => {
        if (!busy) {
          page = el.dataset.nav as typeof page;
          activePayment = null;
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
  click(
    "sync-public",
    () =>
      void run(
        "Discovering public addresses and checking exact transactions. This can take a minute.",
        syncPublic,
      ),
  );
  document.getElementById("public-file")?.addEventListener(
    "change",
    (event) =>
      void run("Loading public account only", async () => {
        const file = (event.target as HTMLInputElement).files?.[0];
        if (!file) return;
        assert(file.size < 4096, "Public account file too large");
        const recovery = importPublicRecovery(await file.text()),
          a = recovery.account;
        await transport?.close();
        transport = null;
        client = null;
        account = a;
        network = a.network;
        accountIndex = a.account;
        snapshot = null;
        validation = null;
        syncComplete = false;
        history = [];
        lastUsed = [-1, -1];
        privacyConsent = false;
        verifiedReceive = null;
        activePayment = null;
        selected.clear();
        await store.mutate(accountId(a), (j) => {
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
        await refreshJournal();
        notification =
          "Public account loaded. Approve public address disclosure to discover balances, or connect the matching Ledger.";
      }),
  );
  click(
    "backup-export",
    () =>
      void run("Exporting the latest watch-wallet backup", async () => {
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
      void run(
        "Validating and merging complete public wallet backup",
        async () => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (!file) return;
          assert(file.size <= MAX_BACKUP_BYTES, "Backup exceeds 16 MiB");
          const backup = importWalletBackup(await file.text());
          await store.mutate(accountId(backup.account), (j) =>
            mergeRestoredJournal(j, backup.journal),
          );
          await transport?.close();
          transport = null;
          client = null;
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
          channel.postMessage("journal");
          notification =
            "Complete watch backup merged. Reservations and exact signed bytes restored; prior verification, consent and archival claims require fresh checks.";
        },
      ),
  );
  click(
    "reconcile",
    () =>
      void run(
        "Archiving confirmed payments without releasing locks",
        async (signal) => {
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
        },
      ),
  );
  click("dismiss", () => {
    notification = "";
    render();
  });
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
      void run(
        "Checking raw previous transactions and public ownership",
        async () => {
          const file = (event.target as HTMLInputElement).files?.[0];
          if (!file) return;
          assert(file.size <= 4 * 1024 * 1024, "Snapshot exceeds 4 MiB");
          await importSnapshot(await file.text());
          notification =
            "Imported public outputs. Chain and completeness claims remain unverified until checked against your source.";
        },
      ),
  );
  click(
    "load-demo",
    () =>
      void run("Loading public example", async () => {
        const response = await fetch("/example-watch.json");
        assert(response.ok, "Example unavailable");
        await importSnapshot(await readBoundedText(response, 4 * 1024 * 1024));
        notification =
          "Public synthetic example loaded. These outputs are not real funds and cannot pass a real node check.";
      }),
  );
  click(
    "restore-cache",
    () =>
      void run("Restoring public watch data", async () => {
        const text = await store.load<string>("last-snapshot");
        assert(text, "No locally saved watch data");
        await importSnapshot(text);
        notification =
          "Restored public watch data. Device verification and node freshness have been cleared.";
      }),
  );
  click(
    "save-cache",
    () =>
      void run("Saving public watch data", async () => {
        assert(snapshot, "No snapshot");
        await store.save("last-snapshot", snapshotToJson(snapshot));
        notification =
          "Public watch data saved in this browser profile. No signing keys are stored.";
      }),
  );
  click(
    "export-public",
    () =>
      void run("Exporting the latest public recovery record", async () => {
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
    "verify-receive",
    () =>
      void run("Approve the receive address on your Ledger", async (signal) => {
        assert(client && account, "Connect your Ledger");
        assert(
          receiveIndex <= Math.min(979, journal.issuedReceiveThrough + 1),
          "Receive index outside saved recovery range",
        );
        const expected = deriveAddress(account, 0, receiveIndex).address;
        signal.throwIfAborted();
        const returned = await client.verifyAddress(
          account,
          0,
          receiveIndex,
          signal,
        );
        signal.throwIfAborted();
        assert(
          returned === expected,
          "Ledger address does not match the public account",
        );
        await store.mutate(accountId(account), (j) =>
          recordVerifiedReceive(j, receiveIndex),
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
  click(
    "check-node",
    () =>
      void run(
        "Checking chain identity and current inputs with your local node",
        checkNode,
      ),
  );
  for (const [id, key] of [
    ["recipient", "recipient"],
    ["amount", "amount"],
    ["fee", "fee"],
    ["change-index", "changeIndex"],
  ] as const)
    document.getElementById(id)?.addEventListener("input", (event) => {
      form[key] = (event.target as HTMLInputElement).value;
    });
  document.querySelectorAll<HTMLInputElement>("[data-coin]").forEach(
    (el) =>
      (el.onchange = () => {
        el.checked
          ? selected.add(el.dataset.coin!)
          : selected.delete(el.dataset.coin!);
        render();
      }),
  );
  click(
    "prepare",
    () =>
      void run("Atomically reserving selected inputs", async () => {
        assert(snapshot && account, "Load account");
        if (sourceMode === "public")
          assert(
            Number(form.changeIndex) < 980,
            "Change index is outside light recovery bounds",
          );
        const id = crypto.randomUUID();
        await store.mutate(accountId(account), (j) => {
          const bundle = preparePayment(
            snapshot!,
            {
              selected: [...selected],
              recipient: form.recipient.trim(),
              amountPrl: form.amount,
              feePrl: form.fee,
              changeIndex: Number(form.changeIndex),
            },
            reservedOutpoints(j),
          );
          reservePayment(j, bundle, id);
        });
        activePayment = id;
        channel.postMessage("journal");
        notification =
          "Unsigned payment prepared. Inputs are reserved across this browser’s sessions.";
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
  click(
    "sign",
    () => void run("Rechecking inputs, then review on Ledger", sign),
  );
  click("cancel-device", () => currentAbort?.abort());
  document
    .getElementById("broadcast-approval")
    ?.addEventListener("change", (event) => {
      const button = document.getElementById("broadcast") as HTMLButtonElement;
      button.disabled = busy || !(event.target as HTMLInputElement).checked;
    });
  click(
    "broadcast",
    () => void run("Broadcasting the exact signed transaction", broadcast),
  );
  click("back-payments", () => {
    activePayment = null;
    page = "activity";
    render();
  });
}
async function importSnapshot(text: string) {
  const imported = parseWatchSnapshot(text);
  await store.mutate(accountId(imported.account), (j) =>
    recordRecoveryPaths(j, imported.coins),
  );
  channel.postMessage("journal");
  if (account && accountId(account) !== accountId(imported.account)) {
    await transport?.close();
    transport = null;
    client = null;
  }
  syncComplete = false;
  sourceMode = "node";
  history = [];
  lastUsed = [-1, -1];
  privacyConsent = false;
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
  const connecting = connectLedger(() => {
    verifiedReceive = null;
    client = null;
    currentAbort?.abort();
    notification =
      "Ledger disconnected. Reconnect before continuing; existing payment reservations remain locked.";
    notificationType = "error";
    render();
  });
  await run(
    "Choose your Ledger, open Pearl, and approve the public account export",
    async (signal) => {
      await transport?.close();
      transport = null;
      client = null;
      verifiedReceive = null;
      const connected = await connecting;
      try {
        signal.throwIfAborted();
        transport = connected;
        client = new LedgerPearlClient(connected, network);
        render();
        const capabilities = await client.capabilities(signal);
        signal.throwIfAborted();
        assert(
          capabilities.protocol === 1 && capabilities.network === network,
          "Wrong Pearl app/network",
        );
        const exported = await client.exportAccount(accountIndex, signal);
        signal.throwIfAborted();
        if (account && accountId(account) !== accountId(exported)) {
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
        notification = `Pearl ${capabilities.version} connected. Public account ${exported.account} approved on the device.`;
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
async function sign(signal: AbortSignal) {
  assert(
    client && account && snapshot && activePayment,
    "Connect Ledger and prepare a payment",
  );
  signal.throwIfAborted();
  let payment = (await store.journal(accountId(account))).payments.find(
    (p) => p.id === activePayment,
  );
  signal.throwIfAborted();
  assert(
    payment?.state === "draft",
    "Only a fresh unsigned draft may be signed",
  );
  const bundle = paymentBundle(payment);
  await checkNode();
  signal.throwIfAborted();
  requireFreshValidation(snapshot, validation, bundle);
  await store.mutate(accountId(account), (j) => {
    signal.throwIfAborted();
    transitionPayment(j, activePayment!, "signing");
  });
  signal.throwIfAborted();
  await refreshJournal();
  signal.throwIfAborted();
  channel.postMessage("journal");
  busyText = "Check network, recipient, amount, fee and change on your Ledger";
  render();
  let result;
  try {
    result = await client.signBundle(bundle, account, {
      signal,
    });
  } catch (error) {
    if (
      error instanceof DeviceError &&
      error.status === 0x6985 &&
      error.instruction === INS.REVIEW
    ) {
      await store.mutate(accountId(account), (j) =>
        rejectBeforeSigning(j, activePayment!),
      );
      channel.postMessage("journal");
      throw new Error(
        "Payment rejected on the Ledger before signing. The unsigned draft remains reserved; discard it or reconnect to review again.",
      );
    }
    throw error;
  }
  // Once signatures have returned, cancellation must not discard exact signed
  // bytes or release reservations. Complete verification and durable storage.
  // The SDK verified every Schnorr signature; re-run finalization before persistence too.
  const checked = finalizeTransaction(bundle, result.signatures);
  assert(
    checked.rawTx === result.rawTx && checked.txid === result.txid,
    "Final transaction mismatch",
  );
  await store.mutate(accountId(account), (j) =>
    transitionPayment(j, activePayment!, "signed", {
      rawTx: checked.rawTx,
      txid: checked.txid,
    }),
  );
  channel.postMessage("journal");
  notification =
    "Signatures independently verified and exact signed bytes saved. Broadcast requires a separate approval.";
}
/** Recheck known local-node payments without claiming a complete account scan. */
async function reconcileNodePayments(signal: AbortSignal) {
  assert(account, "Load a public account first");
  const owner = account,
    id = accountId(owner);
  const operation = AbortSignal.any([signal, AbortSignal.timeout(80_000)]);
  const deadline = performance.now() + 80_000;
  const checkBudget = () => {
    operation.throwIfAborted();
    assert(
      performance.now() < deadline,
      "Reconciliation deadline exceeded; journal unchanged",
    );
  };
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
    // Yield during large local verification passes so Cancel and the overall
    // deadline remain observable before any node request.
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
          confirmations > 0 && confirmations === tip.height - block.height + 1,
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
          confirmations >= 6 && confirmations === tip.height - block.height + 1,
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
}
async function broadcast(
  signal: AbortSignal | undefined = currentAbort?.signal,
) {
  assert(account && activePayment, "No signed payment");
  const owner = account,
    ownerId = accountId(owner),
    paymentId = activePayment;
  assert(
    network === owner.network,
    "Selected broadcast network differs from account",
  );
  signal?.throwIfAborted();
  const payment = (await store.journal(ownerId)).payments.find(
    (p) => p.id === paymentId,
  );
  signal?.throwIfAborted();
  assert(
    payment &&
      ["signed", "broadcast-unknown", "accepted"].includes(payment.state) &&
      payment.rawTx &&
      payment.txid,
    "No verified signed transaction",
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
    signal?.throwIfAborted();
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
  signal?.throwIfAborted();
  channel.postMessage("journal");
  const payload = {
    bundleHex: payment.bundleHex,
    rawTx: payment.rawTx,
    expectedTxid: payment.txid,
  };
  const result = await post(
    sourceMode === "public" ? "/api/light/broadcast" : "/api/broadcast",
    sourceMode === "public"
      ? { network: owner.network, consent: privacyConsent, payment: payload }
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
window.addEventListener("beforeunload", () => {
  currentAbort?.abort();
  void transport?.close();
});
render();
