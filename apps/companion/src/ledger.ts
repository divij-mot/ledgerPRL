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

/** Real DMK custom-command adapter. No LedgerJS, fake device, software key or signing fallback. */
export class PearlCommand implements Command<Uint8Array> {
  readonly name = "Pearl protocol v1";
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array) {
    assert(
      bytes.length >= 5 && bytes.length === 5 + bytes[4]!,
      "Invalid short APDU",
    );
    assert(
      bytes[0] === 0xe0 &&
        bytes[2] === 0 &&
        bytes[3] === 0 &&
        [0, 1, 2, 0x10, 0x11, 0x12, 0x13, 0x14].includes(bytes[1]!),
      "Unsupported Pearl command",
    );
    this.bytes = bytes.slice();
  }
  getApdu() {
    return new ApduBuilder({
      cla: this.bytes[0]!,
      ins: this.bytes[1]!,
      p1: 0,
      p2: 0,
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
  constructor(
    private readonly dmk: DeviceManagementKit,
    private readonly sessionId: string,
  ) {}
  async exchange(apdu: Uint8Array, signal?: AbortSignal): Promise<Uint8Array> {
    assert(!this.closed && !this.busy, "Device session closed or busy");
    if (signal?.aborted) {
      await this.close();
      throw new Error("Device operation cancelled; reconnect before retrying");
    }
    this.busy = true;
    let abort: (() => void) | undefined;
    try {
      const command = this.dmk.sendCommand({
        sessionId: this.sessionId,
        command: new PearlCommand(apdu),
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
      });
      const result = await Promise.race([command, cancellation]);
      assert(!this.closed, "Device disconnected");
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
  }
}
export async function connectLedger(): Promise<DmkPearlTransport> {
  assert(
    window.isSecureContext && "hid" in navigator,
    "WebHID is unavailable. Use desktop Chrome or Edge on localhost or HTTPS.",
  );
  const dmk = new DeviceManagementKitBuilder()
    .addTransport(webHidTransportFactory)
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
    return new DmkPearlTransport(dmk, sessionId);
  } catch (error) {
    dmk.close();
    throw error;
  }
}
