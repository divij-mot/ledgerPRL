import {
  type AccountPublicKey,
  type NetworkName,
  type SigningBundle,
  accountFromJson,
  accountToJson,
  deriveAddress,
  addressToScript,
  parseTransaction,
  NETWORKS,
  checkedIndex,
  assert,
  equal,
  hex,
  fromHex,
  sha256,
  MAX_GRAINS,
  sumGrains,
  parsePrl,
  validateBundle,
} from "@pearl-ledger/sdk";

import {
  assertPaymentPolicy,
  inspectPaymentPolicy,
  DEFAULT_RELAY_POLICY,
  type RelayPolicy,
} from "./policy.js";

export const COINBASE_MATURITY = 100;
export const MIN_CONFIRMATIONS = 1;
export { DEFAULT_DUST_GRAINS } from "./policy.js";
export const MAX_WATCH_COINS = 256;
export const MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024;
export interface ChainTip {
  height: number;
  hash: string;
}
export interface Coverage {
  externalScannedThrough: number;
  changeScannedThrough: number;
  gapLimit: number;
}
export interface WatchCoin {
  txid: string;
  vout: number;
  amount: bigint;
  scriptPubKey: Uint8Array;
  rawTransaction: string;
  branch: 0 | 1;
  index: number;
  block: ChainTip | null;
  coinbase: boolean;
}
export interface WatchSnapshot {
  schema: 1;
  account: AccountPublicKey;
  genesisHash: string;
  tip: ChainTip;
  coverage: Coverage;
  coins: WatchCoin[];
}
export function record(value: unknown, label: string): Record<string, unknown> {
  assert(
    value !== null && typeof value === "object" && !Array.isArray(value),
    `Invalid ${label}`,
  );
  return value as Record<string, unknown>;
}
export function exactKeys(
  value: Record<string, unknown>,
  names: string[],
  label: string,
) {
  assert(
    Object.keys(value).length === names.length &&
      names.every((k) => Object.hasOwn(value, k)),
    `Unexpected or missing ${label} field`,
  );
}
export function hash(value: unknown): string {
  assert(
    typeof value === "string" && /^[0-9a-f]{64}$/.test(value),
    "Expected lowercase 32-byte hash",
  );
  return value;
}
export function safeInteger(value: unknown, max = 0xffffffff): number {
  assert(
    typeof value === "number" &&
      Number.isSafeInteger(value) &&
      value >= 0 &&
      value <= max,
    "Expected bounded nonnegative integer",
  );
  return value;
}
export function chainTip(value: unknown): ChainTip {
  const v = record(value, "chain tip");
  exactKeys(v, ["height", "hash"], "chain tip");
  return { height: safeInteger(v.height), hash: hash(v.hash) };
}
export function accountId(a: AccountPublicKey): string {
  return `${a.network}:${a.account}:${hex(sha256(new TextEncoder().encode(JSON.stringify(accountToJson(a)))))}`;
}
export function outpoint(c: Pick<WatchCoin, "txid" | "vout">): string {
  return `${c.txid}:${c.vout}`;
}
export function parseWatchSnapshot(text: string): WatchSnapshot {
  assert(
    typeof text === "string" &&
      new TextEncoder().encode(text).length <= MAX_SNAPSHOT_BYTES,
    "Snapshot exceeds 4 MiB",
  );
  const v = record(JSON.parse(text), "snapshot");
  exactKeys(
    v,
    ["schema", "account", "genesisHash", "tip", "coverage", "coins"],
    "snapshot",
  );
  assert(v.schema === 1, "Unsupported snapshot schema");
  const a = record(v.account, "public account");
  exactKeys(
    a,
    ["network", "account", "masterFingerprint", "publicKey", "chainCode"],
    "public account",
  );
  const account = accountFromJson(a);
  assert(
    v.genesisHash === NETWORKS[account.network].genesisHash,
    "Snapshot genesis does not match network",
  );
  const tip = chainTip(v.tip),
    c = record(v.coverage, "coverage");
  exactKeys(
    c,
    ["externalScannedThrough", "changeScannedThrough", "gapLimit"],
    "coverage",
  );
  const coverage = {
    externalScannedThrough: safeInteger(c.externalScannedThrough, 0x7fffffff),
    changeScannedThrough: safeInteger(c.changeScannedThrough, 0x7fffffff),
    gapLimit: safeInteger(c.gapLimit, 1000),
  };
  assert(coverage.gapLimit >= 1, "Gap limit must be at least one");
  assert(
    Array.isArray(v.coins) && v.coins.length <= MAX_WATCH_COINS,
    "Expected at most 256 imported UTXOs",
  );
  const seen = new Set<string>();
  const coins = v.coins.map((item): WatchCoin => {
    const u = record(item, "UTXO");
    exactKeys(
      u,
      ["txid", "vout", "rawTransaction", "branch", "index", "block"],
      "UTXO",
    );
    assert(
      typeof u.rawTransaction === "string" &&
        u.rawTransaction.length > 0 &&
        u.rawTransaction.length <= 1_000_000,
      "Raw transaction missing or too large",
    );
    const tx = parseTransaction(u.rawTransaction),
      txid = hash(u.txid),
      vout = safeInteger(u.vout);
    assert(tx.txid === txid, "Raw transaction does not match outpoint txid");
    const prevout = tx.outputs[vout];
    assert(prevout, "Previous output index out of range");
    assert(
      prevout.amount > 0n && prevout.amount <= MAX_GRAINS,
      "Invalid previous output amount",
    );
    assert(u.branch === 0 || u.branch === 1, "Invalid derivation branch");
    const index = checkedIndex(safeInteger(u.index, 0x7fffffff)),
      branch = u.branch;
    assert(
      index <=
        (branch === 0
          ? coverage.externalScannedThrough
          : coverage.changeScannedThrough),
      "UTXO path outside claimed scan coverage",
    );
    assert(
      equal(
        prevout.scriptPubKey,
        deriveAddress(account, branch, index).scriptPubKey,
      ),
      "UTXO is not owned by this public account/path",
    );
    const block = u.block === null ? null : chainTip(u.block);
    assert(
      block === null || block.height <= tip.height,
      "UTXO block is ahead of snapshot tip",
    );
    const coin: WatchCoin = {
      txid,
      vout,
      rawTransaction: u.rawTransaction.toLowerCase(),
      branch,
      index,
      block,
      coinbase: tx.coinbase,
      amount: prevout.amount,
      scriptPubKey: prevout.scriptPubKey,
    };
    assert(!seen.has(outpoint(coin)), "Duplicate UTXO");
    seen.add(outpoint(coin));
    return coin;
  });
  sumGrains(coins.map((u) => u.amount));
  return {
    schema: 1,
    account,
    genesisHash: v.genesisHash as string,
    tip,
    coverage,
    coins,
  };
}
export function snapshotToJson(snapshot: WatchSnapshot): string {
  return JSON.stringify(
    {
      schema: 1,
      account: accountToJson(snapshot.account),
      genesisHash: snapshot.genesisHash,
      tip: snapshot.tip,
      coverage: snapshot.coverage,
      coins: snapshot.coins.map(
        ({ txid, vout, rawTransaction, branch, index, block }) => ({
          txid,
          vout,
          rawTransaction,
          branch,
          index,
          block,
        }),
      ),
    },
    null,
    2,
  );
}
export function confirmations(coin: WatchCoin, tip: ChainTip): number {
  return coin.block && coin.block.height <= tip.height
    ? tip.height - coin.block.height + 1
    : 0;
}
export function coinEligibility(
  coin: WatchCoin,
  tip: ChainTip,
): "immature" | "pending" | "eligible" {
  const count = confirmations(coin, tip);
  if (coin.coinbase && count < COINBASE_MATURITY) return "immature";
  if (count < MIN_CONFIRMATIONS) return "pending";
  return "eligible";
}
export function balances(
  snapshot: WatchSnapshot,
  reserved: ReadonlySet<string> = new Set(),
) {
  const result = {
    total: 0n,
    available: 0n,
    immature: 0n,
    pending: 0n,
    reserved: 0n,
  };
  for (const coin of snapshot.coins) {
    result.total += coin.amount;
    const eligibility = coinEligibility(coin, snapshot.tip);
    if (reserved.has(outpoint(coin))) result.reserved += coin.amount;
    else if (eligibility === "eligible") result.available += coin.amount;
    else result[eligibility] += coin.amount;
  }
  return result;
}
export interface PaymentRequest {
  selected: string[];
  recipient: string;
  amountPrl: string;
  feePrl: string;
  changeIndex: number;
}
function buildPayment(
  snapshot: WatchSnapshot,
  request: PaymentRequest,
  reserved: ReadonlySet<string> = new Set(),
): SigningBundle {
  assert(
    request.selected.length > 0 &&
      request.selected.length <= 16 &&
      new Set(request.selected).size === request.selected.length,
    "Select 1–16 distinct inputs",
  );
  const coins = request.selected.map((id) => {
    const coin = snapshot.coins.find((u) => outpoint(u) === id);
    assert(coin, "Selected UTXO is missing");
    assert(!reserved.has(id), "Selected UTXO is already reserved");
    assert(
      coinEligibility(coin, snapshot.tip) === "eligible",
      "Input is unconfirmed or immature",
    );
    return coin;
  });
  const amount = parsePrl(request.amountPrl),
    fee = parsePrl(request.feePrl);
  const total = sumGrains(coins.map((c) => c.amount));
  assert(amount + fee <= total, "Selected inputs do not cover amount and fee");
  const change = total - amount - fee;
  checkedIndex(request.changeIndex);
  const outputs: SigningBundle["outputs"] = [
    {
      amount,
      scriptPubKey: addressToScript(
        request.recipient,
        snapshot.account.network,
      ),
      role: "recipient",
      branch: 0,
      index: 0,
    },
  ];
  if (change > 0n)
    outputs.push({
      amount: change,
      scriptPubKey: deriveAddress(snapshot.account, 1, request.changeIndex)
        .scriptPubKey,
      role: "change",
      branch: 1,
      index: request.changeIndex,
    });
  const bundle: SigningBundle = {
    network: snapshot.account.network,
    account: snapshot.account.account,
    version: 1,
    lockTime: 0,
    inputs: coins.map((c) => ({
      txid: c.txid,
      vout: c.vout,
      amount: c.amount,
      scriptPubKey: c.scriptPubKey,
      sequence: 0xffffffff,
      branch: c.branch,
      index: c.index,
    })),
    outputs,
  };
  validateBundle(bundle, snapshot.account);
  return bundle;
}
export function previewPaymentPolicy(
  snapshot: WatchSnapshot,
  request: PaymentRequest,
  reserved: ReadonlySet<string> = new Set(),
  policy: RelayPolicy = DEFAULT_RELAY_POLICY,
) {
  return inspectPaymentPolicy(
    buildPayment(snapshot, request, reserved),
    policy,
  );
}
export function preparePayment(
  snapshot: WatchSnapshot,
  request: PaymentRequest,
  reserved: ReadonlySet<string> = new Set(),
  policy: RelayPolicy = DEFAULT_RELAY_POLICY,
): SigningBundle {
  const bundle = buildPayment(snapshot, request, reserved);
  assert(
    assertPaymentPolicy(bundle, policy).fee > 0n,
    "Choose an explicit positive fee",
  );
  return bundle;
}
export interface ValidationCoin {
  outpoint: string;
  state: "unspent" | "spent-or-unknown" | "reorged";
  grains?: string;
  scriptPubKey?: string;
  block?: ChainTip;
  coinbase?: boolean;
  confirmations?: number;
}
export interface ChainValidation {
  network: NetworkName;
  genesisHash: string;
  tip: ChainTip;
  checkedAt: number;
  coins: ValidationCoin[];
}
/** Node evidence is authenticated transport evidence, not an SPV proof. Imported chain metadata is never enough. */
export function applyValidation(
  snapshot: WatchSnapshot,
  value: unknown,
): { snapshot: WatchSnapshot; validation: ChainValidation; removed: number } {
  const v = record(value, "node validation");
  assert(
    v.network === snapshot.account.network &&
      v.genesisHash === NETWORKS[snapshot.account.network].genesisHash,
    "Node network mismatch",
  );
  const tip = chainTip(v.tip);
  const checkedAt = safeInteger(v.checkedAt, Number.MAX_SAFE_INTEGER);
  assert(
    Array.isArray(v.coins) && v.coins.length === snapshot.coins.length,
    "Incomplete node validation",
  );
  const found = new Set<string>();
  const coins: WatchCoin[] = [];
  const validated = v.coins.map((value): ValidationCoin => {
    const item = record(value, "node UTXO");
    assert(
      typeof item.outpoint === "string" && !found.has(item.outpoint),
      "Duplicate node UTXO",
    );
    found.add(item.outpoint);
    const coin = snapshot.coins.find((c) => outpoint(c) === item.outpoint);
    assert(coin, "Unexpected node UTXO");
    assert(
      item.state === "unspent" ||
        item.state === "spent-or-unknown" ||
        item.state === "reorged",
      "Invalid node UTXO status",
    );
    if (item.state !== "unspent")
      return { outpoint: item.outpoint, state: item.state };
    assert(
      item.grains === coin.amount.toString() &&
        item.scriptPubKey === hex(coin.scriptPubKey),
      "Node previous output changed",
    );
    assert(item.coinbase === coin.coinbase, "Node coinbase mismatch");
    const block = chainTip(item.block);
    assert(block.height <= tip.height, "Node block ahead of tip");
    const conf = safeInteger(item.confirmations);
    assert(
      conf === tip.height - block.height + 1,
      "Node confirmation count inconsistent",
    );
    coins.push({ ...coin, block });
    return {
      outpoint: item.outpoint,
      state: "unspent",
      grains: item.grains as string,
      scriptPubKey: item.scriptPubKey as string,
      coinbase: coin.coinbase,
      block,
      confirmations: conf,
    };
  });
  return {
    snapshot: { ...snapshot, tip, coins },
    validation: {
      network: snapshot.account.network,
      genesisHash: snapshot.genesisHash,
      tip,
      checkedAt,
      coins: validated,
    },
    removed: snapshot.coins.length - coins.length,
  };
}
export function requireFreshValidation(
  snapshot: WatchSnapshot,
  validation: ChainValidation | null,
  bundle: SigningBundle,
  now = Date.now(),
): void {
  assert(
    validation &&
      validation.network === bundle.network &&
      validation.genesisHash === snapshot.genesisHash,
    "Check inputs against the authenticated node before signing",
  );
  assert(
    now >= validation.checkedAt && now - validation.checkedAt <= 60_000,
    "Node check expired; refresh inputs before signing",
  );
  assert(
    validation.tip.hash === snapshot.tip.hash &&
      validation.tip.height === snapshot.tip.height,
    "Chain view changed; rebuild the payment",
  );
  for (const input of bundle.inputs) {
    const match = validation.coins.find((c) => c.outpoint === outpoint(input));
    assert(
      match?.state === "unspent" &&
        match.grains === input.amount.toString() &&
        match.scriptPubKey === hex(input.scriptPubKey),
      "Input is spent, stale or not verified by the node",
    );
    assert(
      match.confirmations !== undefined &&
        match.confirmations >=
          (match.coinbase ? COINBASE_MATURITY : MIN_CONFIRMATIONS),
      "Input is not mature/confirmed",
    );
  }
}
