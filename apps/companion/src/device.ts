import type { ApduTransport, NetworkName } from "@pearl-ledger/sdk";
import type { PearlDeviceProtocol } from "./ledger.js";

export interface PearlTransport extends ApduTransport {
  close(): Promise<void>;
}

type Host = "web" | "wallet";
type Connector = (
  onDisconnect: (() => void) | undefined,
  protocol: PearlDeviceProtocol,
  network: NetworkName,
) => Promise<PearlTransport>;
let configured: { host: Host; connect: Connector } | undefined;

/** Each entry registers only its own transport before loading the wallet. */
export function configureDevice(host: Host, connect: Connector): void {
  if (configured) throw new Error("Ledger transport is already configured");
  configured = { host, connect };
}

/** The entry URL selects the host explicitly. Never fall back to another signer. */
export function connectLedger(
  onDisconnect: (() => void) | undefined,
  protocol: PearlDeviceProtocol,
  network: NetworkName,
): Promise<PearlTransport> {
  const host = window.location.pathname === "/live.html" ? "wallet" : "web";
  if (!configured || configured.host !== host)
    return Promise.reject(
      new Error("Ledger transport does not match this page"),
    );
  // Invoke synchronously to retain the browser's user activation for WebHID.
  return configured.connect(onDisconnect, protocol, network);
}
