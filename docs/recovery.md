# Account recovery and safe migration

## Existing Ledger seed

Keep the device's existing securely initialized seed. Never reset it for this app, import an Oyster mnemonic into the companion, or type recovery words into a website or computer. A Ledger PIN, an Oyster wallet encryption password and a BIP39 passphrase are different concepts. The companion has no seed import/export function.

The PRL account path is m/86'/808276'/account' on mainnet and m/86'/1'/account' on test networks. Branch 0 is receive; branch 1 is change. Restoring the same secure seed and any original passphrase using the manufacturer's on-device recovery procedure should reproduce the same conventional account. Physical restoration interoperability must be validated before production use.

## Watch-only backup

Keep a private backup of the network and genesis identifier, account number, exported public key/chaincode/fingerprint, issued receive/change high-water marks, scan birthday/coverage, transaction journal and signed-but-unconfirmed transactions. Public account data can reveal financial history even though it cannot sign. Back up only to destinations you explicitly choose.

A missing watch-only backup does not destroy conventional private keys, but incomplete discovery can hide funds. Re-scan both branches from a known safe birthday, with a gap limit and index range sufficient to include every issued address. A nonzero birthday or capped scan is not proof of complete history. Never silently reuse a change index because local storage was cleared.

## Interrupted transfers

If rejection was clearly completed before signing, a draft may be canceled according to the journal. If transport failed during/after signing, retain the reservation and transaction record. Inspect the chain and local signed transaction before retrying. Rebroadcasting the identical signed conventional transaction is distinct from constructing a conflicting replacement. This version does not provide automatic RBF, automated consolidation or invisible fee upgrades.

## Moving funds from Oyster

After release gates pass, verify a new Ledger-derived address in full on the device. The existing Oyster wallet signs an ordinary transfer to it; receiving does not require the Ledger to sign. Confirm receipt before changing miner/pool payouts. Retain legacy recovery material until immature coinbases, late payouts and all remaining balances are resolved. No wallet deletion, mainnet transfer or payout change is performed by this repository's tests.

## Miner payouts

The device is a signer, not a miner or node. Coinbase maturity is 100 blocks in the pinned Pearl network definitions; elapsed clock time is not a guarantee. The companion must separate immature, confirmed-spendable and pending balances. Many small payouts can exceed the bounded 16-input signing profile; any consolidation or split payment requires a separately reviewed transaction.
