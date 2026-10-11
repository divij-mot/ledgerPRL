import {
  ApduBuilder,
  CommandResultFactory,
  DeviceManagementKitBuilder,
  DeviceConnectionStateMachine,
  isSuccessCommandResult,
  type ApduResponse,
  type Command,
  type CommandResult,
  type DeviceManagementKit,
} from "@ledgerhq/device-management-kit";
import { WebHidTransport } from "@ledgerhq/device-transport-kit-web-hid";
import { firstValueFrom, take, timeout } from "rxjs";
import { assert, concat, type ApduTransport } from "@pearl-ledger/sdk";

import { assertPearlApdu, type PearlDeviceProtocol } from "./pearl-apdu.js";
export type { PearlDeviceProtocol } from "./pearl-apdu.js";

/** Real DMK custom-command adapter. No LedgerJS, fake device, software key or signing fallback. */
export class PearlCommand implements Command<Uint8Array> {
  readonly name: string;
  private readonly bytes: Uint8Array;
  constructor(bytes: Uint8Array, protocol: PearlDeviceProtocol = "prl1") {
    this.name =
      protocol === "bitcoin-prl"
        ? "Pearl Bitcoin-based PSBT protocol"
        : "Pearl protocol v1";
    assertPearlApdu(bytes, protocol);
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
  private closing?: Promise<void>;
  private busy = false;
  private readonly terminal = new AbortController();
  private readonly disconnected = (event: Event) => {
    if (
      !this.selectedDevice ||
      !("device" in event) ||
      event.device !== this.selectedDevice
    )
      return;
    void this.close().catch(() => {});
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
    private readonly selectedDevice?: object,
    private readonly closePhysical?: () => Promise<void>,
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
          void this.close().catch(() => {});
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
      await this.close().catch(() => {});
      throw error;
    } finally {
      if (abort) signal?.removeEventListener("abort", abort);
      this.busy = false;
    }
  }
  close(): Promise<void> {
    if (this.closing) return this.closing;
    this.closed = true;
    // Publish one cleanup promise before abort listeners can re-enter close().
    this.closing = Promise.resolve().then(() => this.cleanup());
    return this.closing;
  }
  private async cleanup(): Promise<void> {
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
    await this.closePhysical?.();
  }
}
// Failed owned cleanup blocks new connections in this page. An unobservable
// SDK physical close bars its exact handle. Discovery can precede cleanup;
// the next physical open must wait for it.
let activeTransport: DmkPearlTransport | undefined;
let cleanupBarrier: Promise<void> = Promise.resolve();
let connecting = false;
let cleanupUnknown = false;
const unobservedCloses = new WeakSet<object>();
const reloadMessage =
  "Ledger cleanup is incomplete. Reload this page before reconnecting.";

