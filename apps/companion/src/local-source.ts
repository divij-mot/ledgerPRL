/** Exact-byte watch data from the local Pearl light client. Signing stays in the browser/Ledger. */
import {
  accountFromJson,
  addressToScript,
  assert,
  deriveAddress,
  hex,
  NETWORKS,
  parseTransaction,
  type AccountPublicKey,
} from "@pearl-ledger/sdk";
import {
  accountId,
  chainTip,
  hash,
  MAX_HISTORY_TRANSACTIONS,
  MAX_RAW_HISTORY_HEX,
  outpoint,
  record,
  safeInteger,
  type AddressActivity,
  type ChainTip,
  type PublicTransaction,
  type WatchSource,
} from "@pearl-ledger/wallet";

export const LOCAL_SOURCE_COMMIT = "2f8b770cac8f8b74be05c1fc51c2baeb76ce0701";
export type LocalRead = (
  method: "snapshot" | "blockHash",
  params: unknown,
) => Promise<unknown>;
export interface LocalStatus {
  ready: boolean;
  synced: boolean;
  needsRegistration: boolean;
  tip: ChainTip;
  headerHeight: number;
  filterHeight: number;
  bestPeerHeight: number;
  connections: number;
  lastUsed: [number, number];
  registeredThrough: [number, number];
}

export function localStatus(
  value: unknown,
  account: AccountPublicKey,
): LocalStatus {
  const data = record(value, "local light status");
  assert(
    account.network === "mainnet" && account.account === 0,
    "Local sync supports the first mainnet account",
  );
  assert(
    data.schema === 1 &&
      data.sourceCommit === LOCAL_SOURCE_COMMIT &&
      data.watchOnly === true &&
      data.network === account.network &&
      data.account === account.account &&
      data.genesisHash === NETWORKS.mainnet.genesisHash &&
      accountId(accountFromJson(data.publicAccount)) === accountId(account),
    "Local light account or network mismatch",
  );
  const coverage = record(data.coverage, "local coverage");
  const tuple = (raw: unknown, minimum: number): [number, number] => {
    assert(
      Array.isArray(raw) &&
        raw.length === 2 &&
        raw.every((n) => Number.isInteger(n) && n >= minimum && n <= 999),
      "Invalid local recovery range",
    );
    return [raw[0] as number, raw[1] as number];
  };
  const registeredThrough = tuple(data.registeredThrough, 19),
    lastUsed = tuple(data.lastUsed, -1);
  assert(
    lastUsed.every((n) => n <= 979) &&
      coverage.gapLimit === 20 &&
      coverage.externalScannedThrough === registeredThrough[0] &&
      coverage.changeScannedThrough === registeredThrough[1],
    "Invalid local scan coverage",
  );
  assert(
    [
      data.ready,
      data.synced,
      data.walletSynced,
      data.needsRegistration,
      coverage.scanComplete,
    ].every((v) => typeof v === "boolean"),
    "Invalid local sync state",
  );
  const result: LocalStatus = {
    ready: data.ready as boolean,
    synced: data.synced as boolean,
    needsRegistration: data.needsRegistration as boolean,
    tip: chainTip(data.tip),
    headerHeight: safeInteger(data.headerHeight, 0x7fffffff),
    filterHeight: safeInteger(data.filterHeight, 0x7fffffff),
    bestPeerHeight: safeInteger(data.bestPeerHeight, 0x7fffffff),
    connections: safeInteger(data.connections, 1000),
    lastUsed,
    registeredThrough,
  };
  if (result.ready)
    assert(
      result.synced &&
        data.walletSynced === true &&
        !result.needsRegistration &&
        coverage.scanComplete === true &&
        result.connections > 0 &&
        result.headerHeight >= result.bestPeerHeight &&
        result.tip.height === result.headerHeight &&
        result.tip.height === result.filterHeight &&
        lastUsed.every((n, branch) => n + 20 <= registeredThrough[branch]!),
      "Local account scan is incomplete",
    );
  return result;
}

export class LocalWatchSource implements WatchSource {
  readonly network = "mainnet" as const;
  readonly status: LocalStatus;
  private readonly transactions = new Map<
    string,
    PublicTransaction & { parsed: ReturnType<typeof parseTransaction> }
  >();
  private readonly unspent = new Set<string>();
  private readonly scripts = new Map<string, string>();
  private readonly view: string;
  private tipReads = 0;

