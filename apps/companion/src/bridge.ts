import { requestOperation, abortable, readJsonBody } from "./operation.js";
/** Narrow local node boundary. Never expose arbitrary RPC method/URL or wallet signing APIs. */
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  type NetworkName,
  NETWORKS,
  assert,
  hex,
  parseTransaction,
  finalizeTransaction,
  decodeBundle,
  fromHex,
  validateBundle,
} from "@pearl-ledger/sdk";
import { readBoundedText, readBoundedJson } from "@pearl-ledger/sdk";
import {
  parseWatchSnapshot,
  type ChainTip,
  type ChainValidation,
  type WatchSnapshot,
  type ValidationCoin,
  hash,
  safeInteger,
  record,
  outpoint,
  exactKeys,
  chainTip,
} from "@pearl-ledger/wallet";

export interface BridgeConfig {
  rpcUrl: string;
  rpcUser: string;
  rpcPassword: string;
  network: NetworkName;
  origin: string;
  port: number;
  allowBroadcast: boolean;
}
export type NodeRpc = (
  method:
    | "getblockchaininfo"
    | "getblockhash"
    | "getblockcount"
    | "gettxout"
    | "getrawtransaction"
    | "getrawmempool"
    | "sendrawtransaction",
  params: unknown[],
  signal?: AbortSignal,
) => Promise<unknown>;
export function validateNodeUrl(value: string): URL {
  const url = new URL(value);
  assert(
    !url.username && !url.password && !url.hash && !url.search,
    "RPC URL must not contain credentials, query or fragment",
  );
  const loopback = ["127.0.0.1", "[::1]", "localhost"].includes(url.hostname);
  assert(
    url.protocol === "https:" || (url.protocol === "http:" && loopback),
    "RPC endpoint must be HTTPS or loopback HTTP",
  );
  return url;
}
export function validateConfig(config: BridgeConfig): void {
  validateNodeUrl(config.rpcUrl);
  assert(Object.hasOwn(NETWORKS, config.network), "Unknown configured network");
  assert(
    config.rpcUser.length > 0 && config.rpcPassword.length > 0,
    "Authenticated RPC credentials are required on the bridge server",
  );
  const origin = new URL(config.origin);
  assert(
    config.origin === origin.origin &&
      ["127.0.0.1", "localhost", "[::1]"].includes(origin.hostname) &&
      origin.protocol === "http:",
    "Companion origin must be an exact local HTTP origin",
  );
  assert(
    Number.isInteger(config.port) &&
      config.port >= 1024 &&
      config.port <= 65535,
    "Invalid bridge port",
  );
}
export function createNodeRpc(config: BridgeConfig): NodeRpc {
  validateConfig(config);
  let requestId = 0;
  return async (method, params, signal) => {
    const id = ++requestId;
    const response = await fetch(config.rpcUrl, {
      method: "POST",
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(15_000)])
        : AbortSignal.timeout(15_000),
      headers: {
        "content-type": "application/json",
        authorization: `Basic ${Buffer.from(`${config.rpcUser}:${config.rpcPassword}`).toString("base64")}`,
      },
      body: JSON.stringify({ jsonrpc: "1.0", id, method, params }),
    });
    assert(response.ok, `Node HTTP ${response.status}`);
    const length = Number(response.headers.get("content-length") ?? 0);
    assert(length <= 4 * 1024 * 1024, "Node response too large");
    const text = await readBoundedText(response, 4 * 1024 * 1024);
    assert(text.length <= 4 * 1024 * 1024, "Node response too large");
    const result = record(JSON.parse(text), "RPC response");
    assert(result.id === id, "Node response ID mismatch");
    // Do not return untrusted node error text, which may reveal node configuration.
    assert(
      result.error === null || result.error === undefined,
      "Node RPC rejected the request",
    );
    return result.result;
  };
}
async function readTip(rpc: NodeRpc, network: NetworkName): Promise<ChainTip> {
  const info = record(
    await rpc("getblockchaininfo", []),
    "node chain identity",
  );
  assert(
    info.chain === network,
    "Node chain name mismatch; regtest and simnet must be distinguished",
  );
  assert(
    (await rpc("getblockhash", [0])) === NETWORKS[network].genesisHash,
    "Node genesis mismatch; check selected network",
  );
  const height = safeInteger(await rpc("getblockcount", []));
  return { height, hash: hash(await rpc("getblockhash", [height])) };
}
async function readMempool(
  rpc: NodeRpc,
): Promise<{ ids: string[]; spent: Map<string, string> }> {
  const value = await rpc("getrawmempool", [false]);
  assert(
    Array.isArray(value) && value.length <= 2000,
    "Mempool exceeds safe validation limit; inputs remain unverified",
  );
  const ids = value.map(hash).sort();
  assert(new Set(ids).size === ids.length, "Duplicate mempool transaction");
  const spent = new Map<string, string>();
  let rawMempoolBytes = 0;
  for (const id of ids) {
    const raw = await rpc("getrawtransaction", [id, 0]);
    assert(
      typeof raw === "string" && raw.length <= 1_000_000,
      "Mempool transaction unavailable",
    );
    rawMempoolBytes += raw.length;
    assert(
      rawMempoolBytes <= 3 * 1024 * 1024,
      "Aggregate raw mempool exceeds validation budget",
    );
    const tx = parseTransaction(raw);
    assert(tx.txid === id, "Mempool raw transaction mismatch");
    for (const input of tx.inputs) spent.set(outpoint(input), id);
  }
  return { ids, spent };
}
async function requireSameMempool(rpc: NodeRpc, ids: string[]) {
  const value = await rpc("getrawmempool", [false]);
  assert(Array.isArray(value) && value.length <= 2000, "Mempool unavailable");
  const end = value.map(hash).sort();
  assert(
    JSON.stringify(end) === JSON.stringify(ids),
    "Mempool changed during input validation; retry",
  );
}
/** Require a stable tip across the entire response; fail instead of mixing two chain views. */
export async function checkSnapshot(
  rpc: NodeRpc,
  network: NetworkName,
  snapshot: WatchSnapshot,
  now?: number,
): Promise<ChainValidation> {
  assert(
    snapshot.account.network === network,
    "Bridge network differs from public account",
  );
  const tip = await readTip(rpc, network);
  const mempool = await readMempool(rpc);
  const coins: ValidationCoin[] = [];
  for (const coin of snapshot.coins) {
    const key = outpoint(coin);
    if (mempool.spent.has(key)) {
      coins.push({ outpoint: key, state: "spent-or-unknown" });
      continue;
    }
    if (
      coin.block &&
      (coin.block.height > tip.height ||
        (await rpc("getblockhash", [coin.block.height])) !== coin.block.hash)
    ) {
      coins.push({ outpoint: key, state: "reorged" });
      continue;
    }
    const result = await rpc("gettxout", [coin.txid, coin.vout, true]);
    if (result === null) {
      coins.push({ outpoint: key, state: "spent-or-unknown" });
      continue;
    }
    const unspent = record(result, "node UTXO");
    assert(
      unspent.bestblock === tip.hash,
      "Node tip changed while checking inputs; retry",
    );
    const conf = safeInteger(unspent.confirmations);
    // Pending transactions are viewable offline but are deliberately not eligible in v1.
    if (conf === 0) {
      coins.push({ outpoint: key, state: "spent-or-unknown" });
      continue;
    }
    assert(conf <= tip.height + 1, "Invalid node confirmation count");
    const script = record(unspent.scriptPubKey, "node output script");
    assert(
      script.hex === hex(coin.scriptPubKey) &&
        unspent.coinbase === coin.coinbase,
      "Node output script or coinbase mismatch",
    );
    // Never use the JSON-RPC floating-point value field for amounts.
    const raw = await rpc("getrawtransaction", [coin.txid, 0]);
    assert(
      typeof raw === "string" && raw.length <= 1_000_000,
      "Raw previous transaction unavailable; node txindex may be required",
    );
    const tx = parseTransaction(raw),
      output = tx.outputs[coin.vout];
    assert(
      tx.txid === coin.txid &&
        output &&
        output.amount === coin.amount &&
        hex(output.scriptPubKey) === hex(coin.scriptPubKey) &&
        tx.coinbase === coin.coinbase,
      "Raw previous transaction does not match imported output",
    );
    const height = tip.height - conf + 1,
      block = { height, hash: hash(await rpc("getblockhash", [height])) };
    if (coin.block)
      assert(
        block.height === coin.block.height && block.hash === coin.block.hash,
        "Node block metadata inconsistent",
      );
    coins.push({
      outpoint: key,
      state: "unspent",
      grains: output.amount.toString(),
      scriptPubKey: hex(output.scriptPubKey),
      block,
      coinbase: tx.coinbase,
      confirmations: conf,
    });
  }
  await requireSameMempool(rpc, mempool.ids);
  const last = await readTip(rpc, network);
  assert(
    last.hash === tip.hash && last.height === tip.height,
    "Node tip changed; refresh and retry",
  );
  return {
    network,
    genesisHash: NETWORKS[network].genesisHash,
    tip,
    checkedAt: now ?? Date.now(),
    coins,
  };
}
export function verifyBroadcastPayload(network: NetworkName, value: unknown) {
  const body = record(value, "broadcast request");
  assert(
    Object.keys(body).length === 3 &&
      typeof body.bundleHex === "string" &&
      typeof body.rawTx === "string" &&
      typeof body.expectedTxid === "string",
    "Invalid broadcast request",
  );
  assert(
    body.bundleHex.length <= 3014 && body.rawTx.length <= 20_000,
    "Transaction too large",
  );
  const bundle = decodeBundle(fromHex(body.bundleHex));
  assert(bundle.network === network, "Broadcast network mismatch");
  validateBundle(bundle);
  const parsed = parseTransaction(body.rawTx);
  assert(
    parsed.inputs.length === bundle.inputs.length &&
      parsed.inputs.every(
        (input) =>
          input.scriptSig.length === 0 &&
          input.witness.length === 1 &&
          input.witness[0]?.length === 64,
      ),
    "Only exact key-path witnesses accepted",
  );
  const finalized = finalizeTransaction(
    bundle,
    parsed.inputs.map((input) => input.witness[0]!),
  );
  assert(
    finalized.rawTx === body.rawTx && finalized.txid === body.expectedTxid,
    "Signed transaction mismatch",
  );
  return finalized;
}
/** Bounded known-payment checks against the authenticated node, not a consensus proof. */
export const MAX_RECONCILE_BATCH = 100;
export const MAX_RECONCILE_CHECKPOINTS = 2000;
export const MAX_RECONCILE_RPC_CALLS = 2108;
type KnownState = "confirmed" | "pending" | "unknown" | "detached";
interface KnownTransaction {
  txid: string;
  state: KnownState;
  block?: ChainTip;
  confirmations?: number;
}
interface KnownCheckpoint extends ChainTip {
  state: "confirmed" | "insufficient" | "unknown" | "detached";
  confirmations?: number;
}
export async function checkKnownPayments(
  rpc: NodeRpc,
  network: NetworkName,
  value: unknown,
  now?: number,
) {
  const body = record(value, "reconciliation request");
  exactKeys(body, ["payments", "checkpoints"], "reconciliation request");
  assert(
    Array.isArray(body.payments) && body.payments.length <= MAX_RECONCILE_BATCH,
    "Reconciliation supports at most 100 signed payments per batch",
  );
  assert(
    Array.isArray(body.checkpoints) &&
      body.checkpoints.length <= MAX_RECONCILE_CHECKPOINTS &&
      body.payments.length + body.checkpoints.length <= 2000,
    "Reconciliation checkpoint limit exceeded",
  );
  // Validate every submitted signature and byte before making any node request.
  const payments = body.payments.map((payment) =>
    verifyBroadcastPayload(network, payment),
  );
  assert(
    new Set(payments.map((p) => p.txid)).size === payments.length,
    "Duplicate reconciliation transaction",
  );
  const checkpoints = body.checkpoints.map(chainTip);
  assert(
    new Set(checkpoints.map((c) => `${c.height}:${c.hash}`)).size ===
      checkpoints.length,
    "Duplicate archival checkpoint",
  );
  let rpcCalls = 0;
  const bounded: NodeRpc = (method, params) => {
    assert(
      ++rpcCalls <= MAX_RECONCILE_RPC_CALLS,
      "Reconciliation RPC budget exhausted",
    );
    return rpc(method, params);
  };
  const tip = await readTip(bounded, network);
  const hashes = new Map<number, string | null>();
  async function activeHash(height: number): Promise<string | null> {
    if (!hashes.has(height)) {
      try {
        hashes.set(height, hash(await bounded("getblockhash", [height])));
      } catch {
        hashes.set(height, null);
      }
    }
    return hashes.get(height)!;
  }
  const transactions: KnownTransaction[] = [];
  for (const payment of payments) {
    let checked: KnownTransaction = { txid: payment.txid, state: "unknown" };
    try {
      const tx = record(
        await bounded("getrawtransaction", [payment.txid, 1]),
        "known transaction",
      );
      assert(
        tx.txid === payment.txid && tx.hex === payment.rawTx,
        "Known signed transaction bytes changed",
      );
      // Pearl omits both fields for mempool transactions (omitempty).
      const confirmations =
        tx.confirmations === undefined && tx.blockhash === undefined
          ? 0
          : safeInteger(tx.confirmations);
      if (confirmations === 0) {
        assert(
          tx.blockhash === undefined,
          "Pending transaction has block metadata",
        );
        checked = { txid: payment.txid, state: "pending" };
      } else {
        assert(
          confirmations <= tip.height + 1,
          "Invalid known transaction confirmation count",
        );
        const block = {
          height: tip.height - confirmations + 1,
          hash: hash(tx.blockhash),
        };
        const active = await activeHash(block.height);
        checked =
          active === null
            ? checked
            : active !== block.hash
              ? { txid: payment.txid, state: "detached" }
              : {
                  txid: payment.txid,
                  state: "confirmed",
                  block,
                  confirmations,
                };
      }
    } catch {
      /* Missing, malformed or unavailable transactions remain active and reserved. */
    }
    transactions.push(checked);
  }
  const checkedCheckpoints: KnownCheckpoint[] = [];
  for (const checkpoint of checkpoints) {
    let state: KnownCheckpoint["state"] = "detached";
    const confirmations = tip.height - checkpoint.height + 1;
    if (confirmations >= 1) {
      const active = await activeHash(checkpoint.height);
      state =
        active === null
          ? "unknown"
          : active !== checkpoint.hash
            ? "detached"
            : confirmations >= 6
              ? "confirmed"
              : "insufficient";
    }
    checkedCheckpoints.push({
      ...checkpoint,
      state,
      ...(state === "confirmed" ? { confirmations } : {}),
    });
  }
  const end = await readTip(bounded, network);
  assert(
    end.hash === tip.hash && end.height === tip.height,
    "Node tip changed during reconciliation; retry",
  );
  return {
    network,
    genesisHash: NETWORKS[network].genesisHash,
    tip,
    checkedAt: now ?? Date.now(),
    rpcCalls,
    transactions,
    checkpoints: checkedCheckpoints,
  };
}
export async function broadcastVerified(
  rpc: NodeRpc,
  network: NetworkName,
  value: unknown,
): Promise<{ txid: string }> {
  const finalized = verifyBroadcastPayload(network, value);
  await readTip(rpc, network);
  const mempool = await readMempool(rpc);
  for (const input of parseTransaction(finalized.rawTx).inputs) {
    const spender = mempool.spent.get(outpoint(input));
    assert(
      !spender || spender === finalized.txid,
      "An input is spent by a different mempool transaction; do not rebroadcast",
    );
  }
  await requireSameMempool(rpc, mempool.ids);
  const response = await rpc("sendrawtransaction", [finalized.rawTx]);
  assert(
    response === finalized.txid,
    "Broadcast response mismatch; acceptance is unknown",
  );
  return { txid: finalized.txid };
}
function respond(
  response: ServerResponse,
  status: number,
  value: unknown,
): void {
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(JSON.stringify(value));
}
export function createBridge(
  config: BridgeConfig,
  rpc: NodeRpc = createNodeRpc(config),
) {
  validateConfig(config);
  // One request at a time, including read-only work; this prevents concurrent mixed node views.
  let busy = false;
  return createServer(async (request, response) => {
    const expectedHost = new URL(config.origin).host;
    if (
      request.method !== "POST" ||
      request.headers.origin !== config.origin ||
      request.headers.host !== expectedHost ||
      request.headers["x-pearl-companion"] !== "1"
    ) {
      respond(response, 403, { error: "Local companion origin required" });
      return;
    }
    if (
      !["/api/check", "/api/reconcile", "/api/broadcast"].includes(
        request.url ?? "",
      )
    ) {
      respond(response, 404, { error: "Unsupported route" });
      return;
    }
    if (busy) {
      respond(response, 409, {
        error: "Bridge is busy; wait for the current operation",
      });
      return;
    }
    busy = true;
    const operation = requestOperation(request, response, 85_000);
    const scoped: NodeRpc = (method, params) => {
      operation.signal.throwIfAborted();
      return abortable(rpc(method, params, operation.signal), operation.signal);
    };
    try {
      const body = await readJsonBody(request, operation.signal);
      if (request.url === "/api/check") {
        const snapshot = parseWatchSnapshot(JSON.stringify(body));
        respond(
          response,
          200,
          await checkSnapshot(scoped, config.network, snapshot),
        );
      } else if (request.url === "/api/reconcile") {
        respond(
          response,
          200,
          await checkKnownPayments(scoped, config.network, body),
        );
      } else {
        assert(
          config.allowBroadcast,
          "Broadcast is disabled; set PEARL_ALLOW_BROADCAST=1 on the local bridge only after testnet qualification",
        );
        respond(
          response,
          200,
          await broadcastVerified(scoped, config.network, body),
        );
      }
    } catch (error) {
      respond(response, 400, {
        error: error instanceof Error ? error.message : "Bridge request failed",
      });
    } finally {
      operation.dispose();
      busy = false;
    }
  });
}
