import { assert } from "@pearl-ledger/sdk";

export type PearlDeviceProtocol = "prl1" | "bitcoin-prl";

/** Shared allowlist for both native Wallet API and standalone WebHID. */
export function assertPearlApdu(
  bytes: Uint8Array,
  protocol: PearlDeviceProtocol,
): void {
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
}
