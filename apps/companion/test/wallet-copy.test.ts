import test from "node:test";
import assert from "node:assert/strict";
import { walletMessage } from "../src/wallet-copy.js";

test("device and source diagnostics have actionable display copy", () => {
  assert.match(
    walletMessage("Device rejected command (0x6985)"),
    /declined on your Ledger/,
  );
  assert.match(
    walletMessage("Unsupported PRL app/protocol"),
    /Open the Pearl app/,
  );
  assert.match(
    walletMessage(
      "Public indexer unavailable (HTTP 400); no balance update was applied",
    ),
    /Balance unavailable/,
  );
  assert.equal(
    walletMessage("Unknown failure with retained payment"),
    "Unknown failure with retained payment",
  );
});
test("copy never turns signature persistence or node acceptance into confirmation", () => {
  const saved = walletMessage(
    "Signed bytes were verified and saved, but the final device acknowledgement was not confirmed.",
  );
  assert.match(saved, /approved and saved/);
  assert.match(saved, /Check its status before sending/);
  assert.doesNotMatch(saved, /submitted|confirmed/);
  const failure = walletMessage(
    "Signing completed, but acknowledgement or signed-transaction storage failed; retain these signed bytes and reconcile before retrying",
  );
  assert.match(failure, /Keep this window open and download a backup/);
  assert.equal(
    walletMessage(
      "Node accepted the exact signed transaction. Confirmation is still pending.",
    ),
    "Payment submitted. Awaiting confirmation.",
  );
});
test("fee copy preserves the exact minimum without changing requested values", () => {
  assert.equal(
    walletMessage(
      "Fee below declared relay policy: 1017 vB requires at least 0.00001017 PRL (1017 grains). Edit the fee explicitly.",
    ),
    "Fee too low. Set it to at least 0.00001017 PRL.",
  );
});
