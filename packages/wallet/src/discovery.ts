import {
  assert,
  type AccountPublicKey,
  deriveAddress,
  hex,
  parseTransaction,
  NETWORKS,
  sumGrains,
} from "@pearl-ledger/sdk";
import {
  type ChainTip,
  type WatchCoin,
  type WatchSnapshot,
  type ChainValidation,
  type ValidationCoin,
  chainTip,
  hash,
  outpoint,
  MAX_WATCH_COINS,
  safeInteger,
} from "./watch.js";
export const DISCOVERY_GAP = 20;
export const MAX_DISCOVERY_INDEX = 999;
export const MAX_HISTORY_TRANSACTIONS = 2000;
export const MAX_RAW_HISTORY_HEX = 3 * 1024 * 1024;
export const MAX_HISTORY_REFERENCES = 20_000;
export interface AddressActivity {
  used: boolean;
  confirmedTxCount: number;
  pendingTxCount: number;
  txids: string[];
  utxos: { txid: string; vout: number; height: number | null }[];
}
export interface PublicTransaction {
  confirmations: number;
  rawTransaction: string;
  block: ChainTip | null;
}
export interface WatchSource {
  network: AccountPublicKey["network"];
  tip(): Promise<{ tip: ChainTip; genesisHash: string }>;
  address(address: string): Promise<AddressActivity>;
  transaction(txid: string): Promise<PublicTransaction>;
  blockHash(height: number): Promise<string>;
}
export interface HistoryEntry {
  txid: string;
  received: bigint;
  spent: bigint;
  block: ChainTip | null;
  state: "pending" | "confirmed" | "detached";
}
export interface DiscoveryResult {
  snapshot: WatchSnapshot;
  validation: ChainValidation;
  history: HistoryEntry[];
  complete: true;
  sourceTip: ChainTip;
  lastUsed: [number, number];
}
export interface DiscoveryOptions {
  minimumIndex?: [number, number];
  previousHistory?: HistoryEntry[];
  onProgress?: (message: string) => void;
}
/**
 * Complete bounded address-index scan through a gap of 20 unused addresses on both branches.
 * This trusts the authenticated source's chain/index and is not SPV. Limits fail closed.
 * Every refresh re-reads address history and rebuilds UTXOs, so a checkpoint never hides reorgs.
 */