  constructor(
    private readonly account: AccountPublicKey,
    value: unknown,
    private readonly read: LocalRead,
  ) {
    const data = record(value, "local snapshot");
    this.status = localStatus(data, account);
    assert(
      this.status.ready && data.complete === true,
      "Your local account is still syncing",
    );
    assert(
      Array.isArray(data.transactions) &&
        data.transactions.length <= MAX_HISTORY_TRANSACTIONS &&
        Array.isArray(data.unspent) &&
        data.unspent.length <= 256,
      "Local wallet history exceeds the supported limit",
    );
    let bytes = 0;
    for (const value of data.transactions) {
      const row = record(value, "local transaction"),
        txid = hash(row.txid);
      assert(
        typeof row.rawTransaction === "string" &&
          /^[0-9a-f]+$/.test(row.rawTransaction),
        "Invalid local transaction bytes",
      );
      bytes += row.rawTransaction.length;
      assert(
        bytes <= MAX_RAW_HISTORY_HEX,
        "Local history exceeds the read limit",
      );
      const parsed = parseTransaction(row.rawTransaction),
        block = row.block === null ? null : chainTip(row.block);
      assert(
        parsed.txid === txid &&
          !this.transactions.has(txid) &&
          (!block || block.height <= this.status.tip.height),
        "Local transaction identity mismatch",
      );
      this.transactions.set(txid, {
        parsed,
        rawTransaction: row.rawTransaction,
        block,
        confirmations: block ? this.status.tip.height - block.height + 1 : 0,
      });
    }
    for (const value of data.unspent) {
      const row = record(value, "local unspent output"),
        txid = hash(row.txid),
        vout = safeInteger(row.vout);
      const point = outpoint({ txid, vout });
      assert(
        this.transactions.get(txid)?.parsed.outputs[vout] &&
          !this.unspent.has(point),
        "Local unspent output lacks complete transaction history",
      );
      this.unspent.add(point);
    }
    for (const branch of [0, 1] as const)
      for (
        let index = 0;
        index <= this.status.registeredThrough[branch];
        index++
      ) {
        const derived = deriveAddress(account, branch, index);
        this.scripts.set(derived.address, hex(derived.scriptPubKey));
      }
    this.view = this.fingerprint();
  }

  private fingerprint(): string {
    return JSON.stringify({
      tip: this.status.tip,
      transactions: [...this.transactions]
        .map(([id, t]) => [id, t.rawTransaction, t.block])
        .sort(),
      unspent: [...this.unspent].sort(),
      coverage: this.status.registeredThrough,
      lastUsed: this.status.lastUsed,
    });
  }

  async tip() {
    if (this.tipReads++ > 0) {
      const latest = new LocalWatchSource(
        this.account,
        await this.read("snapshot", {}),
        this.read,
      );
      assert(
        latest.fingerprint() === this.view,
        "Local chain or wallet changed during the check; sync again",
      );
    }
    return {
      tip: { ...this.status.tip },
      genesisHash: NETWORKS.mainnet.genesisHash,
    };
  }

  async address(address: string): Promise<AddressActivity> {
    addressToScript(address, this.network);
    const script = this.scripts.get(address);
    assert(
      script,
      "Address is outside the completed local scan; extend recovery first",
    );
    const matches = [...this.transactions].filter(
      ([, tx]) =>
        tx.parsed.outputs.some((o) => hex(o.scriptPubKey) === script) ||
        tx.parsed.inputs.some((i) => {
          const previous = this.transactions.get(i.txid)?.parsed.outputs[
            i.vout
          ];
          return previous && hex(previous.scriptPubKey) === script;
        }),
    );
    const utxos: AddressActivity["utxos"] = [];
    for (const [txid, tx] of matches)
      tx.parsed.outputs.forEach((output, vout) => {
        if (
          hex(output.scriptPubKey) === script &&
          this.unspent.has(outpoint({ txid, vout }))
        )
          utxos.push({ txid, vout, height: tx.block?.height ?? null });
      });
    return {
      used: matches.length > 0,
      txids: matches.map(([id]) => id),
      confirmedTxCount: matches.filter(([, tx]) => tx.block !== null).length,
      pendingTxCount: matches.filter(([, tx]) => tx.block === null).length,
      utxos,
    };
  }

  async transaction(txid: string): Promise<PublicTransaction> {
    const tx = this.transactions.get(hash(txid));
    assert(tx, "Local transaction history is incomplete");
    return {
      rawTransaction: tx.rawTransaction,
      block: tx.block,
      confirmations: tx.confirmations,
    };
  }

  async blockHash(height: number): Promise<string> {
    safeInteger(height, this.status.tip.height);
    const data = record(
      await this.read("blockHash", { height }),
      "local block",
    );
    const tip = chainTip(data.tip);
    assert(
      data.height === height &&
        tip.hash === this.status.tip.hash &&
        tip.height === this.status.tip.height,
      "Local chain changed during the check; sync again",
    );
    return hash(data.hash);
  }
}
