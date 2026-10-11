// Adapted from renderer/components/Modal/ModalBody.tsx (Ledger Wallet 4.23.0).
import React from "react";
import { Button } from "@ledgerhq/lumen-ui-react";
import Breadcrumb from "./Stepper/Breadcrumb.js";
export function Action({
  id,
  children,
  disabled = false,
}: {
  id: string;
  children: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <Button
      id={id}
      data-slot="lumen-button"
      className="ledger-button"
      appearance="accent"
      disabled={disabled}
    >
      {children}
    </Button>
  );
}
export default function ModalBody({
  title,
  steps,
  step,
  busy,
  children,
  footer,
  feedback,
}: {
  title: string;
  steps: string[];
  step: number;
  busy: boolean;
  children: React.ReactNode;
  footer?: React.ReactNode;
  feedback: string;
}) {
  return (
    <dialog
      id="ledger-flow"
      className="ledger-modal"
      aria-labelledby="ledger-flow-title"
    >
      <header className="ledger-modal-header">
        <h2 id="ledger-flow-title">{title}</h2>
        <button
          id="flow-close"
          className="ghost"
          disabled={busy}
          aria-label="Close"
        >
          Close
        </button>
      </header>
      <div className="ledger-modal-content">
        <Html text={feedback} />
        <Breadcrumb
          items={steps.map((label) => ({ label }))}
          currentStep={step}
        />
        {children}
      </div>
      {footer && <footer className="ledger-modal-footer">{footer}</footer>}
    </dialog>
  );
}
export function Html({ text }: { text: string }) {
  return <div dangerouslySetInnerHTML={{ __html: text }} />;
}