export async function discoverAccount(
  source: WatchSource,
  account: AccountPublicKey,
  options: DiscoveryOptions = {},
): Promise<DiscoveryResult> {
  assert(
    source.network === account.network,
    "Discovery source network mismatch",
  );
  const start = await source.tip();
  assert(
    start.genesisHash === NETWORKS[account.network].genesisHash,
    "Discovery source genesis mismatch",
  );
  const scripts = new Map<string, { branch: 0 | 1; index: number }>(),
    txids = new Set<string>();
  const addressHistories: {
    script: string;
    activity: AddressActivity;
  }[] = [];
  let historyReferences = 0,
    rawHistoryBytes = 0;
  const candidates = new Map<
    string,
    {
      txid: string;
      vout: number;
      height: number | null;
      branch: 0 | 1;
      index: number;
    }
  >();
  const lastUsed: [number, number] = [-1, -1],
    scanned: [number, number] = [-1, -1];
  for (const branch of [0, 1] as const) {
    const minimum = options.minimumIndex?.[branch] ?? -1;
    assert(
      Number.isInteger(minimum) &&
        minimum >= -1 &&
        minimum + DISCOVERY_GAP <= MAX_DISCOVERY_INDEX,
      "Discovery limit reached; account recovery needs an extended scan",
    );
    let target = Math.max(DISCOVERY_GAP - 1, minimum + DISCOVERY_GAP),
      index = 0;
    while (index <= target) {
      assert(
        target <= MAX_DISCOVERY_INDEX,
        "Address discovery exceeded index 999; results are incomplete",
      );
      // Small parallel batches avoid hammering an indexer; each address request is independently bounded.
      const batch = Array.from(
        { length: Math.min(5, target - index + 1) },
        (_, i) => index + i,
      );
      const results = await Promise.all(
        batch.map(async (i) => {
          const derived = deriveAddress(account, branch, i);
          const script = hex(derived.scriptPubKey);
          scripts.set(script, { branch, index: i });
          return {
            index: i,
            script,
            activity: await source.address(derived.address),
          };
        }),
      );
      for (const { index: i, script, activity } of results) {
        safeInteger(activity.confirmedTxCount);
        safeInteger(activity.pendingTxCount);
        historyReferences += activity.txids.length;
        assert(
          historyReferences <= MAX_HISTORY_REFERENCES,
          "Aggregate address history exceeds safe scan budget",
        );
        addressHistories.push({ script, activity });
        assert(
          typeof activity.used === "boolean" &&
            Array.isArray(activity.txids) &&
            Array.isArray(activity.utxos),
          "Malformed address activity",
        );
        const addressTxids = new Set(activity.txids);
        assert(
          addressTxids.size === activity.txids.length &&
            activity.used === (activity.txids.length > 0),
          "Address usage contradicts its transaction history",
        );
        if (activity.used) {
          lastUsed[branch] = i;
          target = Math.max(target, i + DISCOVERY_GAP);
        }
        assert(
          !activity.utxos.length || activity.used,
          "Source reports outputs for an unused address",
        );
        for (const txid of activity.txids) {
          txids.add(hash(txid));
          assert(
            txids.size <= MAX_HISTORY_TRANSACTIONS,
            "History exceeds 2000 transactions; discovery is incomplete",
          );
        }
        for (const u of activity.utxos) {
          hash(u.txid);
          assert(
            addressTxids.has(u.txid),
            "Indexer UTXO is missing from its address history; retry discovery",
          );
          safeInteger(u.vout);
          if (u.height !== null) safeInteger(u.height);
          const key = outpoint(u);
          assert(!candidates.has(key), "Indexer returned a duplicate UTXO");
          candidates.set(key, { ...u, branch, index: i });
          txids.add(u.txid);
          assert(
            candidates.size <= MAX_WATCH_COINS,
            "More than 256 unspent outputs; use an extended wallet indexer",
          );
        }
        scanned[branch] = i;
      }
      index += batch.length;
      options.onProgress?.(
        `Scanned ${branch === 0 ? "receive" : "change"} addresses 0–${scanned[branch]}`,
      );
    }
  }
  assert(
    txids.size <= MAX_HISTORY_TRANSACTIONS,
    "History limit reached; discovery is incomplete",
  );
  const transactions = new Map<
    string,
    {
      parsed: ReturnType<typeof parseTransaction>;
      block: ChainTip | null;
      rawTransaction: string;
    }
  >();
  for (const txid of txids) {
    const data = await source.transaction(txid);
    rawHistoryBytes += data.rawTransaction.length;
    assert(
      rawHistoryBytes <= MAX_RAW_HISTORY_HEX,
      "Aggregate raw transaction scan exceeds 3 MiB; incomplete result",
    );
    assert(
      data.rawTransaction.length <= 1_000_000,
      "Raw transaction too large",
    );
    const parsed = parseTransaction(data.rawTransaction);
    assert(parsed.txid === txid, "Indexer raw transaction ID mismatch");
    const block = data.block === null ? null : chainTip(data.block);
    assert(
      block !== null || data.confirmations === 0,
      "Pending transaction has confirmed count",
    );
    if (block) {
      assert(
        data.confirmations === start.tip.height - block.height + 1,
        "Transaction confirmation count contradicts scan tip",
      );
      assert(
        block.height <= start.tip.height,
        "History is ahead of the scan tip; retry",
      );
      assert(
        (await source.blockHash(block.height)) === block.hash,
        "Detached history block; retry discovery",
      );
    }
    transactions.set(txid, {
      parsed,
      block,
      rawTransaction: data.rawTransaction,
    });
  }
  // Bind each history claim to the queried script, not merely to some address
  // in the account. Unknown external prevouts need no additional lookup when
  // the transaction directly creates a watched output. Zero-valued matching
  // outputs still establish address usage, but never become spendable coins.
  const involvedScripts = new Map<string, Set<string>>();
  for (const [txid, tx] of transactions) {
    const involved = new Set<string>();
    for (const output of tx.parsed.outputs) {
      const script = hex(output.scriptPubKey);
      if (scripts.has(script)) involved.add(script);
    }
    for (const input of tx.parsed.inputs) {
      const previous = transactions.get(input.txid)?.parsed.outputs[input.vout];
      if (previous) {
        const script = hex(previous.scriptPubKey);
        if (scripts.has(script)) involved.add(script);
      }
    }
    involvedScripts.set(txid, involved);
  }
  for (const { script, activity } of addressHistories) {
    let confirmed = 0,
      pending = 0;
    for (const id of activity.txids) {
      const tx = transactions.get(id);
      assert(tx, "Missing address history transaction");
      assert(
        involvedScripts.get(id)!.has(script),
        "Indexer history transaction does not involve the queried address",
      );
      tx.block ? confirmed++ : pending++;
    }
    assert(
      confirmed === activity.confirmedTxCount &&
        pending === activity.pendingTxCount,
      "Address confirmed/pending counts contradict raw transaction history",
    );
  }
  const spentByHistory = new Set<string>();
  for (const tx of transactions.values())
    for (const input of tx.parsed.inputs) spentByHistory.add(outpoint(input));
  // Detect contradictions within the supplied view. Do not infer spendable
  // coins from history, authenticate inclusion, or assume a complete mempool.
  // A parsed pending spend overrides an omitted/stale confirmed UTXO, and
  // pending outputs are not required to appear in an endpoint's UTXO view.
  for (const [txid, tx] of transactions) {
    if (!tx.block) continue;
    tx.parsed.outputs.forEach((output, vout) => {
      if (output.amount <= 0n || !scripts.has(hex(output.scriptPubKey))) return;
      const point = outpoint({ txid, vout });
      assert(
        spentByHistory.has(point) || candidates.has(point),
        "Confirmed owned output is missing from the UTXO view without a supplied spend; retry discovery",
      );
    });
  }
  const coins: WatchCoin[] = [];
  for (const u of candidates.values()) {
    // A stale UTXO endpoint must never override a parsed pending or confirmed spend.
    if (spentByHistory.has(outpoint(u))) continue;
    const tx = transactions.get(u.txid)!;
    assert(tx, "Missing previous transaction");
    const output = tx.parsed.outputs[u.vout];
    assert(output, "UTXO index outside raw transaction");
    assert(
      hex(output.scriptPubKey) ===
        hex(deriveAddress(account, u.branch, u.index).scriptPubKey),
      "Indexer UTXO ownership mismatch",
    );
    assert(
      (tx.block?.height ?? null) === u.height,
      "Indexer UTXO block height mismatch",
    );
    // A remaining unspent candidate can legitimately have zero value and mark
    // an address as used. Its path/height must match, but it is not selectable.
    if (output.amount === 0n) continue;
    coins.push({
      txid: u.txid,
      vout: u.vout,
      amount: output.amount,
      scriptPubKey: output.scriptPubKey,
      rawTransaction: tx.rawTransaction,
      branch: u.branch,
      index: u.index,
      block: tx.block,
      coinbase: tx.parsed.coinbase,
    });
  }
  sumGrains(coins.map((c) => c.amount));
  const history: HistoryEntry[] = [];
  for (const [txid, tx] of transactions) {
    let received = 0n,
      spent = 0n;
    for (const output of tx.parsed.outputs)
      if (scripts.has(hex(output.scriptPubKey))) received += output.amount;
    for (const input of tx.parsed.inputs) {
      const previous = transactions.get(input.txid)?.parsed.outputs[input.vout];
      if (previous && scripts.has(hex(previous.scriptPubKey)))
        spent += previous.amount;
    }
    // History source must actually involve a watched output or spend; reject injected unrelated records.
    assert(
      involvedScripts.get(txid)!.size > 0,
      "Indexer returned unrelated or incomplete account history",
    );
    history.push({
      txid,
      received,
      spent,
      block: tx.block,
      state: tx.block ? "confirmed" : "pending",
    });
  }
  for (const old of options.previousHistory ?? [])
    if (!transactions.has(old.txid))
      history.push({ ...old, block: null, state: "detached" });
  const end = await source.tip();
  assert(
    end.genesisHash === start.genesisHash &&
      end.tip.hash === start.tip.hash &&
      end.tip.height === start.tip.height,
    "Chain tip changed during discovery; retry to avoid a mixed chain view",
  );
  const snapshot: WatchSnapshot = {
    schema: 1,
    account,
    genesisHash: start.genesisHash,
    tip: start.tip,
    coverage: {
      externalScannedThrough: scanned[0],
      changeScannedThrough: scanned[1],
      gapLimit: DISCOVERY_GAP,
    },
    coins,
  };
  const validation: ChainValidation = {
    network: account.network,
    genesisHash: start.genesisHash,
    tip: start.tip,
    checkedAt: Date.now(),
    coins: coins
      .filter((c) => c.block)
      .map(
        (c): ValidationCoin => ({
          outpoint: outpoint(c),
          state: "unspent",
          grains: c.amount.toString(),
          scriptPubKey: hex(c.scriptPubKey),
          block: c.block!,
          coinbase: c.coinbase,
          confirmations: start.tip.height - c.block!.height + 1,
        }),
      ),
  };
  return {
    snapshot,
    validation,
    history,
    complete: true,
    sourceTip: start.tip,
    lastUsed,
  };
}
