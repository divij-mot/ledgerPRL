# Lean implementation and lite-client parity review

Reviewed 10 October 2026. This is a source/host review, not a security certification or funded-transfer test. It made no hardware changes, broadcasts or external posts.

## Source basis

The reviewer independently fetched official Pearl commit `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701` and checked all **130 desktop `src/` blobs** against their Git object hashes. The comparison used actual Send, Receive, Activity, wallet RPC and process-start code. Immutable references and the current capability matrix are in [feature coverage](../../docs/prl-feature-coverage.md#current-desktoplite-parity).

The companion retains original Ledger Wallet 4.23.0 sources, MIT notice and a reproducible adaptation patch under `apps/companion/vendor/ledger-live-4.23.0`. The app is a source-adapted interface with its own PRL state machine; it is not an unmodified Ledger Bitcoin wallet. The device app separately derives from Ledger Bitcoin 2.5.1.

## Findings and remediation

| Finding | Disposition |
| --- | --- |
| Current documentation incorrectly said no corrected C build or physical test existed; P2MR was both implemented and listed as missing | Corrected current status, preserving historical test scope. Linked bounded emulator and Nano S Plus OS 1.7.0 evidence separately |
| Desktop has Max, fresh addresses, QR and richer activity | Added exact bounded Max, explicit New address, verified-only QR, display pagination, copy txid and validated-tip confirmation counts. General history timestamps/fees remain a data-model gap |
| Fixed total fee and minimum hidden under Coin control | Normal Amount step now shows total fee, vsize/rate and minimum. Added explicit bounded 1/10/25-block quotes with exact string parsing, network binding and two-minute expiry. Current indexer timeouts prevent live qualification |
| Both entry pages eagerly imported both device stacks | Separate registered entry transports; the root's Vite graph check confirms each entry excludes the other transport. Invocation remains synchronous to preserve WebHID user activation |
| Unused decorative navigation helper had a test but no production caller | Removed helper and its obsolete test |
| Default build also produced optional MetaMask output | Default build targets companion; `build:all` and `check` retain all-workspace coverage |
| Root Ledger manifest and packaging workflow described the historical Rust app | Explicit historical labeling prevents those files being mistaken for current C installation metadata |
| Approximately 2,000-line browser controller mixes views and payment orchestration | Deferred broader refactor. Extract pure settings/history rendering incrementally; avoid rewriting proven reservation/signature persistence/recovery ordering merely to reduce line count |

Neither source size nor file count alone establishes bloat. Retained security evidence and upstream device source are not shipped browser payload; bulk deletion would damage auditability. The browser currently pays for React static rendering alongside imperative handlers. A renderer migration needs a separate behavioral verification effort and was not necessary for these fixes.

## Deliberate differences from the lite wallet

- Official desktop starts a Pearl SPV wallet. The companion trusts a backend chain view while checking genesis, raw transaction contents, ownership and response consistency; those checks are not SPV.
- Official desktop allows unconfirmed input spending and pending-record removal. This profile requires confirmed spendable inputs and preserves uncertain signed-payment reservations. Its rebroadcast sends the same stored bytes.
- Software-wallet private-key import/password unlock do not belong in this hardware-only wallet. XMSS, script-path custody, message signing and advanced RPC transaction policies need separate designs; they are not implied by ordinary desktop UI parity.

No funded mainnet send or confirmation was qualified. The intended approximately 10 PRL user-run trial has no matching hard wallet cap; its current backend blocker and sequence are documented in [mainnet testing](../../docs/mainnet-testing.md).

## Verification boundary

The reviewer independently ran the focused Activity, coin-selection, fee-quote and direct-wallet-UI test files using the bundled Node 24 runtime: **15 tests passed, zero failed** (4.9 seconds). The UI wrapper includes 24 actual-main scenario assertions. Coverage includes exact approved QR matrix, no New-address APDU/journal issuance before verification, capped address range, 10/10/3 display pagination without record loss, exact clipboard text, stale-tip count removal, bounded Max, fee-unit parsing, upward rounding, expiration/network checks and proxy path bounds. The source/provenance owner separately reports the adaptation patch frozen and reproduced. These are host tests; the root's final combined suite and commit identity remain the delivery checkpoint.

```sh
node --import tsx --test apps/companion/test/coin-selection.test.ts apps/companion/test/fee-quotes.test.ts apps/companion/test/activity.test.ts apps/companion/test/direct-wallet-ui.test.ts
```

The four edited product documents passed local-link checks; all review edits passed `git diff --check`.
