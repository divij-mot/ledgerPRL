import {
  accountFromJson,
  accountToJson,
  bundleFromJson,
  bundleToJson,
  deriveAddress,
  finalizeTransaction,
  hex,
  validateBundle,
  type AccountPublicKey,
  type NetworkName,
  type SigningBundle,
  type FinalizedTransaction,
} from "@pearl-ledger/sdk";
import { assertPaymentPolicy } from "@pearl-ledger/wallet";
import {
  assertOrigin,
  chainFor,
  hash,
  integer,
  jsonClone,
  object,
  parseChain,
  requireCondition,
  transactionDigest,
  transactionRequestId,
  type Chain,
  type PublicAccountJson,
} from "./core.js";
import {
  LOCAL_SNAP_ID,
  MAX_ADDRESS_INDEX,
  REQUEST_TTL_MS,
  SESSION_TTL_MS,
  SNAP_VERSION,
} from "./config.js";
import { parsePublicIntent, type PublicDappRequest } from "./broker.js";
export { PrlDappProvider } from "./dapp.js";
export { LOCAL_SNAP_ID, SNAP_VERSION } from "./config.js";
export { chainFor } from "./core.js";

/** Explicit PRL API layered on wallet_invokeSnap. This is not an Ethereum provider. */
export interface MetaMaskProvider {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
}
/** Trusted companion integration only. LedgerBitcoinPrlClient implements this shape.
 * Each operation must independently enforce device identity and on-device confirmation.
 * There is deliberately no raw APDU, URL-configurable relay, or software-key fallback.
 */
