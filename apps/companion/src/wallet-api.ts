import "./wallet-buffer.js";
import {
  Logger,
  WalletAPIClient,
  WindowMessageTransport,
} from "@ledgerhq/wallet-api-client";
import { Buffer } from "buffer";
import {
  assert,
  type ApduTransport,
  type NetworkName,
} from "@pearl-ledger/sdk";
import { assertPearlApdu, type PearlDeviceProtocol } from "./pearl-apdu.js";

/** Exact app names from apps/ledger-bitcoin-prl/Makefile. */
export const WALLET_APP_NAMES: Readonly<Record<NetworkName, string>> =
  Object.freeze({
    mainnet: "Pearl",
    testnet: "Pearl T1",
    testnet2: "Pearl T2",
    regtest: "Pearl Reg",
    simnet: "Pearl Sim",
  });

const REQUIRED_METHODS = [
  "device.transport",
  "device.exchange",
  "device.close",
];
const REOPEN =
  "Ledger Wallet cleanup is unresolved. Close and reopen the Pearl Live App.";
const CANCELLED =
  "Device operation cancelled; any signed payment stays reserved";

/** Native DMK failures may be plain objects; never expose their payloads. */
function nativeConnectionError(error: unknown): Error {
  if (error instanceof Error) return error;
  const tag =
    error && typeof error === "object"
      ? (Object.getOwnPropertyDescriptor(error, "_tag")?.value ??
        Object.getOwnPropertyDescriptor(error, "name")?.value)
      : undefined;
  switch (tag) {
    case "DeviceDisconnectedWhileSendingError":
    case "DeviceDisconnectedBeforeSendingApdu":
    case "DisconnectedDeviceDuringOperation":
    case "DisconnectedDevice":
      return new Error("Ledger disconnected. Reopen Pearl and reconnect.");
    case "SendApduTimeoutError":
    case "SendCommandTimeoutError":
      return new Error(
        "Ledger response timed out. Reopen Pearl and reconnect.",
      );
    case "ActionRefusedError":
    case "UserRefusedOnDevice":
      return new Error(
        "Request declined on your Ledger. Reopen Pearl and reconnect.",
      );
    default:
      return new Error("Ledger connection failed. Reopen Pearl and reconnect.");
  }
}

interface RawTransport {
  exchange(apdu: Buffer): Promise<Uint8Array>;
  close(): Promise<void>;
}
interface WalletConnection {
  capabilities(): Promise<string[]>;
  open(appName: string): Promise<RawTransport>;
  disconnect(): void;
}
interface Timeouts {
  open: number;
  exchange: number;
  close: number;
}
const TIMEOUTS: Timeouts = { open: 60_000, exchange: 120_000, close: 2_000 };

async function bounded<T>(
  promise: Promise<T>,
  ms: number,
  message: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export class WalletPearlTransport implements ApduTransport {
  private closed = false;
  private busy = false;
  private closing: Promise<void> | undefined;
  private pending: Promise<Uint8Array> | undefined;
  private readonly terminal = new AbortController();

  constructor(
    private readonly raw: RawTransport,
    private readonly finish: (pending?: Promise<Uint8Array>) => Promise<void>,
    private readonly protocol: PearlDeviceProtocol,
    private readonly exchangeTimeout: number,
  ) {}

  async exchange(apdu: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    assert(!this.closed && !this.busy, "Device session closed or busy");
    if (signal?.aborted) {
      await this.close();
      throw new Error(CANCELLED);
    }
    this.busy = true;
    const combined = AbortSignal.any([
      this.terminal.signal,
      ...(signal ? [signal] : []),
    ]);
    let abort: (() => void) | undefined;
    try {
      assertPearlApdu(apdu, this.protocol);
      // Do not use send(): 0xe000 is a normal PSBT continuation, not a transport error.
      this.pending = this.raw.exchange(Buffer.from(apdu));
      const cancellation = new Promise<never>((_, reject) => {
        abort = () => {
          void this.close();
          reject(new Error(CANCELLED));
        };
        combined.addEventListener("abort", abort, { once: true });
        if (combined.aborted) abort();
      });
      const response = await bounded(
        Promise.race([this.pending, cancellation]),
        this.exchangeTimeout,
        "Ledger response timed out; reconnect before retrying",
      );
      // A winning response can contain the final signature. Keep it for verification
      // and durable recovery even if abort fired in the same turn; never send an ACK.
      assert(
        response instanceof Uint8Array && response.length >= 2,
        "Malformed device response",
      );
      if (this.protocol === "prl1") assert(!this.closed, "Device disconnected");
      return Uint8Array.from(response);
    } catch (error) {
      await this.close();
      throw nativeConnectionError(error);
    } finally {
      if (abort) combined.removeEventListener("abort", abort);
      this.busy = false;
    }
  }

  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    // Store cleanup before abort, whose listener can re-enter close().
    this.closing = this.finish(this.pending);
    this.terminal.abort();
    return this.closing;
  }
}

