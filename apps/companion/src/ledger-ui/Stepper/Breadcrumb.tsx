// Adapted from Ledger Wallet 4.23.0; status precedence is retained verbatim.
import React from "react";
import Step, { type Status } from "./Step.js";
type Item = { label?: React.ReactNode; excludeFromBreadcrumb?: boolean };
export default function Breadcrumb({
  items,
  currentStep,
  stepsDisabled = [],
  stepsErrors = [],
}: {
  items: Item[];
  currentStep: number;
  stepsDisabled?: number[];
  stepsErrors?: number[];
}) {
  return (
    <div className="ledger-breadcrumb" aria-label="Progress">
      {items
        .filter((i) => !i.excludeFromBreadcrumb)
        .map((item, i) => {
          let status: Status = "next";
          if (i === currentStep) status = "active";
          if (i < currentStep) status = "valid";
          if (stepsErrors.includes(i)) status = "error";
          if (stepsDisabled.includes(i)) status = "disable";
          return (
            <Step key={i} status={status} number={i + 1}>
              {item.label}
            </Step>
          );
        })}
    </div>
  );
}
