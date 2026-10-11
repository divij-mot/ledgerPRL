# Account recovery and safe migration

## Existing Ledger seed

Keep the device's existing securely initialized seed. Never reset it for this app, import an Oyster mnemonic into the companion, or type recovery words into a website or computer. A Ledger PIN, an Oyster wallet encryption password and a BIP39 passphrase are different concepts. The companion has no seed import/export function.

The PRL account path is m/86'/808276'/account' on mainnet and m/86'/1'/account' on test networks. Branch 0 is receive; branch 1 is change. Restoring the same secure seed and any original passphrase using the manufacturer's on-device recovery procedure should reproduce the same conventional account. Physical restoration interoperability must be validated before production use.

## Watch-only backup

Keep a private backup of the network and genesis identifier, account number, exported public key/chaincode/fingerprint, issued receive/change high-water marks, scan birthday/coverage, transaction journal and signed-but-unconfirmed transactions. Public account data can reveal financial history even though it cannot sign. Back up only to destinations you explicitly choose.

**Export public recovery record** saves only the public account and issued ranges. **Back up full watch wallet** also preserves the payment journal, input reservations and exact verified signed bytes. The full backup does not include the watch snapshot or a fresh chain check; import it using **Complete watch-wallet backup**, then load/refresh watch data. Restoration merges without downgrading uncertain payment states, and source validation, public-indexer consent and archival claims require fresh checks. Different browser profiles/computers do not coordinate later payments; keep the complete backup current before moving between them.

A missing watch-only backup does not destroy conventional private keys, but incomplete discovery can hide funds. Re-scan both branches from a known safe birthday, with a gap limit and index range sufficient to include every issued address. A nonzero birthday or capped scan is not proof of complete history. Never silently reuse a change index because local storage was cleared.

## Interrupted transfers

For a current initial attempt, the companion releases its reservation only if it fails before adapter signing is invoked, or the adapter finishes unwinding and reports that no complete independently verified transaction was returned to the app, and the stored record/attempt still match exactly. This covers rejection, cancellation, transport failure or partial signature collection without a complete result; it is not proof that the device never calculated or emitted any partial signature. Complete results, including persistence/acknowledgement failures, remain recoverable and reserved. Historical/interrupted records and recovery attempts do not use this new-attempt cleanup policy. An interrupted `signing` record without saved signed bytes offers **Recover payment on Ledger**: connect a ready matching Ledger and load watch data, freshly verify the original inputs as unspent and mature, then approve the account export and complete payment review again. This signs the same canonical payment; it does not select replacement inputs, allocate new change or broadcast. Rejection or failure during recovery preserves the earlier ambiguity and locks. See the [exact recovery flow and freshness limits](companion.md#device-receive-and-payment-flow).

If verified signed bytes are already saved, an explicit broadcast/rebroadcast uses those exact bytes without signing again. A timeout never proves the payment failed. Archiving a sufficiently confirmed payment retains its signed bytes and all input locks; it does not release uncertain or conflicted reservations. Do not clear browser storage to make inputs reusable. This version does not provide automatic missing-signature retrieval, RBF, automated consolidation or invisible fee upgrades. Browser/hardware recovery qualification remains open even though the host recovery regressions pass.

## Development CLI recovery files

The development CLI's `sign` command creates two private, exclusive files:
the requested output and an adjacent `<output>.intent.json` sidecar. Both paths
must be unused; existing files and symlinks are rejected before any device
command. Keep them in a private directory controlled by you, with trusted
parent directories. Exclusive file creation does not protect against another
process that can rename or remove entries in those directories.

The sidecar contains the exact canonical payment and a conservative
`pearl-cli-signing-uncertain` warning. It is written and synced before signing,
then never truncated, replaced or automatically deleted, including after
success. This preserves reconciliation information if the separate signed
output is interrupted during replacement. The signed output is synced before
the final device acknowledgement. Account export still produces only its
requested public-account file.

Retain both files. An empty, partial or malformed signed output is not a usable
signed transaction. The sidecar does not contain signatures and cannot prove
whether signing succeeded, whether a transaction was broadcast, or whether
its inputs are available. Reconcile the exact original payment before trying
again; do not delete the sidecar to bypass the collision guard. If a signed
write fails while the process remains alive, the CLI also prints independently
verified exact signed bytes to standard error for recovery. A killed process
cannot provide that fallback. The sidecar is not a wallet journal or a lock
against signing through another output path, program or computer. Filesystem
sync and the tested process-interruption boundary are not a claim of recovery
from every storage-device, operating-system or power-loss failure.

## Moving funds from Oyster

After release gates pass, verify a new Ledger-derived address in full on the device. The existing Oyster wallet signs an ordinary transfer to it; receiving does not require the Ledger to sign. Confirm receipt before changing miner/pool payouts. Retain legacy recovery material until immature coinbases, late payouts and all remaining balances are resolved. No wallet deletion, mainnet transfer or payout change is performed by this repository's tests.

## Miner payouts

The device is a signer, not a miner or node. Coinbase maturity is 100 blocks in the pinned Pearl network definitions; elapsed clock time is not a guarantee. The companion must separate immature, confirmed-spendable and pending balances. Many small payouts can exceed the bounded 16-input signing profile; any consolidation or split payment requires a separately reviewed transaction.