/** One host transport ID is reused by Ledger Wallet, so every session shares this gate. */
export function createWalletConnector(
  createConnection: () => WalletConnection,
  timeouts: Timeouts = TIMEOUTS,
) {
  let occupied = false;
  let unresolved = false;
  return async function connect(
    // Wallet API exposes no device-disconnect event; host failures reject exchange.
    _onDisconnect: (() => void) | undefined,
    protocol: PearlDeviceProtocol,
    network: NetworkName,
  ): Promise<WalletPearlTransport> {
    const appName = WALLET_APP_NAMES[network];
    assert(
      typeof appName === "string",
      "Select a supported Pearl network before connecting",
    );
    assert(!unresolved, REOPEN);
    assert(
      !occupied,
      "Ledger Wallet is already connecting, connected or closing",
    );
    occupied = true;
    let connection: WalletConnection;
    try {
      connection = createConnection();
    } catch (error) {
      occupied = false;
      throw nativeConnectionError(error);
    }
    let opening: Promise<RawTransport> | undefined;
    let cleanup: Promise<void> | undefined;
    const finish = (pending?: Promise<Uint8Array>): Promise<void> => {
      if (cleanup) return cleanup;
      // Keep the host listener alive until a late open can be closed. A timeout
      // permanently locks this page, preventing old ID "1" RPCs touching a new session.
      const settled = (async () => {
        try {
          const raw = await opening?.catch(() => undefined);
          await Promise.all([
            raw?.close(),
            pending?.then(
              () => undefined,
              () => undefined,
            ),
          ]);
        } finally {
          connection.disconnect();
        }
      })();
      cleanup = bounded(settled, timeouts.close, REOPEN).then(
        () => {
          occupied = false;
        },
        () => {
          unresolved = true;
        },
      );
      return cleanup;
    };
    try {
      const methods = await bounded(
        connection.capabilities(),
        timeouts.open,
        "Ledger Wallet did not respond. Open Pearl inside Ledger Wallet.",
      );
      assert(
        REQUIRED_METHODS.every((method) => methods.includes(method)),
        "This Ledger Wallet host does not support Pearl device transport",
      );
      opening = connection.open(appName);
      const raw = await bounded(
        opening,
        timeouts.open,
        "Ledger connection timed out. Close the connection dialog and reopen Pearl.",
      );
      return new WalletPearlTransport(raw, finish, protocol, timeouts.exchange);
    } catch (error) {
      await finish();
      throw nativeConnectionError(error);
    }
  };
}

function nativeConnection(): WalletConnection {
  const host = window as Window & {
    ElectronWebview?: { postMessage?: unknown };
    ReactNativeWebView?: { postMessage?: unknown };
  };
  assert(
    typeof host.ElectronWebview?.postMessage === "function" ||
      typeof host.ReactNativeWebView?.postMessage === "function",
    "Open the Pearl Live App inside Ledger Wallet to connect",
  );
  // The pinned official client uses Buffer when decoding raw device.exchange.
  (globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer ??=
    Buffer;
  // Default SDK logging includes every raw APDU and response. Keep wallet data out of console logs.
  const logger = new Logger();
  logger.log = logger.warn = logger.debug = logger.error = () => {};
  const messages = new WindowMessageTransport(window, logger);
  const requests = new Set<string>();
  const send = messages.send;
  messages.send = (message: string) => {
    // The official client serializes requests before this public boundary.
    const request = JSON.parse(message) as { id?: unknown; method?: unknown };
    const id =
      typeof request.method === "string" && typeof request.id === "string"
        ? request.id
        : undefined;
    if (id) requests.add(id);
    try {
      send(message);
    } catch (error) {
      if (id) requests.delete(id);
      throw error;
    }
  };
  const receive = messages._onMessageEvent;
  messages._onMessageEvent = (event: MessageEvent) => {
    // Desktop replies come from Ledger Wallet's file:// renderer. Mobile
    // dispatches native events without a Window source. Never accept web peers.
    const desktop = typeof host.ElectronWebview?.postMessage === "function";
    if (
      !(desktop
        ? event.origin === "null"
        : event.source === null &&
          (event.origin === "" || event.origin === "null"))
    )
      return;
    if (typeof event.data !== "string") return;
    let message: unknown;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message !== "object" || Array.isArray(message))
      return;
    // Stale replies can arrive after native transport ID "1" has been reused.
    // The pinned SDK throws an unhandled rejection for an unknown RPC ID.
    // Leave host requests/notifications to its normal handler; only consume a
    // response once, and only when this connection actually sent its request.
    if (!("method" in message)) {
      if (
        !("id" in message) ||
        typeof message.id !== "string" ||
        !requests.delete(message.id)
      )
        return;
    }
    receive(event);
  };
  const client = new WalletAPIClient(messages, logger);
  messages.connect();
  return {
    capabilities: () => client.wallet.capabilities(),
    // Omitting appName makes the host request BOLOS and return to the dashboard.
    // Never identify Pearl as a supported host currency or open another app as fallback.
    open: (appName) => client.device.transport({ appName }),
    disconnect: () => {
      try {
        messages.disconnect();
      } finally {
        requests.clear();
      }
    },
  };
}

export const connectWalletLedger = createWalletConnector(nativeConnection);
