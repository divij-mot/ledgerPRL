// Adapted from StepReceiveFunds' Receive1ShareAddress/Receive2Device subtrees.
import React from "react";
import { QRCodeSVG } from "qrcode.react";
import ReadOnlyAddressField from "./ReadOnlyAddressField.js";
import { Action } from "./ModalBody.js";
export default function StepReceiveFunds({
  accountName,
  address,
  network,
  verified,
  connected,
  busy,
  stage,
  rangeError,
  canNewAddress,
}: {
  accountName: string;
  address: string;
  network: string;
  verified: boolean;
  connected: boolean;
  busy: boolean;
  stage: number;
  rangeError: boolean;
  canNewAddress: boolean;
}) {
  return (
    <>
      <section hidden={stage !== 0}>
        <div className="ledger-fields">
          <label>Account to credit</label>
          <div className="ledger-account-row">
            {accountName}
            <span>{network}</span>
          </div>
        </div>
        <div className="ledger-step-footer">
          <Action id="receive-continue" disabled={busy}>
            Continue
          </Action>
        </div>
      </section>
      <section hidden={stage !== 1}>
        <div className="ledger-device">
          <h3>Verify address on device</h3>
          <p>Compare the address on your Ledger before approving.</p>
          <p className="ledger-recipient">{address}</p>
          {!connected && (
            <Action id="connect-inline" disabled={busy}>
              Connect Ledger
            </Action>
          )}
        </div>
        <div className="ledger-step-footer">
          <button id="receive-back" className="ghost" disabled={busy}>
            Back
          </button>
          <Action
            id="verify-receive"
            disabled={busy || !connected || rangeError}
          >
            Verify on Ledger
          </Action>
        </div>
      </section>
      <section hidden={stage !== 2}>
        <div className="ledger-fields">
          <h3>Address for {accountName}</h3>
          {verified && (
            <div className="ledger-receive-qr">
              <QRCodeSVG
                value={address}
                size={160}
                level="M"
                marginSize={0}
                title="Verified receive address"
                data-qrcode-address={address}
              />
            </div>
          )}
          <ReadOnlyAddressField
            address={address}
            allowCopy={verified}
            busy={busy}
          />
          <p className="hint">
            {verified
              ? "Address verified on your Ledger."
              : "Verify the address on your Ledger before using it."}
          </p>
          <button
            id="new-receive"
            className="ghost"
            disabled={busy || !verified || !canNewAddress}
          >
            New address
          </button>
        </div>
      </section>
      {rangeError && (
        <div className="notice error">
          This address index is outside the supported range. Check Settings →
          Advanced.
        </div>
      )}
    </>
  );
}
