// SIGN_PSBT, wallet-policy and interruption framing derive from LedgerHQ/app-bitcoin
// 44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a bitcoin_client_js/src/lib/appClient.ts.
// Apache-2.0. Narrow PRL validation, exact PSBT parsing and terminal-session handling are local.
import { Buffer } from "buffer";
import {
  assert,
  checkedBranch,
  checkedIndex,
  compactSize,
  concat,
  deriveAddress,
  equal,
  finalizeTransaction,
  hex,
  network,
  parseTransaction,
  Reader,
  verifySignature,
  type AccountPublicKey,
  type ApduTransport,
  type FinalizedTransaction,
  type NetworkName,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import { ClientCommandInterpreter } from "./upstream/clientCommands.js";
import { hashLeaf, Merkle } from "./upstream/merkle.js";
import { DefaultWalletPolicy } from "./upstream/policy.js";
import {
  assertSameAccount,
  BITCOIN_PRL_PROTOCOL as PROTOCOL,
  createPrlWalletPolicy,
  parseAccountXpub,
  parseNetworkInfo,
  snapshotAccount,
  u32be,
  type PrlNetworkInfo,
} from "./policy.js";
import {
  buildPrlPsbt,
  merkleMap,
  parsePrlPsbt,
  serializePrlPsbt,
  snapshotBundle,
  type PrlPsbtV2,
  type PsbtOptions,
} from "./psbt.js";

export class BitcoinPrlDeviceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly instruction?: number,
  ) {
    super(message);
    this.name = "BitcoinPrlDeviceError";
  }
}
/** A complete signed transaction exists even though transport, cancellation or durable storage failed. */
export class VerifiedSigningResultError extends BitcoinPrlDeviceError {
  constructor(
    readonly signedTransaction: FinalizedTransaction,
    readonly failure: unknown,
  ) {
    super(
      "Signing completed, but acknowledgement or signed-transaction storage failed; retain these signed bytes and reconcile before retrying",
    );
    this.name = "VerifiedSigningResultError";
  }
}
export interface PrlFinalizedTransaction extends FinalizedTransaction {
  /** Signatures are valid; the session is terminal and the final device ACK was not confirmed. */
  readonly completionWarning?: "device-acknowledgement-unconfirmed";
}
export interface PrlPartialSignature {
  readonly inputIndex: number;
  /** BIP341 key-path signatures use the tweaked x-only output public key. */
  readonly pubkey: Uint8Array;
  readonly signature: Uint8Array;
}
export function parseYieldedSignature(bytes: Uint8Array): PrlPartialSignature {
  const r = new Reader(bytes);
  const inputIndex = r.compactSize(15);
  assert(
    r.byte() === 32,
    "Only x-only key-path signature yields are supported",
  );
  const pubkey = r.take(32),
    signature = r.take(64);
  r.end();
  return { inputIndex, pubkey, signature };
}
/** Verify index, output key, exact DEFAULT encoding and every signature before finalizing. */
export function verifyAndFinalize(
  bundle: SigningBundle,
  account: AccountPublicKey,
  partials: readonly PrlPartialSignature[],
): FinalizedTransaction {
  const snapshot = snapshotBundle(bundle, account);
  assert(
    partials.length === snapshot.inputs.length,
    "Native signature count mismatch",
  );
  const signatures: Uint8Array[] = [];
  for (const partial of partials) {
    checkedIndex(partial.inputIndex);
    const input = snapshot.inputs[partial.inputIndex];
    assert(
      input !== undefined && signatures[partial.inputIndex] === undefined,
      "Native signature index is duplicate or out of range",
    );
    assert(
      equal(partial.pubkey, input.scriptPubKey.slice(2)),
      "Native signature output key mismatch",
    );
    assert(
      verifySignature(snapshot, partial.inputIndex, partial.signature),
      `Native signature ${partial.inputIndex} failed independent BIP340 verification`,
    );
    signatures[partial.inputIndex] = Uint8Array.from(partial.signature);
  }
  assert(
    signatures.length === snapshot.inputs.length &&
      snapshot.inputs.every((_, i) => signatures[i] !== undefined),
    "Missing native signature",
  );
  const final = finalizeTransaction(snapshot, signatures);
  // A second parser checks the exact constructed witness transaction before release to callers.
  const parsed = parseTransaction(final.bytes);
  assert(
    parsed.txid === final.txid &&
      parsed.wtxid === final.wtxid &&
      parsed.version === snapshot.version &&
      parsed.lockTime === snapshot.lockTime &&
      parsed.inputs.length === snapshot.inputs.length &&
      parsed.outputs.length === snapshot.outputs.length,
    "Final transaction metadata mismatch",
  );
  parsed.inputs.forEach((input, i) => {
    const expected = snapshot.inputs[i]!;
    assert(
      input.txid === expected.txid &&
        input.vout === expected.vout &&
        input.sequence === expected.sequence &&
        input.scriptSig.length === 0 &&
        input.witness.length === 1 &&
        equal(input.witness[0]!, signatures[i]!),
      "Final input/witness mismatch",
    );
  });
  parsed.outputs.forEach((output, i) => {
    const expected = snapshot.outputs[i]!;
    assert(
      output.amount === expected.amount &&
        equal(output.scriptPubKey, expected.scriptPubKey),
      "Final recipient/change mismatch",
    );
  });
  return final;
}
export interface SigningOptions extends PsbtOptions {
  readonly signal?: AbortSignal;
  /** Called exactly once after the complete valid signature set, before the final device ACK.
   * Persist these bytes under the current payment lock. A storage failure carries them in
   * VerifiedSigningResultError; it must never authorize another signing attempt. */
  readonly onVerifiedSigned?: (
    transaction: FinalizedTransaction,
  ) => void | Promise<void>;
  readonly onProgress?: (
    phase: "transfer" | "review" | "signatures",
    completed: number,
    total: number,
  ) => void;
}
function ascii(bytes: Uint8Array, maxLength: number): string {
  assert(
    bytes.length > 0 &&
      bytes.length <= maxLength &&
      bytes.every((b) => b >= 33 && b <= 126),
    "Invalid device ASCII response",
  );
  return new TextDecoder("ascii", { fatal: true }).decode(bytes);
}
function cancelled(signal: AbortSignal): void {
  if (signal.aborted)
    throw new BitcoinPrlDeviceError(
      "Device operation cancelled or timed out; reconnect before retrying",
    );
}
function apdu(cla: number, ins: number, data: Uint8Array): Uint8Array {
  assert(data.length <= 255, "APDU exceeds short command limit");
  return concat(
    Uint8Array.of(cla, ins, 0, PROTOCOL.version, data.length),
    data,
  );
}
/**
 * Standard Ledger Bitcoin protocol v1 over the existing DMK/Speculos byte transport.
 * Only the PRL fork's ordinary BIP86 payment profile is exposed. Failures are terminal;
 * reconnect and create a new instance, never resume an interrupted signing transcript.
 */