export interface PrlHardwareSigner {
  exportAccount(
    account: number,
    signal?: AbortSignal,
  ): Promise<AccountPublicKey>;
  verifyAddress(
    account: AccountPublicKey,
    branch: 0 | 1,
    index: number,
    signal?: AbortSignal,
  ): Promise<string>;
  signTransaction(
    bundle: SigningBundle,
    account: AccountPublicKey,
    options?: {
      signal?: AbortSignal;
      onVerifiedSigned?: (
        transaction: FinalizedTransaction,
      ) => void | Promise<void>;
    },
  ): Promise<readonly Uint8Array[]>;
}
export interface CompanionOptions {
  ethereum: MetaMaskProvider;
  hardware: PrlHardwareSigner;
  /** Must be window.location.origin in the browser. MetaMask separately supplies the actual RPC origin. */
  origin: string;
  /** Must validate live network/genesis, outpoints, maturity, fees, reservations and the current device/session.
   * Throw on missing/stale evidence. Called immediately before each hardware signing operation.
   */
  validateBeforeHardware(
    bundle: SigningBundle,
    account: AccountPublicKey,
    signal?: AbortSignal,
  ): Promise<void>;
  /** Durably journal these verified bytes even after UI cancellation, account change, or disconnect.
   * Never honor an abort signal here. Retain spent-input reservations until recovery/reconciliation.
   */
  onVerifiedSigned(
    transaction: FinalizedTransaction,
    context: SignedPrlContext,
  ): Promise<void>;
  /** Persist the account and issued-address high-water mark/recovery metadata before display.
   * Reject when the host cannot durably reserve/restore this path. This is not permission to send data remotely.
   */
  beforeAddressDisplay(
    account: AccountPublicKey,
    branch: 0 | 1,
    index: number,
  ): Promise<void>;
}
export interface PreparedPrlTransaction {
  requestId: string;
  digest: string;
  sequence: number;
  expiresAt: number;
}
export interface SignedPrlContext {
  bundle: SigningBundle;
  account: AccountPublicKey;
  request: PreparedPrlTransaction;
  dappIntentId?: string;
}
export interface SignedPrlResult extends FinalizedTransaction {
  snapVerification: "verified" | "not-confirmed";
  snapError?: string;
}
function copyFinalized(
  transaction: FinalizedTransaction,
): FinalizedTransaction {
  return {
    ...transaction,
    bytes: transaction.bytes.slice(),
    signatures: transaction.signatures.map((s) => s.slice()),
  };
}
/** Signing happened. This error MUST NOT be interpreted as an unsigned, unlockable or retry-safe operation. */
export class PrlSignedPersistenceError extends Error {
  readonly transaction: FinalizedTransaction;
  readonly context: SignedPrlContext;
  constructor(
    transaction: FinalizedTransaction,
    context: SignedPrlContext,
    cause: unknown,
  ) {
    super(
      "PRL transaction is signed but durable storage failed. Preserve these bytes and input reservations; do not sign again.",
      { cause },
    );
    this.name = "PrlSignedPersistenceError";
    this.transaction = copyFinalized(transaction);
    this.context = {
      bundle: copyBundle(context.bundle),
      account: copyAccount(context.account),
      request: jsonClone(context.request),
      ...(context.dappIntentId ? { dappIntentId: context.dappIntentId } : {}),
    };
  }
}
interface Connection {
  sessionId: string;
  chain: Chain;
  account: PublicAccountJson;
  expiresAt: number;
}
interface PreparedInternal {
  ticket: PreparedPrlTransaction;
  bundle: SigningBundle;
  connection: Connection;
  dappIntentId?: string;
}
function ensureNotAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("PRL operation cancelled");
}
function copyAccount(account: AccountPublicKey): AccountPublicKey {
  return accountFromJson(accountToJson(account));
}
function copyBundle(bundle: SigningBundle): SigningBundle {
  return bundleFromJson(bundleToJson(bundle));
}
function sameAccount(a: PublicAccountJson, b: PublicAccountJson): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class PrlSnapCompanion {
  private connection: Connection | null = null;
  private prepared: PreparedInternal | null = null;
  private busy = false;
  private epoch = 0;
  private readonly options: Readonly<CompanionOptions>;
  constructor(options: CompanionOptions) {
    assertOrigin(options.origin);
    this.options = Object.freeze({ ...options });
  }
  private invoke(method: string, params: unknown): Promise<unknown> {
    return this.options.ethereum.request({
      method: "wallet_invokeSnap",
      params: {
        snapId: LOCAL_SNAP_ID,
        request: { method, params: jsonClone(params) },
      },
    });
  }
  private async exclusive<T>(
    operation: (check: () => void) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    requireCondition(
      !this.busy,
      "Another PRL companion operation is active",
      -32002,
    );
    ensureNotAborted(signal);
    this.busy = true;
    const epoch = this.epoch;
    const check = () => {
      ensureNotAborted(signal);
      requireCondition(
        epoch === this.epoch,
        "PRL session was disconnected",
        4100,
      );
    };
    try {
      return await operation(check);
    } finally {
      this.busy = false;
    }
  }
  private current(): Connection {
    const connection = this.connection;
    requireCondition(
      connection && Date.now() < connection.expiresAt,
      "Connect a current PRL hardware session first",
      4100,
    );
    return connection;
  }
  /** Wire to a dedicated installation/connect gesture. Does not connect hardware or import accounts. */
  async requestSnapInstallation(): Promise<void> {
    return this.exclusive(async (check) => {
      await this.options.ethereum.request({
        method: "wallet_requestSnaps",
        params: { [LOCAL_SNAP_ID]: { version: SNAP_VERSION } },
      });
      check();
    });
  }
  async connect(
    network: NetworkName,
    accountIndex: number,
    signal?: AbortSignal,
  ): Promise<{ account: PublicAccountJson; chain: Chain; expiresAt: number }> {
    return this.exclusive(async (check) => {
      this.connection = null;
      this.prepared = null;
      integer(accountIndex, 0x7fffffff);
      const chain = chainFor(network);
      const account = copyAccount(
        await this.options.hardware.exportAccount(accountIndex, signal),
      );
      check();
      requireCondition(
        account.network === network && account.account === accountIndex,
        "Ledger exported the wrong account or network",
      );
      const derived = deriveAddress(account, 0, 0);
      await this.options.beforeAddressDisplay(copyAccount(account), 0, 0);
      check();
      const displayed = await this.options.hardware.verifyAddress(
        copyAccount(account),
        0,
        0,
        signal,
      );
      check();
      requireCondition(
        displayed === derived.address,
        "Ledger address differs from public derivation",
      );
      const nonce = hex(globalThis.crypto.getRandomValues(new Uint8Array(32)));
      const response = object(
        await this.invoke("prl_connect", {
          chain,
          account: accountToJson(account),
          nonce,
        }),
        ["sessionId", "chain", "account", "expiresAt", "nextSequence"],
        "connection response",
      );
      check();
      const connectedChain = parseChain(response.chain),
        connectedAccount = accountToJson(accountFromJson(response.account));
      requireCondition(
        connectedChain.network === network &&
          sameAccount(connectedAccount, accountToJson(account)),
        "Snap connection account changed",
      );
      const expiresAt = integer(response.expiresAt);
      requireCondition(
        expiresAt > Date.now() && expiresAt <= Date.now() + SESSION_TTL_MS,
        "Invalid Snap session expiry",
      );
      requireCondition(
        response.nextSequence === 1,
        "Unexpected initial Snap sequence",
      );
      this.connection = {
        sessionId: hash(response.sessionId),
        chain,
        account: connectedAccount,
        expiresAt,
      };
      return jsonClone({ account: connectedAccount, chain, expiresAt });
    }, signal);
  }
  /** Derived address is checked against the connected Ledger's trusted display every time. */
  async verifyAddress(
    branch: 0 | 1,
    index: number,
    signal?: AbortSignal,
  ): Promise<string> {
    return this.exclusive(async (check) => {
      const connection = this.current(),
        account = accountFromJson(connection.account);
      requireCondition(branch === 0 || branch === 1, "Invalid address branch");
      integer(index, MAX_ADDRESS_INDEX);
      const expected = deriveAddress(account, branch, index).address;
      const response = object(
        await this.invoke("prl_getAddress", {
          sessionId: connection.sessionId,
          chain: connection.chain,
          branch,
          index,
        }),
        ["address", "path", "deviceVerified"],
        "address response",
      );
      check();
      requireCondition(
        response.address === expected &&
          response.path === deriveAddress(account, branch, index).path &&
          response.deviceVerified === false,
        "Snap address mismatch",
      );
      await this.options.beforeAddressDisplay(
        copyAccount(account),
        branch,
        index,
      );
      check();
      const displayed = await this.options.hardware.verifyAddress(
        copyAccount(account),
        branch,
        index,
        signal,
      );
      check();
      requireCondition(displayed === expected, "Ledger address mismatch");
      return displayed;
    }, signal);
  }
  /** Opens only the MetaMask review. It never calls a hardware signing operation. */
  async prepareTransaction(
    bundle: SigningBundle,
    signal?: AbortSignal,
  ): Promise<PreparedPrlTransaction> {
    return this.prepare(bundle, signal);
  }
  async prepareDappTransaction(
    id: string,
    bundle: SigningBundle,
    signal?: AbortSignal,
  ): Promise<PreparedPrlTransaction> {
    return this.prepare(bundle, signal, hash(id));
  }
  private async prepare(
    bundle: SigningBundle,
    signal?: AbortSignal,
    dappIntentId?: string,
  ): Promise<PreparedPrlTransaction> {
    return this.exclusive(async (check) => {
      const connection = this.current();
      requireCondition(
        !this.prepared,
        "Finish or cancel the prepared transaction",
        -32002,
      );
      const snapshot = copyBundle(bundle),
        account = accountFromJson(connection.account);
      validateBundle(snapshot, account);
      assertPaymentPolicy(snapshot);
      const status = object(
        await this.invoke("prl_getAccount", {
          sessionId: connection.sessionId,
          chain: connection.chain,
        }),
        ["account", "chain", "expiresAt", "nextSequence"],
        "account response",
      );
      check();
      requireCondition(
        sameAccount(
          accountToJson(accountFromJson(status.account)),
          connection.account,
        ) &&
          parseChain(status.chain).genesisHash ===
            connection.chain.genesisHash &&
          parseChain(status.chain).network === connection.chain.network &&
          status.expiresAt === connection.expiresAt,
        "Snap session account changed",
      );
      const sequence = integer(status.nextSequence),
        digest = transactionDigest(snapshot);
      const response = object(
        await this.invoke(
          dappIntentId
            ? "prl_prepareDappTransaction"
            : "prl_prepareTransaction",
          {
            sessionId: connection.sessionId,
            chain: connection.chain,
            sequence,
            bundle: bundleToJson(snapshot),
            ...(dappIntentId ? { id: dappIntentId } : {}),
          },
        ),
        ["requestId", "sequence", "digest", "expiresAt"],
        "approval response",
      );
      check();
      const requestId = transactionRequestId(
          connection.sessionId,
          sequence,
          connection.chain,
          digest,
        ),
        expiresAt = integer(response.expiresAt);
      requireCondition(
        response.requestId === requestId &&
          response.digest === digest &&
          response.sequence === sequence,
        "Snap approved a different transaction",
      );
      requireCondition(
        expiresAt > Date.now() &&
          expiresAt <=
            Math.min(connection.expiresAt, Date.now() + REQUEST_TTL_MS),
        "Invalid signing request expiry",
      );
      const ticket = { requestId, digest, sequence, expiresAt };
      this.prepared = {
        ticket,
        bundle: snapshot,
        connection,
        ...(dappIntentId ? { dappIntentId } : {}),
      };
      return jsonClone(ticket);
    }, signal);
  }
  /** Wire to a SECOND explicit user action after prepareTransaction. Approval in MetaMask alone cannot invoke this.
   * Validates host state, asks Ledger to sign, independently verifies every signature, and asks the Snap to verify.
   * Journals verified bytes before checking cancellation again. A Snap failure returns signed recovery bytes.
   * The caller must obtain separate, explicit broadcast intent; never unlock inputs on a signed outcome.
   */
  async signPreparedTransaction(
    inputTicket: PreparedPrlTransaction,
    signal?: AbortSignal,
  ): Promise<SignedPrlResult> {
    return this.exclusive(async (check) => {
      const connection = this.current(),
        prepared = this.prepared;
      const ticket = jsonClone(inputTicket);
      object(
        ticket,
        ["requestId", "digest", "sequence", "expiresAt"],
        "signing ticket",
      );
      requireCondition(
        prepared &&
          prepared.connection === connection &&
          ticket.requestId === prepared.ticket.requestId &&
          ticket.digest === prepared.ticket.digest &&
          ticket.sequence === prepared.ticket.sequence &&
          ticket.expiresAt === prepared.ticket.expiresAt,
        "Unknown or changed PRL signing ticket",
      );
      this.prepared = null; // One local attempt, including failures or cancellation.
      try {
        requireCondition(
          Date.now() < ticket.expiresAt,
          "PRL signing request expired",
        );
        const bundle = copyBundle(prepared.bundle),
          account = accountFromJson(connection.account);
        validateBundle(bundle, account);
        assertPaymentPolicy(bundle);
        if (prepared.dappIntentId) {
          const begun = parsePublicIntent(
            await this.invoke("prl_beginDappSigning", {
              sessionId: connection.sessionId,
              chain: connection.chain,
              id: prepared.dappIntentId,
              requestId: ticket.requestId,
            }),
          );
          requireCondition(
            begun.id === prepared.dappIntentId && begun.status === "signing",
            "Website signing claim changed",
          );
          check();
        }
        requireCondition(
          Date.now() < ticket.expiresAt,
          "PRL signing request expired after website claim",
        );
        // No asynchronous Snap/UI operation may sit between live host validation and device access.
        await this.options.validateBeforeHardware(
          copyBundle(bundle),
          copyAccount(account),
          signal,
        );
        check();
        requireCondition(
          Date.now() < ticket.expiresAt,
          "PRL signing request expired before device access",
        );
        const dappContext = prepared.dappIntentId
          ? { dappIntentId: prepared.dappIntentId }
          : {};
        const recordSiteResult = async (transaction: FinalizedTransaction) => {
          if (!prepared.dappIntentId) return;
          const recorded = parsePublicIntent(
            await this.invoke("prl_recordDappSigned", {
              sessionId: connection.sessionId,
              chain: connection.chain,
              id: prepared.dappIntentId,
              rawTx: transaction.rawTx,
            }),
          );
          requireCondition(
            recorded.id === prepared.dappIntentId &&
              recorded.txid === transaction.txid,
            "Website signed result changed",
          );
        };
        let verified: FinalizedTransaction | undefined;
        let persistenceFailure: PrlSignedPersistenceError | undefined;
        let persistencePromise: Promise<void> | undefined;
        const recordVerified = (
          transaction: FinalizedTransaction,
        ): Promise<void> => {
          // Reconstruct from signatures ourselves; never trust transport-supplied raw bytes or metadata.
          const canonical = finalizeTransaction(bundle, transaction.signatures);
          if (verified) {
            requireCondition(
              verified.rawTx === canonical.rawTx,
              "Hardware returned different signed bytes after verification",
            );
            return persistencePromise!;
          }
          verified = canonical;
          persistencePromise = (async () => {
            try {
              await this.options.onVerifiedSigned(copyFinalized(canonical), {
                bundle: copyBundle(bundle),
                account: copyAccount(account),
                request: jsonClone(ticket),
                ...dappContext,
              });
            } catch (cause) {
              persistenceFailure = new PrlSignedPersistenceError(
                canonical,
                { bundle, account, request: ticket, ...dappContext },
                cause,
              );
              throw persistenceFailure;
            }
          })();
          // Also handled here if an incorrect transport forgets to await its callback.
          void persistencePromise.catch(() => undefined);
          return persistencePromise;
        };
        let finalized: FinalizedTransaction;
        try {
          const signatures = await this.options.hardware.signTransaction(
            copyBundle(bundle),
            copyAccount(account),
            {
              ...(signal ? { signal } : {}),
              onVerifiedSigned: recordVerified,
            },
          );
          // Fallback for an adapter that returns all signatures without early notification; no duplicate writes.
          const returned = finalizeTransaction(bundle, signatures);
          await recordVerified(returned);
          finalized = verified!;
        } catch (error) {
          if (persistencePromise) await persistencePromise;
          if (persistenceFailure) throw persistenceFailure;
          if (!verified) throw error;
          try {
            await recordSiteResult(verified);
          } catch {
            /* Host recovery retains signed data. */
          }
          try {
            await this.invoke("prl_cancel", {
              sessionId: connection.sessionId,
              chain: connection.chain,
              requestId: ticket.requestId,
            });
          } catch {
            /* Signed recovery takes precedence. */
          }
          return {
            ...verified,
            snapVerification: "not-confirmed",
            snapError:
              error instanceof Error
                ? error.message
                : "Device completion was not confirmed",
          };
        }
        try {
          await recordSiteResult(finalized);
          check();
          requireCondition(
            Date.now() < ticket.expiresAt,
            "PRL signing request expired during device review",
          );
          const response = object(
            await this.invoke("prl_submitSignatures", {
              sessionId: connection.sessionId,
              chain: connection.chain,
              requestId: ticket.requestId,
              digest: ticket.digest,
              signatures: finalized.signatures.map(hex),
            }),
            ["requestId", "digest", "chain", "rawTx", "txid", "wtxid", "vsize"],
            "signature result",
          );
          check();
          requireCondition(
            response.requestId === ticket.requestId &&
              response.digest === ticket.digest &&
              parseChain(response.chain).genesisHash ===
                connection.chain.genesisHash &&
              parseChain(response.chain).network === connection.chain.network &&
              response.rawTx === finalized.rawTx &&
              response.txid === finalized.txid &&
              response.wtxid === finalized.wtxid &&
              response.vsize === finalized.vsize,
            "Snap signed result differs from independent verification",
          );
          return { ...finalized, snapVerification: "verified" };
        } catch (error) {
          try {
            await this.invoke("prl_cancel", {
              sessionId: connection.sessionId,
              chain: connection.chain,
              requestId: ticket.requestId,
            });
          } catch {
            /* Public permission expires; signed bytes remain durable. */
          }
          return {
            ...finalized,
            snapVerification: "not-confirmed",
            snapError:
              error instanceof Error
                ? error.message
                : "MetaMask verification was not confirmed",
          };
        }
      } catch (error) {
        try {
          await this.invoke("prl_cancel", {
            sessionId: connection.sessionId,
            chain: connection.chain,
            requestId: ticket.requestId,
          });
        } catch {
          /* No blind retry. Device outcome can remain uncertain. */
        }
        throw error;
      }
    }, signal);
  }
  async cancelPreparedTransaction(): Promise<void> {
    return this.exclusive(async (check) => {
      const connection = this.current(),
        prepared = this.prepared;
      requireCondition(prepared, "No prepared PRL transaction");
      this.prepared = null;
      if (prepared.dappIntentId) {
        const result = parsePublicIntent(
          await this.invoke("prl_rejectDappRequest", {
            sessionId: connection.sessionId,
            chain: connection.chain,
            id: prepared.dappIntentId,
          }),
        );
        check();
        requireCondition(
          result.status === "cancelled",
          "Website cancellation was not acknowledged",
        );
      } else {
        const response = object(
          await this.invoke("prl_cancel", {
            sessionId: connection.sessionId,
            chain: connection.chain,
            requestId: prepared.ticket.requestId,
          }),
          ["cancelled"],
          "cancellation response",
        );
        check();
        requireCondition(
          response.cancelled === true,
          "Cancellation was not acknowledged",
        );
      }
    });
  }
  async listDappRequests(): Promise<PublicDappRequest[]> {
    return this.exclusive(async (check) => {
      const c = this.current();
      const response = await this.invoke("prl_listDappRequests", {
        sessionId: c.sessionId,
        chain: c.chain,
      });
      check();
      requireCondition(
        Array.isArray(response) && response.length <= 8,
        "Invalid website request list",
      );
      return response.map(parsePublicIntent);
    });
  }
  async claimDappRequest(id: string): Promise<PublicDappRequest> {
    return this.dappAction("prl_claimDappRequest", { id: hash(id) });
  }
  async rejectDappRequest(id: string): Promise<PublicDappRequest> {
    return this.dappAction("prl_rejectDappRequest", { id: hash(id) });
  }
  /** Recovery can report already signed bytes after reconnecting the identical public account. Never signs. */
  async recordDappSigned(
    id: string,
    transaction: FinalizedTransaction,
  ): Promise<PublicDappRequest> {
    return this.dappAction(
      "prl_recordDappSigned",
      { id: hash(id), rawTx: transaction.rawTx },
      true,
    );
  }
  /** Call only after the companion's explicit broadcast action returns accepted or an uncertain outcome.
   * A transaction id alone does not prove node acceptance or confirmation.
   */
  async reportDappBroadcast(
    id: string,
    txid: string,
    outcome: "accepted" | "unknown",
  ): Promise<PublicDappRequest> {
    return this.dappAction(
      "prl_reportDappBroadcast",
      { id: hash(id), txid: hash(txid), outcome },
      true,
    );
  }
  private async dappAction(
    method: string,
    fields: Record<string, unknown>,
    completing = false,
  ): Promise<PublicDappRequest> {
    return this.exclusive(async (check) => {
      const c = completing ? this.connection : this.current();
      requireCondition(
        c,
        "Reconnect the identical public account to report recovery",
      );
      const response = parsePublicIntent(
        await this.invoke(method, {
          sessionId: c.sessionId,
          chain: c.chain,
          ...fields,
        }),
      );
      check();
      requireCondition(
        response.id === fields.id &&
          response.chain.network === c.chain.network &&
          response.chain.genesisHash === c.chain.genesisHash,
        "Website response binding changed",
      );
      return response;
    });
  }
  /** Immediately invalidates local in-flight operations. A busy Snap can reject remote cleanup;
   * in that case its public pending record expires and cannot trigger any hardware operation itself.
   */
  async disconnect(): Promise<void> {
    this.epoch++;
    const connection = this.connection;
    this.connection = null;
    this.prepared = null;
    if (connection)
      await this.invoke("prl_disconnect", {
        sessionId: connection.sessionId,
        chain: connection.chain,
      });
  }
}
