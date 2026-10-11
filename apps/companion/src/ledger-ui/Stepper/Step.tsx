// Adapted from Ledger Wallet 4.23.0; see vendor/ledger-live-4.23.0.
import React from "react";
export type Status = "next" | "active" | "valid" | "error" | "disable";
export default function Step({
  number,
  status,
  children,
}: {
  number: number;
  status: Status;
  children: React.ReactNode;
}) {
  return (
    <div
      className="ledger-step"
      data-status={status}
      aria-current={status === "active" ? "step" : undefined}
    >
      <span className="ledger-step-number">
        {status === "active" || status === "next"
          ? number
          : status === "valid"
            ? "✓"
            : "×"}
      </span>
      <span className="ledger-step-label">{children}</span>
    </div>
  );
}
