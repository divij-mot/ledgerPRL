import {
  assert,
  addressToScript,
  deriveAddress,
  hex,
  NETWORKS,
  type NetworkName,
  parseTransaction,
} from "@pearl-ledger/sdk";
import { readBoundedText, readBoundedJson } from "@pearl-ledger/sdk";
import {
  type WatchSource,
  type AddressActivity,
  type PublicTransaction,
  type WatchSnapshot,
  type ChainValidation,
  type ValidationCoin,
  record,
  safeInteger,
  hash,
  chainTip,
  outpoint,
  MAX_HISTORY_TRANSACTIONS,
  MAX_RAW_HISTORY_HEX,
  MAX_HISTORY_REFERENCES,
} from "@pearl-ledger/wallet";

/** Fixed verified HTTPS services; never accept arbitrary host, URL, RPC method or credentials. */
export const BLOCKBOOK_HOSTS = Object.freeze({
  mainnet: "https://blockbook.pearlresearch.ai",
  testnet2: "https://blockbook.testnet.pearlresearch.ai",
});
export function lightNetwork(value: unknown): "mainnet" | "testnet2" {
  assert(
    value === "mainnet" || value === "testnet2",
    "Public light mode is available only for mainnet and testnet2",
  );
  return value;
}
export class BlockbookSource implements WatchSource {
  readonly network: "mainnet" | "testnet2";
  readonly base: string;
  constructor(
    network: NetworkName,
    private readonly fetcher: typeof fetch = fetch,
    private readonly signal?: AbortSignal,
  ) {
    this.network = lightNetwork(network);
    this.base = BLOCKBOOK_HOSTS[this.network];
  }
  async get(path: string): Promise<unknown> {
    const route =
      /^(?:\/api\/v2\/(?:|block-index\/[0-9]+|utxo\/([a-zA-Z0-9]+)|tx\/[0-9a-f]{64}|address\/([a-zA-Z0-9]+)\?details=txids&pageSize=1000&page=[1-2])|\/api\/v1\/estimatefee\/(?:1|10|25))$/.exec(
        path,
      );
    assert(
      route !== null && route[0] === path,
      "Unsupported read-only indexer path",
    );
    // Reject arbitrary alphanumeric data (including extended account keys),
    // wrong-network addresses and invalid checksums before any disclosure.
    const address = route[1] ?? route[2];
    if (address !== undefined) addressToScript(address, this.network);
    const response = await this.fetcher(this.base + path, {
      redirect: "error",
      signal: this.signal
        ? AbortSignal.any([this.signal, AbortSignal.timeout(20_000)])
        : AbortSignal.timeout(20_000),
      headers: { accept: "application/json" },
    });
    assert(
      response.ok,
      `Public indexer unavailable (HTTP ${response.status}); no balance update was applied`,
    );
    const maximum = path.startsWith("/api/v1/estimatefee/")
      ? 1024
      : 4 * 1024 * 1024;
    const length = Number(response.headers.get("content-length") ?? 0);
    assert(length <= maximum, "Indexer response too large");
    const text = await readBoundedText(response, maximum);
    assert(text.length <= maximum, "Indexer response too large");
    return JSON.parse(text);
  }
  async blockHash(height: number): Promise<string> {
    safeInteger(height);
    return hash(
      record(await this.get(`/api/v2/block-index/${height}`), "block index")
        .blockHash,
    );
  }
  async tip() {
    const status = record(await this.get("/api/v2/"), "indexer status"),
      book = record(status.blockbook, "indexer"),
      backend = record(status.backend, "backend");
    assert(
      backend.chain === this.network && book.decimals === 8,
      "Indexer chain or unit mismatch",
    );
    assert(
      book.inSync === true &&
        book.initialSync === false &&
        book.inSyncMempool === true,
      "Indexer is not fully synced; balances unavailable",
    );
    const height = safeInteger(book.bestHeight);
    assert(
      height === safeInteger(backend.blocks),
      "Indexer and node heights differ",
    );
    const tip = { height, hash: hash(backend.bestBlockHash) };
    assert((await this.blockHash(height)) === tip.hash, "Indexer tip changed");
    const genesisHash = await this.blockHash(0);
    assert(
      genesisHash === NETWORKS[this.network].genesisHash,
      "Indexer genesis mismatch",
    );
    return { tip, genesisHash };
  }
  async unspent(address: string) {
    const value = await this.get(`/api/v2/utxo/${encodeURIComponent(address)}`);
    assert(
      Array.isArray(value) && value.length <= 256,
      "UTXO limit reached; account scan incomplete",
    );
    return value.map((item) => {
      const u = record(item, "UTXO");
      const height =
        u.height === undefined || u.height === null || u.height === -1
          ? null
          : safeInteger(u.height);
      return { txid: hash(u.txid), vout: safeInteger(u.vout), height };
    });
  }
  async address(address: string): Promise<AddressActivity> {
    const txids: string[] = [];
    let used = false,
      page = 1,
      pages = 1,
      expectedTotal: number | undefined,
      expectedPages: number | undefined,
      expectedConfirmed: number | undefined,
      expectedPending: number | undefined;
    do {
      const value = record(
        await this.get(
          `/api/v2/address/${encodeURIComponent(address)}?details=txids&pageSize=1000&page=${page}`,
        ),
        "address history",
      );
      assert(value.address === address, "Indexer address mismatch");
      const confirmed = safeInteger(value.txs),
        pending = safeInteger(value.unconfirmedTxs ?? 0);
      used = confirmed > 0 || pending > 0;
      if (expectedConfirmed === undefined) {
        expectedConfirmed = confirmed;
        expectedPending = pending;
      } else
        assert(
          expectedConfirmed === confirmed && expectedPending === pending,
          "Address confirmation categories changed during pagination",
        );
      const total = confirmed + pending;
      assert(
        total <= MAX_HISTORY_TRANSACTIONS,
        "Address history exceeds 2000 transactions; scan incomplete",
      );
      if (expectedTotal === undefined) expectedTotal = total;
      else
        assert(
          expectedTotal === total,
          "Address history changed during pagination; retry",
        );
      pages = safeInteger(value.totalPages ?? (used ? 1 : 0), 2);
      assert((value.page ?? 1) === page, "Indexer page mismatch");
      if (expectedPages === undefined) expectedPages = pages;
      else assert(expectedPages === pages, "Page count changed during scan");
      assert(
        !used ||
          (pages >= Math.ceil(confirmed / 1000) &&
            pages <= Math.max(1, Math.ceil(total / 1000))),
        "Indexer pagination contradicts history total",
      );
      assert(
        value.itemsOnPage === undefined || value.itemsOnPage === 1000,
        "Indexer did not honor requested page size",
      );
      const list = value.txids ?? [];
      assert(
        Array.isArray(list) && list.length <= 1000 + pending,
        "Invalid history page",
      );
      for (const id of list) txids.push(hash(id));
      assert(
        txids.length <= MAX_HISTORY_TRANSACTIONS,
        "Address history limit reached; account scan incomplete",
      );
      assert(!used || list.length > 0, "Incomplete address history");
      page++;
    } while (page <= pages);
    assert(
      new Set(txids).size === txids.length,
      "Duplicate transaction across indexer pages",
    );
    assert(
      txids.length === expectedTotal,
      "Truncated account history; scan incomplete",
    );
    return {
      used,
      confirmedTxCount: expectedConfirmed!,
      pendingTxCount: expectedPending!,
      txids,
      utxos: used ? await this.unspent(address) : [],
    };
  }
  async transaction(txid: string): Promise<PublicTransaction> {
    const tx = record(
      await this.get(`/api/v2/tx/${hash(txid)}`),
      "raw transaction",
    );
    assert(
      tx.txid === txid &&
        typeof tx.hex === "string" &&
        tx.hex.length <= 1_000_000,
      "Raw transaction missing or mismatched",
    );
    const conf = safeInteger(tx.confirmations);
    const block =
      conf === 0
        ? null
        : chainTip({ height: tx.blockHeight, hash: tx.blockHash });
    // Amounts are always re-parsed from the raw bytes by the wallet core.
    return { rawTransaction: tx.hex, block, confirmations: conf };
  }
}
export async function checkLightSnapshot(
  source: WatchSource,
  snapshot: WatchSnapshot,
): Promise<ChainValidation> {
  assert(
    source.network === snapshot.account.network,
    "Indexer network mismatch",
  );
  const start = await source.tip();
  const addresses = new Map<string, AddressActivity>();
  const coins: ValidationCoin[] = [];
  const spent = new Set<string>();
  const checkedTransactions = new Map<string, PublicTransaction>();
  let rawHistoryBytes = 0,
    historyReferences = 0;
  // Gather the complete spent set before classifying any coin: a later address's
  // pending transaction can spend an earlier address's otherwise confirmed UTXO.
  for (const coin of snapshot.coins) {
    const address = deriveAddress(
      snapshot.account,
      coin.branch,
      coin.index,
    ).address;
    if (!addresses.has(address)) {
      const activity = await source.address(address);
      historyReferences += activity.txids.length;
      assert(
        historyReferences <= MAX_HISTORY_REFERENCES,
        "Aggregate input history exceeds safe validation budget",
      );
      addresses.set(address, activity);
      // Do not assume utxo() excludes mempool-spent outputs. Parse complete address history.
      let confirmedCount = 0,
        pendingCount = 0;
      for (const id of activity.txids) {
        let tx = checkedTransactions.get(id);
        if (!tx) {
          assert(
            checkedTransactions.size < MAX_HISTORY_TRANSACTIONS,
            "Input history transaction limit exceeded",
          );
          tx = await source.transaction(id);
          rawHistoryBytes += tx.rawTransaction.length;
          assert(
            rawHistoryBytes <= MAX_RAW_HISTORY_HEX,
            "Aggregate input history exceeds 3 MiB; inputs unverified",
          );
          checkedTransactions.set(id, tx);
        }
        tx.block ? confirmedCount++ : pendingCount++;
        if (tx.block)
          assert(
            tx.confirmations === start.tip.height - tx.block.height + 1,
            "History confirmation count contradicts tip",
          );
        const parsed = parseTransaction(tx.rawTransaction);
        assert(parsed.txid === id, "History transaction mismatch");
        for (const input of parsed.inputs) spent.add(outpoint(input));
      }
      assert(
        confirmedCount === activity.confirmedTxCount &&
          pendingCount === activity.pendingTxCount,
        "Address confirmed/pending categories contradict returned history",
      );
    }
  }
  for (const coin of snapshot.coins) {
    const point = outpoint(coin);
    const address = deriveAddress(
      snapshot.account,
      coin.branch,
      coin.index,
    ).address;
    const match = addresses
      .get(address)!
      .utxos.find((u) => outpoint(u) === point);
    if (spent.has(point)) {
      coins.push({ outpoint: point, state: "spent-or-unknown" });
      continue;
    }
    if (!match || match.height === null) {
      coins.push({ outpoint: point, state: "spent-or-unknown" });
      continue;
    }
    if (
      coin.block &&
      (coin.block.height > start.tip.height ||
        (await source.blockHash(coin.block.height)) !== coin.block.hash)
    ) {
      coins.push({ outpoint: point, state: "reorged" });
      continue;
    }
    const tx = await source.transaction(coin.txid),
      parsed = parseTransaction(tx.rawTransaction),
      output = parsed.outputs[coin.vout];
    assert(
      parsed.txid === coin.txid &&
        output &&
        output.amount === coin.amount &&
        hex(output.scriptPubKey) === hex(coin.scriptPubKey) &&
        parsed.coinbase === coin.coinbase,
      "Indexer previous output mismatch",
    );
    assert(
      tx.block &&
        tx.block.height === match.height &&
        tx.block.height <= start.tip.height,
      "Indexer UTXO confirmation mismatch",
    );
    assert(
      (await source.blockHash(tx.block.height)) === tx.block.hash,
      "Indexer returned a detached output",
    );
    if (coin.block)
      assert(
        coin.block.height === tx.block.height &&
          coin.block.hash === tx.block.hash,
        "Input block changed; resync account",
      );
    coins.push({
      outpoint: point,
      state: "unspent",
      grains: coin.amount.toString(),
      scriptPubKey: hex(coin.scriptPubKey),
      block: tx.block,
      coinbase: coin.coinbase,
      confirmations: start.tip.height - tx.block.height + 1,
    });
  }
  // A stable chain tip does not freeze the mempool or indexer's UTXO view. Take
  // one bounded consistency pass and reject any observed change, including a
  // same-count transaction replacement. Ordering alone is not a view change.
  const view = (activity: AddressActivity) =>
    JSON.stringify({
      used: activity.used,
      confirmed: activity.confirmedTxCount,
      pending: activity.pendingTxCount,
      txids: [...activity.txids].sort(),
      utxos: activity.utxos.map((u) => `${outpoint(u)}:${u.height}`).sort(),
    });
  for (const [address, activity] of addresses)
    assert(
      view(await source.address(address)) === view(activity),
      "Address history or UTXO view changed; retry the input check",
    );
  const end = await source.tip();
  assert(
    end.tip.hash === start.tip.hash && end.tip.height === start.tip.height,
    "Indexer tip changed; retry the input check",
  );
  return {
    network: source.network,
    genesisHash: start.genesisHash,
    tip: start.tip,
    checkedAt: Date.now(),
    coins,
  };
}
