// Adapted from DefaultStepAmount and StepAmountFooter in Ledger Wallet 4.23.0.
import React from "react";
import { Action, Html } from "./ModalBody.js";
export default function StepAmount({
  amount,
  fee,
  available,
  maxLabel,
  maxDisabled,
  feeHint,
  quotes,
  quoteStatus,
  quotesSupported,
  advanced,
  busy,
  active,
}: {
  amount: string;
  fee: string;
  available: string;
  maxLabel: string;
  maxDisabled: boolean;
  feeHint: string;
  quotes: { blocks: number; label: string; disabled: boolean }[];
  quoteStatus: string;
  quotesSupported: boolean;
  advanced: string;
  busy: boolean;
  active: boolean;
}) {
  return (
    <section hidden={!active}>
      <div className="ledger-fields">
        <div className="field">
          <div className="ledger-field-label">
            <label htmlFor="amount">Amount</label>
            <button
              id="send-max"
              className="ghost"
              disabled={busy || maxDisabled}
            >
              {maxLabel}
            </button>
          </div>
          <div className="ledger-currency-input">
            <input
              id="amount"
              autoFocus={active}
              defaultValue={amount}
              readOnly={busy}
              inputMode="decimal"
              placeholder="0.00"
            />
            <span>PRL</span>
          </div>
          <p className="hint">Available: {available}</p>
        </div>
        <div className="field">
          <label htmlFor="fee">Network fees</label>
          <div className="ledger-currency-input">
            <input
              id="fee"
              defaultValue={fee}
              readOnly={busy}
              inputMode="decimal"
            />
            <span>PRL</span>
          </div>
          <p id="fee-policy" className="hint" aria-live="polite">
            {feeHint}
          </p>
          <div className="actions">
            {quotesSupported && (
              <button
                id="refresh-fees"
                className="ghost"
                disabled={busy || !quotesSupported}
              >
                Refresh estimates
              </button>
            )}
            {quotes.map((quote) => (
              <button
                key={quote.blocks}
                id={`fee-target-${quote.blocks}`}
                className="secondary"
                disabled={busy || quote.disabled}
              >
                {quote.label}
              </button>
            ))}
          </div>
          {quoteStatus && <p className="hint">{quoteStatus}</p>}
        </div>
        <Html text={advanced} />
      </div>
      <div className="ledger-step-footer">
        <button id="send-back-recipient" className="ghost" disabled={busy}>
          Back
        </button>
        <Action id="prepare" disabled={busy}>
          Continue
        </Action>
      </div>
    </section>
  );
}
