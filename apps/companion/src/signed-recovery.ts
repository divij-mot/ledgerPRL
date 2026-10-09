import {
  finalizeTransaction,
  validateBundle,
  type AccountPublicKey,
  type FinalizedTransaction,
  type SigningBundle,
} from "@pearl-ledger/sdk";
import {
  emptyJournal,
  reservePayment,
  transitionPayment,
  exportWalletBackup,
} from "@pearl-ledger/wallet";

/** Public recovery artifact for a verified signature whose normal storage failed.
 * The standard backup importer revalidates it. No seed or private signing key is included; signed bytes authorize broadcasting this exact payment.
 */
export function signedRecoveryBackup(
  account: AccountPublicKey,
  bundle: SigningBundle,
  result: FinalizedTransaction,
  paymentId: string,
  createdAt: number,
): string {
  validateBundle(bundle, account);
  const verified = finalizeTransaction(bundle, result.signatures);
  if (verified.rawTx !== result.rawTx || verified.txid !== result.txid)
    throw new Error(
      "Emergency recovery result failed independent verification",
    );
  const journal = emptyJournal();
  reservePayment(journal, bundle, paymentId, createdAt);
  transitionPayment(journal, paymentId, "signing");
  transitionPayment(journal, paymentId, "signed", {
    rawTx: verified.rawTx,
    txid: verified.txid,
  });
  return exportWalletBackup(account, journal);
}
