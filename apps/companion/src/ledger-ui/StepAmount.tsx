// Adapted from Ledger Wallet's amount step and Bitcoin fee-selection pattern.
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
  quotesSupported,
  feeMode,
  feeTime,
  feeLoading,
  feeOptionsOpen,
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
  quotes: {
    blocks: number;
    label: string;
    disabled: boolean;
    selected?: boolean;
    time?: string;
  }[];
  quotesSupported: boolean;
  feeMode: string;
  feeTime: string;
  feeLoading: boolean;
  feeOptionsOpen: boolean;
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
        <details id="fee-options" className="ledger-fees" open={feeOptionsOpen}>
          <summary>
            <span>
              Network fees{" "}
              <small>
                <span id="fee-mode-label">{feeMode}</span>
                <span id="fee-time">{feeTime ? ` · ${feeTime}` : ""}</span>
              </small>
            </span>
            <span>
              <strong id="fee-total">
                {amount.trim() ? `${fee} PRL` : "—"}
              </strong>
              <span aria-hidden="true">⌄</span>
            </span>
          </summary>
          <div className="ledger-fee-options">
            <div className="ledger-fee-presets" aria-label="Fee options">
              <button
                id="fee-standard"
                className="secondary"
                aria-pressed={feeMode === "Standard"}
                disabled={busy}
              >
                Standard
              </button>
              {quotes.map((quote) => (
                <button
                  key={quote.blocks}
                  id={`fee-target-${quote.blocks}`}
                  className="secondary"
                  aria-pressed={quote.selected}
                  title={`Target: about ${quote.blocks} blocks`}
                  disabled={busy || quote.disabled}
                >
                  <span id={`fee-target-label-${quote.blocks}`}>
                    {quote.label}
                  </span>
                  <small id={`fee-target-time-${quote.blocks}`}>
                    {quote.time}
                  </small>
                </button>
              ))}
              <button
                id="fee-custom"
                className="secondary"
                aria-pressed={feeMode === "Custom"}
                disabled={busy}
              >
                Custom
              </button>
            </div>
            <div className="field" hidden={feeMode !== "Custom"}>
              <label htmlFor="fee">Custom total fee</label>
              <div className="ledger-currency-input">
                <input
                  id="fee"
                  defaultValue={fee}
                  readOnly={busy || feeMode !== "Custom"}
                  inputMode="decimal"
                />
                <span>PRL</span>
              </div>
            </div>
            <p id="fee-policy" className="hint" aria-live="polite">
              {feeHint}
            </p>
            <div className="ledger-fee-tools">
              {quotesSupported && (
                <button id="refresh-fees" className="ghost" disabled={busy}>
                  Refresh estimates
                </button>
              )}
              <button id="coin-control-open" className="ghost" disabled={busy}>
                Coin control
              </button>
            </div>
          </div>
        </details>
        <Html text={advanced} />
      </div>
      <div className="ledger-step-footer">
        <button id="send-back-recipient" className="ghost" disabled={busy}>
          Back
        </button>
        <Action
          id="prepare"
          disabled={busy || (feeLoading && feeMode !== "Custom")}
        >
          Continue
        </Action>
      </div>
    </section>
  );
}
