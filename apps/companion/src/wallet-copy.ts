/** Presentation only: diagnostics and wallet state stay unchanged. */
export function walletMessage(message: string): string {
  if (/^Expected decimal PRL string/.test(message))
    return "Enter an amount with up to 8 decimal places.";
  const minimum =
    /Fee below declared relay policy:.*at least ([0-9.]+) PRL/.exec(message);
  if (minimum) return `Fee too low. Set it to at least ${minimum[1]} PRL.`;
  if (/^Recipient is dust/.test(message))
    return "Amount is too small. Increase the amount.";
  if (/^Change is dust/.test(message))
    return "Change is too small. Adjust the amount or choose different funds.";
  if (/^Device rejected command \(0x6985\)/.test(message))
    return "Request declined on your Ledger. Reconnect before another operation.";
  if (
    /^(Unsupported PRL app\/protocol|Wrong Pearl app\/network|Wrong device network|Wrong device genesis|Device rejected command \(0x6[de]00\))/.test(
      message,
    )
  )
    return "Open the Pearl app for the selected network on your Ledger.";
  if (/^Device rejected command/.test(message))
    return "Your Ledger could not complete the request. Reopen Pearl before another operation.";
  if (/^Device master fingerprint changed/.test(message))
    return "Connect the Ledger that belongs to this account.";
  if (
    /^(Public indexer unavailable|Indexer is not fully synced|Local node bridge is unavailable)/.test(
      message,
    )
  )
    return "Balance unavailable. Check the connection and sync again.";
  if (
    /^(Device operation cancelled or timed out|Transport cleanup timed out|Ledger response timed out)/.test(
      message,
    )
  )
    return "The device connection ended. Reconnect your Ledger before another operation.";
  if (
    /^Signed bytes were verified and saved, but the final device acknowledgement/.test(
      message,
    )
  )
    return "Payment approved and saved. Reconnect your Ledger before another operation. Check its status before sending.";
  if (
    /^Signing completed, but acknowledgement or signed-transaction storage failed/.test(
      message,
    )
  )
    return "Payment could not be saved. Keep this window open and download a backup.";
  if (/^Public account discovered through block/.test(message))
    return "Account synced.";
  if (/^Pearl PSBT signer connected/.test(message)) return "Account connected.";
  if (/^Full receive address matched/.test(message)) return ""; // The verified Receive step is the confirmation.
  if (/^Verified receive address copied/.test(message))
    return "Address copied.";
  if (/^Public account loaded/.test(message))
    return "Account loaded. Sync to see your balance.";
  if (/^Complete watch backup merged/.test(message))
    return "Backup restored. Sync and reconnect your Ledger before sending.";
  if (/^Imported public outputs/.test(message))
    return "Balance data imported. Sync before sending.";
  if (/^Public synthetic example loaded/.test(message))
    return "Example loaded. These are not real funds.";
  if (/^Restored public watch data/.test(message))
    return "Saved account loaded. Sync before sending.";
  if (/^Saved watch snapshot removed/.test(message))
    return "Saved balance data removed. Your account and payments are unchanged.";
  if (/^Public watch data saved/.test(message))
    return "Account saved in this browser.";
  if (/^Node checked /.test(message)) return "Balance updated.";
  if (/^Node check removed /.test(message))
    return "Available funds changed. Review any unfinished payment before sending.";
  if (
    /^(Signatures independently verified and exact signed bytes saved|Another tab's independently verified signed bytes)/.test(
      message,
    )
  )
    return "Payment approved. Review and choose Send payment to submit it.";
  if (/^Node accepted the exact signed transaction/.test(message))
    return "Payment submitted. Awaiting confirmation.";
  if (/^Unsigned draft discarded/.test(message)) return "Draft discarded.";
  if (/confirmed records archived|known signed payments checked/.test(message))
    return "Payment status updated. Unresolved payments remain unavailable.";
  return message;
}