export class LedgerBitcoinPrlClient {
  private state: "ready" | "busy" | "failed" | "closed" = "ready";
  private readonly timeoutMs: number;
  private readonly durabilityTimeoutMs: number;
  private readonly policyCache = new Map<string, DefaultWalletPolicy>();
  constructor(
    readonly transport: ApduTransport,
    readonly network: NetworkName,
    options: { timeoutMs?: number; durabilityTimeoutMs?: number } = {},
  ) {
    networkConfig(network);
    this.timeoutMs = options.timeoutMs ?? 300_000;
    assert(
      Number.isSafeInteger(this.timeoutMs) &&
        this.timeoutMs > 0 &&
        this.timeoutMs <= 3_600_000,
      "Invalid operation timeout",
    );
    this.durabilityTimeoutMs = options.durabilityTimeoutMs ?? 30_000;
    assert(
      Number.isSafeInteger(this.durabilityTimeoutMs) &&
        this.durabilityTimeoutMs > 0 &&
        this.durabilityTimeoutMs <= 300_000,
      "Invalid durable-storage timeout",
    );
  }
  get sessionState() {
    return this.state;
  }
  private async closeTransport(): Promise<void> {
    if (!this.transport.close) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.transport.close(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(new BitcoinPrlDeviceError("Transport cleanup timed out")),
            Math.min(5000, this.timeoutMs),
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  private async run<T>(
    fn: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    assert(
      this.state === "ready",
      `Device client is ${this.state}; no command sent`,
    );
    assert(!signal?.aborted, "Operation already cancelled; no command sent");
    this.state = "busy";
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(onAbort, this.timeoutMs);
    try {
      const result = await fn(controller.signal);
      cancelled(controller.signal);
      this.state = "ready";
      return result;
    } catch (error) {
      this.state = "failed";
      this.policyCache.clear();
      controller.abort();
      try {
        await this.closeTransport();
      } catch {
        /* Session remains terminal. */
      }
      throw error;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    }
  }
  private async exchange(
    cla: number,
    ins: number,
    data: Uint8Array,
    signal: AbortSignal,
  ) {
    cancelled(signal);
    let rejectAbort: (() => void) | undefined;
    const abort = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(
          new BitcoinPrlDeviceError(
            "Device operation cancelled or timed out; session is terminal",
          ),
        );
      signal.addEventListener("abort", rejectAbort, { once: true });
    });
    let response: Uint8Array;
    try {
      response = await Promise.race([
        this.transport.exchange(apdu(cla, ins, data), signal),
        abort,
      ]);
    } finally {
      if (rejectAbort) signal.removeEventListener("abort", rejectAbort);
    }
    // If a response won the race, process it even if cancellation occurred in the same
    // turn: it can contain the final signature. The next APDU is still cancellation-gated.
    assert(
      response instanceof Uint8Array &&
        response.length >= 2 &&
        response.length <= 4096,
      "Malformed APDU response",
    );
    const status =
      response[response.length - 2]! * 256 + response[response.length - 1]!;
    if (status !== 0x9000 && status !== 0xe000)
      throw new BitcoinPrlDeviceError(
        `Device rejected command (0x${status.toString(16)})`,
        status,
        ins,
      );
    return { status, data: Buffer.from(response.subarray(0, -2)) };
  }
  // The continuation framing matches upstream AppClient.makeRequest. Added bounds,
  // cancellation, strict yields and status handling apply to every continuation.
  private async makeRequest(
    ins: number,
    data: Uint8Array,
    signal: AbortSignal,
    interpreter?: ClientCommandInterpreter,
    onYield?: (bytes: Uint8Array) => void | Promise<void>,
  ): Promise<Uint8Array> {
    let response = await this.exchange(PROTOCOL.cla, ins, data, signal),
      requests = 0;
    while (response.status === 0xe000) {
      assert(interpreter !== undefined, "Unexpected interrupted execution");
      assert(++requests <= 100_000, "Device interruption budget exceeded");
      if (response.data[0] === 0x10) {
        assert(
          onYield !== undefined,
          "Unexpected signature yield outside signing",
        );
        await onYield(response.data.subarray(1));
      }
      const commandResponse = interpreter.execute(response.data);
      response = await this.exchange(
        PROTOCOL.FRAMEWORK_CLA,
        PROTOCOL.CONTINUE,
        commandResponse,
        signal,
      );
    }
    return Uint8Array.from(response.data);
  }
  private async readNetworkInfo(signal: AbortSignal): Promise<PrlNetworkInfo> {
    return parseNetworkInfo(
      await this.makeRequest(
        PROTOCOL.GET_NETWORK_INFO,
        new Uint8Array(),
        signal,
      ),
      this.network,
    );
  }
  capabilities(signal?: AbortSignal): Promise<PrlNetworkInfo> {
    return this.run((active) => this.readNetworkInfo(active), signal);
  }
  private async readAccount(
    account: number,
    signal: AbortSignal,
  ): Promise<{ account: AccountPublicKey; policy: DefaultWalletPolicy }> {
    const fingerprint = await this.makeRequest(
      PROTOCOL.GET_MASTER_FINGERPRINT,
      new Uint8Array(),
      signal,
    );
    assert(fingerprint.length === 4, "Invalid device fingerprint");
    // Account export is always displayed, including recovery indices outside conventional gaps.
    const encoded = concat(
      Uint8Array.of(1, 3),
      u32be(0x80000000 + 86),
      u32be(0x80000000 + networkConfig(this.network).coinType),
      u32be(0x80000000 + account),
    );
    const xpub = ascii(
      await this.makeRequest(PROTOCOL.GET_EXTENDED_PUBKEY, encoded, signal),
      120,
    );
    const parsed = parseAccountXpub(xpub, fingerprint, this.network, account);
    return {
      account: parsed.account,
      policy: createPrlWalletPolicy(parsed.account, xpub),
    };
  }
  private accountKey(account: AccountPublicKey): string {
    return `${account.network}:${account.account}:${hex(account.masterFingerprint)}:${hex(account.publicKey)}:${hex(account.chainCode)}`;
  }
  private cachePolicy(account: AccountPublicKey, policy: DefaultWalletPolicy) {
    if (this.policyCache.size >= 16)
      this.policyCache.delete(this.policyCache.keys().next().value!);
    this.policyCache.set(this.accountKey(account), policy);
  }
  exportAccount(
    account: number,
    signal?: AbortSignal,
  ): Promise<AccountPublicKey> {
    checkedIndex(account);
    return this.run(async (active) => {
      await this.readNetworkInfo(active);
      const result = await this.readAccount(account, active);
      this.cachePolicy(result.account, result.policy);
      return snapshotAccount(result.account);
    }, signal);
  }
  private async policyFor(account: AccountPublicKey, signal: AbortSignal) {
    const cached = this.policyCache.get(this.accountKey(account));
    if (cached) {
      const fingerprint = await this.makeRequest(
        PROTOCOL.GET_MASTER_FINGERPRINT,
        new Uint8Array(),
        signal,
      );
      assert(
        equal(fingerprint, account.masterFingerprint),
        "Device master fingerprint changed",
      );
      return cached;
    }
    const actual = await this.readAccount(account.account, signal);
    assertSameAccount(actual.account, account);
    this.cachePolicy(account, actual.policy);
    return actual.policy;
  }
  verifyAddress(
    account: AccountPublicKey,
    branch: 0 | 1,
    index: number,
    signal?: AbortSignal,
  ): Promise<string> {
    const approved = snapshotAccount(account);
    assert(approved.network === this.network, "Wrong account network");
    checkedBranch(branch);
    checkedIndex(index);
    const expected = deriveAddress(approved, branch, index).address;
    return this.run(async (active) => {
      await this.readNetworkInfo(active);
      const policy = await this.policyFor(approved, active);
      const interpreter = new ClientCommandInterpreter();
      interpreter.addKnownWalletPolicy(policy);
      const address = ascii(
        await this.makeRequest(
          PROTOCOL.GET_WALLET_ADDRESS,
          concat(
            Uint8Array.of(1),
            policy.getId(),
            new Uint8Array(32),
            Uint8Array.of(branch),
            u32be(index),
          ),
          active,
          interpreter,
        ),
        90,
      );
      assert(
        address === expected,
        "Device address differs from independently derived PRL address",
      );
      return address;
    }, signal);
  }
  displayAddress(
    account: AccountPublicKey,
    branch: 0 | 1,
    index: number,
    signal?: AbortSignal,
  ) {
    return this.verifyAddress(account, branch, index, signal);
  }
  private async signPrepared(
    psbt: PrlPsbtV2,
    bundle: SigningBundle,
    account: AccountPublicKey,
    options: SigningOptions,
  ): Promise<PrlFinalizedTransaction> {
    let durabilityFailed = false;
    let completed: FinalizedTransaction | undefined;
    try {
      return await this.run(async (active) => {
        await this.readNetworkInfo(active);
        const walletPolicy = await this.policyFor(account, active);
        const interpreter = new ClientCommandInterpreter();
        interpreter.addKnownWalletPolicy(walletPolicy);
        const globalMap = merkleMap(psbt.globalMap),
          inputMaps = psbt.inputMaps.map(merkleMap),
          outputMaps = psbt.outputMaps.map(merkleMap);
        interpreter.addKnownMapping(globalMap);
        for (const map of inputMaps) interpreter.addKnownMapping(map);
        for (const map of outputMaps) interpreter.addKnownMapping(map);
        const inputCommitments = inputMaps.map((m) => m.commitment()),
          outputCommitments = outputMaps.map((m) => m.commitment());
        interpreter.addKnownList(inputCommitments);
        const inputRoot = new Merkle(
          inputCommitments.map((m) => hashLeaf(m)),
        ).getRoot();
        interpreter.addKnownList(outputCommitments);
        const outputRoot = new Merkle(
          outputCommitments.map((m) => hashLeaf(m)),
        ).getRoot();
        const partials: PrlPartialSignature[] = [],
          seen = new Set<number>();
        options.onProgress?.("transfer", 1, 1);
        options.onProgress?.("review", 0, 1);
        const result = await this.makeRequest(
          PROTOCOL.SIGN_PSBT,
          concat(
            globalMap.commitment(),
            compactSize(inputMaps.length),
            inputRoot,
            compactSize(outputMaps.length),
            outputRoot,
            walletPolicy.getId(),
            new Uint8Array(32),
          ),
          active,
          interpreter,
          async (bytes) => {
            const partial = parseYieldedSignature(bytes),
              input = bundle.inputs[partial.inputIndex];
            assert(
              input !== undefined && !seen.has(partial.inputIndex),
              "Duplicate or unexpected signature index",
            );
            assert(
              equal(partial.pubkey, input.scriptPubKey.slice(2)) &&
                verifySignature(bundle, partial.inputIndex, partial.signature),
              "Device signature failed independent verification",
            );
            seen.add(partial.inputIndex);
            partials.push(partial);
            if (partials.length === bundle.inputs.length) {
              completed = verifyAndFinalize(bundle, account, partials);
              // Pass a separate copy: callbacks must not mutate the retained recovery result.
              let durabilityTimer: ReturnType<typeof setTimeout> | undefined;
              try {
                if (options.onVerifiedSigned) {
                  await Promise.race([
                    options.onVerifiedSigned(
                      verifyAndFinalize(bundle, account, partials),
                    ),
                    new Promise<never>((_, reject) => {
                      durabilityTimer = setTimeout(
                        () =>
                          reject(
                            new Error("Signed-transaction storage timed out"),
                          ),
                        this.durabilityTimeoutMs,
                      );
                    }),
                  ]);
                }
              } catch (error) {
                durabilityFailed = true;
                throw error;
              } finally {
                if (durabilityTimer !== undefined)
                  clearTimeout(durabilityTimer);
              }
            }
            options.onProgress?.(
              "signatures",
              partials.length,
              bundle.inputs.length,
            );
          },
        );
        assert(result.length === 0, "Unexpected SIGN_PSBT result payload");
        assert(completed !== undefined, "Missing native signature");
        return completed;
      }, options.signal);
    } catch (error) {
      if (completed !== undefined) {
        if (durabilityFailed)
          throw new VerifiedSigningResultError(completed, error);
        return {
          ...completed,
          completionWarning: "device-acknowledgement-unconfirmed",
        };
      }
      throw error;
    }
  }
  signBundle(
    bundle: SigningBundle,
    account: AccountPublicKey,
    options: SigningOptions = {},
  ): Promise<PrlFinalizedTransaction> {
    const approved = snapshotAccount(account),
      snapshot = snapshotBundle(bundle, approved);
    assert(snapshot.network === this.network, "Wrong signing network");
    const psbt = buildPrlPsbt(snapshot, approved, options);
    // All caller-owned bytes/options affecting signing are copied before the first await.
    return this.signPrepared(
      parsePrlPsbt(serializePrlPsbt(psbt), approved).psbt,
      snapshot,
      approved,
      {
        ...(options.signal ? { signal: options.signal } : {}),
        ...(options.onProgress ? { onProgress: options.onProgress } : {}),
        ...(options.onVerifiedSigned
          ? { onVerifiedSigned: options.onVerifiedSigned }
          : {}),
      },
    );
  }
  async signTransaction(
    bundle: SigningBundle,
    account: AccountPublicKey,
    options: SigningOptions = {},
  ): Promise<readonly Uint8Array[]> {
    return (await this.signBundle(bundle, account, options)).signatures;
  }
  /** Imported PSBTs face the identical narrow semantic and ownership checks. */
  signPsbt(
    bytes: Uint8Array,
    account: AccountPublicKey,
    options: Omit<SigningOptions, "previousTransactions"> = {},
  ): Promise<PrlFinalizedTransaction> {
    const approved = snapshotAccount(account);
    assert(approved.network === this.network, "Wrong account network");
    const parsed = parsePrlPsbt(bytes, approved);
    return this.signPrepared(parsed.psbt, parsed.bundle, approved, {
      ...(options.signal ? { signal: options.signal } : {}),
      ...(options.onProgress ? { onProgress: options.onProgress } : {}),
      ...(options.onVerifiedSigned
        ? { onVerifiedSigned: options.onVerifiedSigned }
        : {}),
    });
  }
  async close(): Promise<void> {
    assert(this.state !== "busy", "Cancel the active operation before closing");
    if (this.state === "closed") return;
    this.state = "closed";
    this.policyCache.clear();
    await this.closeTransport();
  }
}
const networkConfig = network;
