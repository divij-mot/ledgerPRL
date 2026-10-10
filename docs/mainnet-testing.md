# Mainnet trial

The intended next milestone is a user-run trial with approximately **10 PRL total**. The user supplies the funds and approves each real payment. This is a chosen test budget, not a hard wallet or consensus cap. Do not send funds to published fixture addresses or enter a recovery phrase in the companion.

## Current evidence and blocker

The current C app passed bounded Nano S Plus mainnet/regtest emulator tests, including P2TR/P2MR recipients and hostile-request rejection. One physical Nano S Plus on OS 1.7.0 passed account and Receive verification through Ledger Wallet; a separate HID pilot signed a synthetic nonexistent input. No real funds moved. See [emulator evidence](../tools/live-app-native-review/README.md) and [physical evidence](../tools/live-app-physical-review/README.md).

**Live funded discovery, sending, relay and confirmation remain unqualified.** In the latest check, both configured mainnet and Testnet2 indexers timed out before TCP/TLS connection. The production client/proxy made no address queries and returned no balance. This establishes a reachability failure from the test Mac, not its cause or a service-wide outage. The [read-only probe](../tools/live-app-public-review/README.md) must succeed before the public-indexer route can support the trial. An unavailable balance must never be treated as zero or bypassed with a synthetic snapshot.

## User-run sequence

1. Open the mainnet Pearl Live App and matching **Pearl Dev** device app. Confirm the account, verify the complete receive address on Ledger, then copy it or use its verified QR.
2. After the real backend passes network/genesis checks, send a small portion of the intended budget to that address from the user's existing wallet. Sync until the deposit appears and is spendable. Ordinary inputs need one confirmation; mining rewards need 100.
3. Prepare a small payment to an address the user controls. Review recipient, amount, total fee and any change on Ledger. Device approval produces a saved signed payment; use the separate **Send payment** action to broadcast it.
4. Record the transaction ID, verify its appearance in the destination wallet, and sync until confirmed. Keep the wallet backup private. If submission times out, check status and retry only the same saved transaction; do not release its reservations or prepare a replacement from those inputs.

A successful trial qualifies only the recorded app build, device/OS, transport, backend and transaction shape. It does not qualify other devices, maximum-input behavior, restoration or a release.

## Scope and trust

The supported profile is ordinary BIP86 P2TR owned inputs/change, one P2TR or P2MR recipient, at most 16 inputs and one change output, and SIGHASH_DEFAULT. Amounts and fees use integer grains. P2MR is recipient-only; XMSS, script-path custody, message signing, RBF and software-key import are excluded. The wallet deliberately has no pending-payment deletion action that forgets a signature or frees uncertain inputs.

The official desktop lite wallet starts a Pearl SPV wallet. This companion instead trusts its selected backend's chain view while checking genesis, raw transaction contents, ownership and response consistency. These checks cannot prove complete history or independent chain inclusion. Current everyday UI parity and remaining gaps are in the [feature matrix](prl-feature-coverage.md#current-desktoplite-parity).
