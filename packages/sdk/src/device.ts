import { readBoundedJson } from "./http.js";
import {
  assert,
  concat,
  equal,
  hex,
  fromHex,
  Reader,
  u16,
  u32,
} from "./bytes.js";
import {
  network,
  networkFromId,
  checkedBranch,
  checkedIndex,
  type NetworkName,
} from "./network.js";
import {
  deriveAddress,
  sha256,
  validateAccount,
  validateP2trScript,
  type AccountPublicKey,
} from "./keys.js";
import {
  decodeBundle,
  encodeBundle,
  MAX_BUNDLE_SIZE,
  MAX_INPUTS,
  validateBundle,
  type SigningBundle,
} from "./bundle.js";
import {
  finalizeTransaction,
  verifySignature,
  type FinalizedTransaction,
} from "./transaction.js";
/** Returns response data followed by the two-byte status word. Never retries commands. */
export interface ApduTransport {
  exchange(apdu: Uint8Array, signal?: AbortSignal): Promise<Uint8Array>;
  close?(): Promise<void>;
}
export const INS = Object.freeze({
  CAPABILITIES: 0x00,
  EXPORT_ACCOUNT: 0x01,
  VERIFY_ADDRESS: 0x02,
  BEGIN: 0x10,
  APPEND: 0x11,
  REVIEW: 0x12,
  SIGNATURE: 0x13,
  ABORT: 0x14,
});
export interface Capabilities {
  protocol: 1;
  version: string;
  network: NetworkName;
  maxInputs: number;
  maxBundleSize: number;
}
export class DeviceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly instruction?: number,
  ) {
    super(message);
    this.name = "DeviceError";
  }
}
export function command(
  ins: number,
  data: Uint8Array = new Uint8Array(),
): Uint8Array {
  assert(
    Number.isInteger(ins) && ins >= 0 && ins <= 255,
    "Invalid instruction",
  );
  assert(data.length <= 255, "APDU data exceeds short command limit");
  return concat(Uint8Array.of(0xe0, ins, 0, 0, data.length), data);
}
function aborted(signal?: AbortSignal): void {
  if (signal?.aborted)
    throw new DeviceError("Operation cancelled; session is terminal");
}
/** Fail-closed one-operation-at-a-time adapter. A failed client must reset explicitly. */
export class LedgerPearlClient {
  private state: "ready" | "busy" | "failed" | "closed" = "ready";
  private readonly timeoutMs: number;
  constructor(
    readonly transport: ApduTransport,
    readonly network: NetworkName,
    options: { timeoutMs?: number } = {},
  ) {
    networkConfig(network);
    this.timeoutMs = options.timeoutMs ?? 120_000;
    assert(
      Number.isSafeInteger(this.timeoutMs) && this.timeoutMs > 0,
      "Invalid device timeout",
    );
  }
  get sessionState() {
    return this.state;
  }
  private async exchange(
    ins: number,
    data: Uint8Array = new Uint8Array(),
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    aborted(signal);
    // The adapter should honor cancellation, but a late/ignored signal must not
    // permit the protocol state machine to resume and fetch a signature.
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let rejectAbort: (() => void) | undefined;
    const cancelled = new Promise<never>((_, reject) => {
      rejectAbort = () =>
        reject(
          new DeviceError(
            "Device operation cancelled or timed out; session is terminal",
          ),
        );
      controller.signal.addEventListener("abort", rejectAbort, { once: true });
    });
    let response: Uint8Array;
    try {
      response = await Promise.race([
        this.transport.exchange(command(ins, data), controller.signal),
        cancelled,
      ]);
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (rejectAbort)
        controller.signal.removeEventListener("abort", rejectAbort);
    }
    aborted(signal);
    assert(
      response instanceof Uint8Array &&
        response.length >= 2 &&
        response.length <= 4096,
      "Malformed APDU response",
    );
    const status =
      response[response.length - 2]! * 256 + response[response.length - 1]!;
    if (status !== 0x9000)
      throw new DeviceError(
        `Device rejected command (0x${status.toString(16)})`,
        status,
        ins,
      );
    return Uint8Array.from(response.subarray(0, -2));
  }
  private async closeTransport(): Promise<void> {
    if (!this.transport.close) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        this.transport.close(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new DeviceError("Transport cleanup timed out")),
            Math.min(this.timeoutMs, 5_000),
          );
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
  private async run<T>(fn: () => Promise<T>): Promise<T> {
    assert(
      this.state === "ready",
      `Device client is ${this.state}; no command sent`,
    );
    this.state = "busy";
    try {
      const result = await fn();
      this.state = "ready";
      return result;
    } catch (error) {
      this.state = "failed"; // A transport timeout/cancel may leave the peer mid-review. Close, never send a concurrent abort.
      try {
        await this.closeTransport();
      } catch {}
      throw error;
    }
  }
  private async readCapabilities(signal?: AbortSignal): Promise<Capabilities> {
    const r = new Reader(
      await this.exchange(INS.CAPABILITIES, undefined, signal),
    );
    assert(r.byte() === 1, "Unsupported app protocol");
    const version = `${r.byte()}.${r.byte()}.${r.byte()}`;
    const name = networkFromId(r.byte()),
      maxInputs = r.byte(),
      maxBundleSize = r.u16();
    r.end();
    assert(name === this.network, "Wrong device network");
    assert(
      maxInputs === MAX_INPUTS && maxBundleSize === MAX_BUNDLE_SIZE,
      "Unsupported protocol limits",
    );
    return { protocol: 1, version, network: name, maxInputs, maxBundleSize };
  }
  capabilities(signal?: AbortSignal) {
    return this.run(() => this.readCapabilities(signal));
  }
  exportAccount(
    account: number,
    signal?: AbortSignal,
  ): Promise<AccountPublicKey> {
    checkedIndex(account);
    return this.run(async () => {
      await this.readCapabilities(signal);
      const r = new Reader(
        await this.exchange(INS.EXPORT_ACCOUNT, u32(account), signal),
      );
      const result = {
        masterFingerprint: r.take(4),
        publicKey: r.take(33),
        chainCode: r.take(32),
        network: networkFromId(r.byte()),
        account: r.u32(),
      };
      r.end();
      assert(
        result.network === this.network && result.account === account,
        "Device account metadata mismatch",
      );
      validateAccount(result);
      return result;
    });
  }
  verifyAddress(
    account: AccountPublicKey,
    branch: 0 | 1,
    index: number,
    signal?: AbortSignal,
  ): Promise<string> {
    validateAccount(account);
    assert(account.network === this.network, "Wrong account network");
    checkedBranch(branch);
    checkedIndex(index);
    const expected = deriveAddress(account, branch, index).address;
    const accountIndex = account.account;
    return this.run(async () => {
      await this.readCapabilities(signal);
      const bytes = await this.exchange(
        INS.VERIFY_ADDRESS,
        concat(u32(accountIndex), Uint8Array.of(branch), u32(index)),
        signal,
      );
      assert(
        bytes.length >= 14 &&
          bytes.length <= 90 &&
          bytes.every((b) => b >= 33 && b <= 126),
        "Invalid device address",
      );
      const address = new TextDecoder("ascii", { fatal: true }).decode(bytes);
      assert(
        address === expected,
        "Device-derived address differs from approved public account",
      );
      return address;
    });
  }
  signBundle(
    bundle: SigningBundle,
    account: AccountPublicKey,
    options: {
      signal?: AbortSignal;
      onProgress?: (
        phase: "transfer" | "review" | "signatures",
        completed: number,
        total: number,
      ) => void;
    } = {},
  ): Promise<FinalizedTransaction> {
    // Snapshot before any await: callers cannot mutate recipient/path/amount during approval.
    validateBundle(bundle, account);
    // PRL1 prototype firmware supports P2TR recipients only. P2MR requires the
    // versioned Ledger Bitcoin PRL adapter and its explicit capability binding.
    bundle.outputs.forEach((output) => validateP2trScript(output.scriptPubKey));
    assert(bundle.network === this.network, "Wrong signing network");
    const bytes = encodeBundle(bundle),
      snapshot = decodeBundle(bytes),
      digest = sha256(bytes),
      signal = options.signal;
    return this.run(async () => {
      await this.readCapabilities(signal);
      assert(
        (
          await this.exchange(
            INS.BEGIN,
            concat(u16(bytes.length), digest),
            signal,
          )
        ).length === 0,
        "Unexpected BEGIN payload",
      );
      for (let offset = 0; offset < bytes.length; offset += 253) {
        assert(
          (
            await this.exchange(
              INS.APPEND,
              concat(u16(offset), bytes.slice(offset, offset + 253)),
              signal,
            )
          ).length === 0,
          "Unexpected APPEND payload",
        );
        options.onProgress?.(
          "transfer",
          Math.min(offset + 253, bytes.length),
          bytes.length,
        );
      }
      options.onProgress?.("review", 0, 1);
      const review = new Reader(
        await this.exchange(INS.REVIEW, undefined, signal),
      );
      assert(
        review.byte() === snapshot.inputs.length,
        "Device signature count mismatch",
      );
      assert(
        equal(review.take(32), digest),
        "Device approved a different bundle",
      );
      review.end();
      const signatures: Uint8Array[] = [];
      for (let index = 0; index < snapshot.inputs.length; index++) {
        const signature = await this.exchange(
          INS.SIGNATURE,
          Uint8Array.of(index),
          signal,
        );
        assert(
          verifySignature(snapshot, index, signature),
          `Device signature ${index} failed independent verification`,
        );
        signatures.push(signature);
        options.onProgress?.("signatures", index + 1, snapshot.inputs.length);
      }
      return finalizeTransaction(snapshot, signatures);
    });
  }
  /** Explicit recovery only after transport has been reconnected/reset by its owner. */
  async reset(): Promise<void> {
    assert(
      this.state !== "busy" && this.state !== "closed",
      "Cannot reset active/closed client",
    );
    this.state = "busy";
    try {
      const response = await this.exchange(INS.ABORT);
      assert(response.length === 0, "Unexpected ABORT payload");
      this.state = "ready";
    } catch (error) {
      this.state = "failed";
      throw error;
    }
  }
  async close(): Promise<void> {
    assert(this.state !== "busy", "Cancel the active operation first");
    if (this.state === "closed") return;
    const shouldAbort = this.state === "ready";
    // Claim terminal ownership synchronously, before either async transport call.
    this.state = "closed";
    try {
      if (shouldAbort) {
        try {
          await this.exchange(INS.ABORT);
        } catch {
          /* Terminal either way. */
        }
      }
    } finally {
      await this.closeTransport();
    }
  }
}
const networkConfig = network;
/** Development-only emulator transport, restricted to loopback and no URL credentials. */
export class SpeculosTransport implements ApduTransport {
  private closed = false;
  readonly url: string;
  constructor(
    url = "http://127.0.0.1:5000",
    readonly timeoutMs = 120_000,
    private readonly fetcher: typeof fetch = fetch,
  ) {
    const parsed = new URL(url);
    assert(
      parsed.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) &&
        !parsed.username &&
        !parsed.password &&
        !parsed.search &&
        !parsed.hash &&
        (parsed.pathname === "/" || parsed.pathname === ""),
      "Speculos must be a plain loopback HTTP endpoint",
    );
    assert(Number.isSafeInteger(timeoutMs) && timeoutMs > 0, "Invalid timeout");
    this.url = parsed.origin;
  }
  async exchange(apdu: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    assert(!this.closed, "Speculos transport is closed");
    aborted(signal);
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const response = await this.fetcher(`${this.url}/apdu`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: hex(apdu) }),
      signal: combined,
      redirect: "error",
    });
    assert(response.ok, `Speculos HTTP ${response.status}`);
    const json: unknown = await readBoundedJson(response, 8192);
    assert(
      json !== null &&
        typeof json === "object" &&
        typeof (json as { data?: unknown }).data === "string",
      "Malformed Speculos response",
    );
    const result = fromHex((json as { data: string }).data);
    assert(result.length <= 4096, "Oversized Speculos response");
    return result;
  }
  async close() {
    this.closed = true;
  }
}
