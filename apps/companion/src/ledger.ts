import {
  ApduBuilder,
  CommandResultFactory,
  DeviceManagementKitBuilder,
  isSuccessCommandResult,
  type ApduResponse,
  type Command,
  type CommandResult,
  type DeviceManagementKit,
} from "@ledgerhq/device-management-kit";
import { webHidTransportFactory } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom, take, timeout } from "rxjs";
import { assert, concat, type ApduTransport } from "@pearl-ledger/sdk";

export type PearlDeviceProtocol = "prl1" | "bitcoin-prl";

/** Real DMK custom-command adapter. No LedgerJS, fake device, software key or signing fallback. */
export class PearlCommand implements Command<Uint8Array> {
  readonly name: string;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array, protocol: PearlDeviceProtocol = "prl1") {
    this.name =
      protocol === "bitcoin-prl"
        ? "Pearl Bitcoin-based PSBT protocol"
        : "Pearl protocol v1";
    assert(
      bytes.length >= 5 && bytes.length === 5 + bytes[4]!,
      "Invalid short APDU",
    );
    const legacy =
      protocol === "prl1" &&
      bytes[0] === 0xe0 &&
      bytes[2] === 0 &&
      bytes[3] === 0 &&
      [0, 1, 2, 0x10, 0x11, 0x12, 0x13, 0x14].includes(bytes[1]!);
    const bitcoinPrl =
      protocol === "bitcoin-prl" &&
      bytes[2] === 0 &&
      bytes[3] === 1 &&
      ((bytes[0] === 0xe1 && [0, 3, 4, 5, 6].includes(bytes[1]!)) ||
        (bytes[0] === 0xf8 && bytes[1] === 1));
    assert(legacy || bitcoinPrl, "Unsupported Pearl command or protocol");
    this.bytes = bytes.slice();
  }
  getApdu() {
    return new ApduBuilder({
      cla: this.bytes[0]!,
      ins: this.bytes[1]!,
      p1: this.bytes[2]!,
      p2: this.bytes[3]!,
    })
      .addBufferToData(this.bytes.slice(5))
      .build();
  }
  parseResponse(response: ApduResponse): CommandResult<Uint8Array> {
    assert(response.statusCode.length === 2, "Malformed device status");
    // Preserve exact status; the protocol SDK handles rejection and wipes/fails the session.
    return CommandResultFactory({
      data: concat(response.data, response.statusCode),
    });
  }
}
export class DmkPearlTransport implements ApduTransport {
  private closed = false;
  private busy = false;
  private readonly terminal = new AbortController();
  private readonly disconnected = () => {
    void this.close();
    this.onDisconnect?.();
  };
  constructor(
    private readonly dmk: DeviceManagementKit,
    private readonly sessionId: string,
    private readonly disconnectEvents:
      | EventTarget
      | undefined = typeof navigator !== "undefined"
      ? (navigator as Navigator & { hid?: EventTarget }).hid
      : undefined,
    private readonly onDisconnect?: () => void,
    private readonly protocol: PearlDeviceProtocol = "prl1",
    private readonly destroyTransport?: () => void,
  ) {
    this.disconnectEvents?.addEventListener("disconnect", this.disconnected);
  }
  async exchange(apdu: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    assert(!this.closed && !this.busy, "Device session closed or busy");
    if (signal?.aborted) {
      await this.close();
      throw new Error("Device operation cancelled; reconnect before retrying");
    }
    signal = AbortSignal.any([
      this.terminal.signal,
      ...(signal ? [signal] : []),
    ]);
    this.busy = true;
    let abort: (() => void) | undefined;
    try {
      const command = this.dmk.sendCommand({
        sessionId: this.sessionId,
        command: new PearlCommand(apdu, this.protocol),
        abortTimeout: 120_000,
      });
      const cancellation = new Promise<never>((_, reject) => {
        abort = () => {
          void this.close();
          reject(
            new Error(
              "Device operation cancelled; any signed payment stays reserved",
            ),
          );
        };
        signal?.addEventListener("abort", abort, { once: true });
        // A library callback may close the transport synchronously inside sendCommand.
        if (signal?.aborted) abort();
      });
      const result = await Promise.race([command, cancellation]);
      // In the PSBT protocol this response can contain the final signature
      // yield. If the response won the race, let the client verify/persist it
      // even when the transport closed in the same turn. The terminal latch
      // still rejects every subsequent APDU; no automatic retry is allowed.
      if (this.protocol === "prl1") assert(!this.closed, "Device disconnected");
      if (!isSuccessCommandResult(result))
        throw new Error(
          "Ledger transport failed. Unlock the device, open the matching Pearl app and reconnect.",
        );
      return result.data;
    } catch (error) {
      await this.close();
      throw error;
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      this.busy = false;
    }
  }
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.disconnectEvents?.removeEventListener("disconnect", this.disconnected);
    this.terminal.abort(
      new Error("Physical disconnect ended the Pearl session"),
    );
    try {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          this.dmk.disconnect({ sessionId: this.sessionId }),
          new Promise<void>((resolve) => {
            timer = setTimeout(resolve, 2_000);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch {
      /* already disconnected */
    }
    try {
      this.dmk.close();
    } catch {
      /* best-effort terminal cleanup */
    }
    try {
      this.destroyTransport?.();
    } catch {
      /* The terminal latch stays closed even if library cleanup fails. */
    }
  }
}
export async function connectLedger(
  onDisconnect?: () => void,
  protocol: PearlDeviceProtocol = "prl1",
): Promise<DmkPearlTransport> {
  assert(
    window.isSecureContext && "hid" in navigator,
    "WebHID is unavailable. Use desktop Chrome or Edge on localhost or HTTPS.",
  );
  let hidTransport: ReturnType<typeof webHidTransportFactory> | undefined;
  let destroyed = false;
  const destroyTransport = () => {
    if (destroyed) return;
    destroyed = true;
    // DMK close does not own WebHID factory listener teardown. The pinned
    // WebHID implementation exposes destroy(); keep this feature-detected
    // because the common DMK Transport interface does not declare it.
    if (
      hidTransport &&
      "destroy" in hidTransport &&
      typeof hidTransport.destroy === "function"
    )
      hidTransport.destroy();
  };
  const dmk = new DeviceManagementKitBuilder()
    .addTransport((...args) => {
      hidTransport = webHidTransportFactory(...args);
      return hidTransport;
    })
    .build();
  try {
    // Invocation starts inside the explicit Connect click, preserving browser device-picker activation.
    const device = await firstValueFrom(
      dmk.startDiscovering({}).pipe(take(1), timeout(60_000)),
    );
    await dmk.stopDiscovering();
    const sessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    return new DmkPearlTransport(
      dmk,
      sessionId,
      (navigator as Navigator & { hid: EventTarget }).hid,
      onDisconnect,
      protocol,
      destroyTransport,
    );
  } catch (error) {
    try {
      dmk.close();
    } finally {
      destroyTransport();
    }
    throw error;
  }
}
