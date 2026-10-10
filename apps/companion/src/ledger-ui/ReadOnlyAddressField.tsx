// Adapted from Ledger Wallet 4.23.0. Browser clipboard authority stays in main.ts.
import React from "react";
const LINE_MINLENGTH = 5;
export default function ReadOnlyAddressField({
  address,
  allowCopy = true,
  busy = false,
}: {
  address: string;
  allowCopy?: boolean;
  busy?: boolean;
}) {
  const addressSegments = [
    address.slice(0, address.length - LINE_MINLENGTH),
    address.slice(-LINE_MINLENGTH),
  ];
  return (
    <div className="ledger-address-row">
      <div className="ledger-address" id="address-field">
        <span>{addressSegments[0]}</span>
        <span>{addressSegments[1]}</span>
      </div>
      <button
        id="copy-address"
        className="ledger-copy secondary"
        disabled={busy || !allowCopy}
      >
        Copy
      </button>
    </div>
  );
}
