// Adapted from modals/Send/steps/StepRecipient.tsx; one PRL account replaces SelectAccount.
import React from "react";
import { Action } from "./ModalBody.js";
export default function StepRecipient({
  recipient,
  accountName,
  network,
  scanning,
  busy,
  active,
}: {
  recipient: string;
  accountName: string;
  network: string;
  scanning: boolean;
  busy: boolean;
  active: boolean;
}) {
  return (
    <section hidden={!active}>
      <div className="ledger-fields">
        <div className="field">
          <label>Account to debit</label>
          <div className="ledger-account-row">
            {accountName}
            <span>{network}</span>
          </div>
        </div>
        <div className="field">
          <label htmlFor="recipient">Recipient address</label>
          <input
            id="recipient"
            autoFocus={active}
            defaultValue={recipient}
            readOnly={busy}
            autoComplete="off"
            spellCheck={false}
            placeholder="Enter a Pearl address"
          />
          <div className="ledger-recipient-tools">
            <button id="scan-qr" className="ghost" disabled={busy}>
              Scan QR code
            </button>
            <label className="ledger-file-button">
              Choose QR image
              <input
                id="recipient-qr-file"
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
              />
            </label>
          </div>
          {scanning && (
            <video
              id="recipient-camera"
              className="ledger-qr-camera"
              autoPlay
              playsInline
              muted
              aria-label="QR camera preview"
            />
          )}
        </div>
      </div>
      <div className="ledger-step-footer">
        <Action id="recipient-continue" disabled={busy}>
          Continue
        </Action>
      </div>
    </section>
  );
}
