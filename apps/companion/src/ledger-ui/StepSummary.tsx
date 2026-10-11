// Adapted from Ledger Wallet 4.23.0 StepSummary's From/To and amount/fees/total rows.
import React from "react";
import { Html } from "./ModalBody.js";
export default function StepSummary({
  accountName,
  recipient,
  amount,
  fee,
  total,
  network,
  details,
  warning,
}: {
  accountName: string;
  recipient: string;
  amount: string;
  fee: string;
  total: string;
  network: string;
  details: string;
  warning: string;
}) {
  return (
    <div className="ledger-summary">
      {warning && <div className="notice error">{warning}</div>}
      <div className="ledger-from-to">
        <div>
          <span className="ledger-label">From</span>
          <p>{accountName}</p>
        </div>
        <div>
          <span className="ledger-label">To</span>
          <p className="ledger-recipient" data-testid="recipient-address">
            {recipient}
          </p>
        </div>
      </div>
      <div className="ledger-separator" />
      <div className="ledger-summary-row">
        <span className="ledger-label">Amount</span>
        <span data-testid="transaction-amount">{amount}</span>
      </div>
      <div className="ledger-summary-row">
        <span className="ledger-label">Network fees</span>
        <span>{fee}</span>
      </div>
      <div className="ledger-separator" />
      <div className="ledger-summary-row">
        <span className="ledger-label">Total to debit</span>
        <span>{total}</span>
      </div>
      <div className="ledger-summary-row">
        <span className="ledger-label">Network</span>
        <span>{network}</span>
      </div>
      <Html text={details} />
    </div>
  );
}
