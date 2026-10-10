import React from "react";
import { renderToStaticMarkup } from "react-dom/server.edge";
import ModalBody, { Html } from "./ModalBody.js";
import StepRecipient from "./StepRecipient.js";
import StepAmount from "./StepAmount.js";
import StepSummary from "./StepSummary.js";
import StepReceiveFunds from "./StepReceiveFunds.js";
const sendSteps = ["Recipient", "Amount", "Summary", "Device", "Confirmation"];
const markup = (view: React.ReactNode) =>
  renderToStaticMarkup(view).replaceAll('disabled=""', "disabled");
export function sendForm(props: {
  feedback: string;
  step: number;
  recipient: string;
  amount: string;
  fee: string;
  available: string;
  maxLabel: string;
  maxDisabled: boolean;
  feeHint: string;
  quotes: { blocks: number; label: string; disabled: boolean }[];
  quoteStatus: string;
  quotesSupported: boolean;
  accountName: string;
  network: string;
  advanced: string;
  busy: boolean;
}) {
  return markup(
    <ModalBody
      title="Send"
      steps={sendSteps}
      step={props.step}
      busy={props.busy}
      feedback={props.feedback}
    >
      <StepRecipient
        recipient={props.recipient}
        accountName={props.accountName}
        network={props.network}
        busy={props.busy}
        active={props.step === 0}
      />
      <StepAmount
        amount={props.amount}
        fee={props.fee}
        available={props.available}
        maxLabel={props.maxLabel}
        maxDisabled={props.maxDisabled}
        feeHint={props.feeHint}
        quotes={props.quotes}
        quoteStatus={props.quoteStatus}
        quotesSupported={props.quotesSupported}
        advanced={props.advanced}
        busy={props.busy}
        active={props.step === 1}
      />
    </ModalBody>,
  );
}
export function reviewFlow(
  props: React.ComponentProps<typeof StepSummary> & {
    feedback: string;
    stage: number;
    busy: boolean;
    actions: string;
    status: string;
  },
) {
  return markup(
    <ModalBody
      title="Send"
      steps={sendSteps}
      step={props.stage}
      busy={props.busy}
      feedback={props.feedback}
      footer={
        props.stage === 3 && props.busy ? undefined : (
          <>
            <Html text={props.actions} />
            <button id="back-payments" className="ghost" disabled={props.busy}>
              Back to activity
            </button>
          </>
        )
      }
    >
      {props.stage === 3 && (
        <div className="ledger-device">
          <h3>Verify transaction on device</h3>
        </div>
      )}
      {props.stage === 4 && (
        <h3 className="ledger-confirmation-title">{props.status}</h3>
      )}
      <div hidden={props.stage === 3}>
        <StepSummary {...props} />
      </div>
    </ModalBody>,
  );
}
export function receiveFlow(
  props: React.ComponentProps<typeof StepReceiveFunds> & { feedback: string },
) {
  return markup(
    <ModalBody
      title="Receive"
      steps={["Account", "Device", "Receive"]}
      step={props.stage}
      busy={props.busy}
      feedback={props.feedback}
    >
      <StepReceiveFunds {...props} />
    </ModalBody>,
  );
}