async function awaitPhysicalClose(close: Promise<void>): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      close,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(reloadMessage)), 2_000);
      }),
    ]);
  } catch {
    cleanupUnknown = true;
    throw new Error(reloadMessage);
  } finally {
    if (timer) clearTimeout(timer);
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
  assert(!connecting, "Ledger connection already in progress");
  assert(!cleanupUnknown, reloadMessage);
  connecting = true;
  cleanupBarrier = activeTransport?.close() ?? cleanupBarrier;
  activeTransport = undefined;
  void cleanupBarrier.catch(() => {});
  const events = (navigator as Navigator & { hid: EventTarget }).hid;
  let hidTransport: WebHidTransport | undefined;
  let selectedDevice: object | undefined;
  let rawClose: (() => Promise<void>) | undefined;
  let stopped = false;
  // The pinned SDK closes event.device before looking up its own connection.
  // That promise is not public, even for an unrelated HID device. Quarantine
  // subsequent opens of that exact handle rather than infer completion from
  // HIDDevice.opened. Other devices remain usable.
  const markPhysicalEvent = (event: Event) => {
    if (
      !("device" in event) ||
      !event.device ||
      typeof event.device !== "object" ||
      !("productId" in event.device) ||
      typeof event.device.productId !== "number"
    )
      return;
    unobservedCloses.add(event.device);
    if (event.device === selectedDevice) stopped = true;
  };
  events.addEventListener("disconnect", markPhysicalEvent);
  const destroyTransport = () => {
    stopped = true;
    try {
      hidTransport?.destroy();
    } catch (error) {
      cleanupUnknown = true;
      throw error;
    } finally {
      events.removeEventListener("disconnect", markPhysicalEvent);
    }
  };
  const closePhysical = async () => {
    if (rawClose) await awaitPhysicalClose(rawClose());
    assert(!cleanupUnknown, reloadMessage);
  };
  let dmk: DeviceManagementKit | undefined;
  try {
    dmk = new DeviceManagementKitBuilder()
      .addTransport(
        ({
          deviceModelDataSource,
          loggerServiceFactory,
          apduSenderServiceFactory,
          apduReceiverServiceFactory,
        }) => {
          hidTransport = new WebHidTransport(
            deviceModelDataSource,
            loggerServiceFactory,
            apduSenderServiceFactory,
            apduReceiverServiceFactory,
            (params) => {
              const device = params.deviceApduSender.getDependencies().device;
              selectedDevice = device;
              assert(!unobservedCloses.has(device), reloadMessage);
              const setupConnection =
                params.deviceApduSender.setupConnection.bind(
                  params.deviceApduSender,
                );
              params.deviceApduSender.setupConnection = async () => {
                const currentDevice =
                  params.deviceApduSender.getDependencies().device;
                assert(
                  currentDevice === device &&
                    !stopped &&
                    !unobservedCloses.has(currentDevice),
                  reloadMessage,
                );
                await setupConnection();
                assert(
                  !stopped && !unobservedCloses.has(device),
                  reloadMessage,
                );
              };
              let closing: Promise<void> | undefined;
              // Public sender lifecycle hook; never replace browser HID methods.
              // Memoization belongs to this connection, not the reusable handle.
              rawClose = () => {
                if (!closing) {
                  // The SDK owns an unobservable physical-event close; this
                  // branch is logical cleanup only. The handle stays barred.
                  closing = unobservedCloses.has(device)
                    ? Promise.resolve()
                    : Promise.resolve().then(() => device.close());
                  void closing.catch(() => {});
                }
                return closing;
              };
              const closeThisConnection = rawClose;
              params.deviceApduSender.closeConnection = () => {
                void closeThisConnection().catch(() => {});
              };
              return new DeviceConnectionStateMachine(params);
            },
          );
          return hidTransport;
        },
      )
      .build();
    // Start discovery in the Connect click; await cleanup only before opening.
    const discovery = firstValueFrom(
      dmk.startDiscovering({}).pipe(take(1), timeout(60_000)),
    );
    const device = await discovery;
    await dmk.stopDiscovering();
    await cleanupBarrier;
    assert(!cleanupUnknown, reloadMessage);
    const sessionId = await dmk.connect({
      device,
      sessionRefresherOptions: { isRefresherDisabled: true },
    });
    assert(
      selectedDevice &&
        rawClose &&
        !stopped &&
        !cleanupUnknown &&
        !unobservedCloses.has(selectedDevice),
      reloadMessage,
    );
    activeTransport = new DmkPearlTransport(
      dmk,
      sessionId,
      events,
      onDisconnect,
      protocol,
      destroyTransport,
      selectedDevice,
      closePhysical,
    );
    return activeTransport;
  } catch (error) {
    const cleanup = async () => {
      let failed = false;
      try {
        dmk?.close();
      } catch {
        failed = true;
      }
      try {
        destroyTransport();
      } catch {
        failed = true;
      }
      try {
        await closePhysical();
      } finally {
        if (failed) {
          cleanupUnknown = true;
          throw new Error(reloadMessage);
        }
      }
    };
    // Preserve a failed previous barrier; a failed new open owns its cleanup.
    const prior = cleanupBarrier;
    cleanupBarrier = Promise.all([prior, cleanup()]).then(() => undefined);
    await cleanupBarrier.catch(() => {});
    if (
      cleanupUnknown ||
      (selectedDevice && unobservedCloses.has(selectedDevice))
    )
      throw new Error(reloadMessage);
    throw error;
  } finally {
    connecting = false;
  }
}
