# Wallet advanced controls

Normal Receive uses the selected Pearl account, device approval and a verified address. Manual address indexes and derivation paths are available only in **Settings → Advanced**. They are recovery tools, not steps in an ordinary transfer.

## Address ranges and discovery

Accounts use BIP86 derivation. Receive addresses use branch 0; change uses branch 1. Public discovery scans both branches with a gap of 20 unused addresses, through index 999 at most. It accepts at most 2,000 history transactions and 256 unspent outputs. A limit or validation failure prevents a completed balance update; it never silently reports zero.

After a complete discovery, Receive advances past the last used address. Once an address is verified, its local QR encodes exactly that address. **New address** selects the next consecutive address and clears both verification and the QR; selecting it does not issue it or access the device. Device verification records the selected receive index before asking the Ledger to display it. Cancellation does not erase that recovery checkpoint. This bounded wallet issues indexes 0–979 and requires a consecutive saved range; restoring a public account export can recover previously issued ranges. The manual receive index retains these checks.

Change indexes advance when a payment is prepared and are not reused merely because an unsigned draft is discarded. The manual change index cannot precede the saved next index. Light-mode change is also bounded below 980.

## Fees and coin control

Coin control is optional. Automatic selection chooses available mature, confirmed outputs, up to 16 per transaction. Manual selection makes these same restrictions explicit. Combining outputs can link their addresses publicly. Mining rewards require 100 confirmations.

Amounts and fees remain exact integer grain amounts internally (100,000,000 grains per PRL). The wallet computes transaction virtual size and checks the pinned Pearl default relay policy, including minimum fee and dust thresholds. The concise fee hint displays the calculated minimum in PRL. It is not a live fee estimate; node policy can differ. The wallet does not silently increase the fee or convert small change into a donation.

## Saved data and backups

**Export account** saves the public account and address-range checkpoints. **Export backup** also includes the payment journal, input reservations and any verified signed transactions. A signed transaction can be submitted by anyone holding its bytes, so backups must stay private. Neither export contains signing keys or a recovery phrase.

**Save account locally** keeps the optional public balance snapshot in the current browser profile. **Clear saved balance data** removes that optional copy only; it does not erase payment records or free funds used by uncertain payments. Anyone using the same browser profile can view its saved public data. Different browser profiles do not coordinate payment reservations.

Imported data and restored backups require fresh source checks and device approval. Signed or interrupted payments do not expire automatically. A broadcast timeout does not establish that a payment failed: only the same saved transaction may be retried. Archiving a payment after six confirmations retains its signed bytes and input locks, including through later reorganization checks.

## Public sync and diagnostics

Public sync requires session consent. The wallet host and the configured Pearl indexer can link queried addresses, transaction IDs and the requester’s IP. Public account keys remain in the browser. Balances rely on the source’s chain view; this is not SPV verification. Network identity, genesis, raw transactions, ownership and declared discovery coverage are checked before applying a result.

Settings → Advanced exposes account import/export and manual indexes. If a device or source error has a shorter user-facing explanation, **Troubleshooting** retains the original diagnostic. Signing and broadcast guards use the original errors and wallet state; copy changes do not alter them. See [recovery.md](recovery.md) for interrupted-payment handling and [companion.md](companion.md) for protocol and source limits.

## Activity display

History and local payments are paginated for display without discarding discovery records. Transaction IDs can be copied directly. Confirmation counts are shown only while the current snapshot still matches the completed history scan’s verified tip. A later input-only source check can change that tip without revalidating every historical transaction; in that case the count is unavailable until account history is resynced. The interface does not invent dates or fees when those values are absent from the source.
