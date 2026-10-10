# Pending status and Bitcoin parity review

Reviewed 2026-10-10. Public fixtures only; no hardware interaction, real payment, broadcast, account-data inspection, deployment, or cloud write by this reviewer.

## Implemented refresh

The manual **Refresh payment status** action previously reconciled the cached public/local history without contacting its source. It now performs bounded fresh discovery, applies one coherent balance/history view, and only then reconciles confirmed records. Source failure invalidates spending authority while retaining the prior display and signed reservations. Account, selected payment, source, cancellation, and recovery-range checks exclude stale results. Public/local discovery has the same 300-second total deadline as normal public sync. Private-node reconciliation keeps its existing budget.

`applyDiscovery` gained an explicit caller guard. Ordinary local background scans retain their existing rule against updating a busy payment or receive review.

The read-only public pending monitor operates only while visible and idle, including an already submitted payment screen. It excludes unsigned payment preparation, device/address review, local/private-node sources, and emergency signed recovery. It queries at most four known transaction IDs per regular 60-second cycle, rotating fairly; a newly introduced payment gets one early check within five seconds. Re-renders preserve an absolute deadline. Hiding, account/selection changes, and entering a protected flow abort stale work.

An unchanged status costs one transaction read per monitored payment, up to four per cycle. New mempool visibility, a changed inclusion block, or reaching six confirmations triggers at most one full account discovery per cycle. Owned submitted records stay monitored until archival, including when restored history already shows six confirmations. Confirmations two through five do not trigger account scans. Incoming history-only payments stop after first confirmation. There is no server-side wallet cache, automatic broadcast, broadcast retry, reservation release, cron, or account-wide idle polling.

Source failures and missing transactions do not establish cancellation. A failed or inconsistent full discovery can be retried at the next bounded cycle while its status still differs from the last applied account view. A manual refresh remains available for later reorgs after automatic monitoring has stopped.

## Exact Ledger source behavior

Pinned official Ledger Live 4.23.0 commit: `abed962b08ca4b746f20192b28ce5b6c06a6c6a4`. The linked source is used as implementation evidence, not a promise that every public release has identical behavior.

* [`shared/env/src/definitions/team-coin-integration/index.ts`](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/shared/env/src/definitions/team-coin-integration/index.ts): `BITCOIN_STUCK_TRANSACTION_TIMEOUT` defaults to 20 minutes; `OPERATION_OPTIMISTIC_RETENTION` defaults to 30 minutes. These are UI/client retention settings, not consensus expiration rules.
* [`libs/ledger-wallet-framework/src/account/pending.ts`](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/libs/ledger-wallet-framework/src/account/pending.ts): `shouldRetainPendingOperation` removes an optimistic entry after the retention duration, or when the available transaction sequence comparison supersedes it. The generic sequence branch should not be mistaken for Bitcoin input-sequence RBF.
* [`libs/ledger-wallet-framework/src/bridge/jsHelpers.ts`](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/libs/ledger-wallet-framework/src/bridge/jsHelpers.ts): sync filters the optimistic list through that predicate.
* [`libs/coin-modules/coin-bitcoin/src/synchronisation.ts`](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/libs/coin-modules/coin-bitcoin/src/synchronisation.ts): `reconcileConfirmedPendingOperations` drops optimistic duplicates whose transaction hash occurs in synced `account.operations`, preserving original recipient text. Despite the helper/comment naming, the matching set itself has no additional confirmation-height predicate.
* [`libs/ledger-live-common/src/families/bitcoin/editTransaction/operation.ts`](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/libs/ledger-live-common/src/families/bitcoin/editTransaction/operation.ts): stuck/editable logic concerns outgoing unconfirmed operations. Twenty minutes makes an operation eligible for the stuck UI; it does not cancel it.
* [`buildRbfTransaction.ts`](https://github.com/LedgerHQ/ledger-live/blob/abed962b08ca4b746f20192b28ce5b6c06a6c6a4/libs/ledger-live-common/src/families/bitcoin/editTransaction/buildRbfTransaction.ts): speed-up/cancel builds a replacement transaction with `rbf: true` and `replaceTxId`; cancel redirects to a wallet change address. It is a newly signed transaction with fee requirements, not deletion of a local row.

Therefore copying the 30-minute optimistic-row cleanup into Pearl's durable signed-payment journal would not reproduce the same data model. A signed transaction remains potentially spendable after it disappears from one indexer's mempool or local UI.

## Pearl replacement and lock boundaries

Pinned official Pearl source: `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`, inspected in `/private/tmp/astra-pearl-source`.

`node/mempool/mempool.go:37–40,597–668,799–895` implements opt-in RBF. The conflicting original must signal replacement directly or through an unconfirmed ancestor (`sequence <= 0xfffffffd`), unless replacements are disabled entirely. Replacement checks include eviction limits, higher conflicting fee rates, total conflicting fees plus relay bandwidth, and restrictions on new unconfirmed inputs. The 15-minute `orphanTTL` is for orphans; no normal signed-transaction expiration promise follows from it. Fee/size policy can evict a transaction without invalidating its signature.

This wallet's `packages/sdk/src/bundle.ts:102` and firmware `preprocess_inputs.c:295–301` require `0xffffffff` input sequences. Its input policy uses confirmed outputs, excluding inherited opt-in from an unconfirmed ancestor. Existing payments therefore do not have the app-supported RBF path needed for Ledger-style speed-up/cancel. Exposing it requires separate firmware, bundle, fee, and replacement-lifecycle work.

`reservedOutpoints` intentionally includes stored signed payments even after archival; confirmed spent inputs disappear from a fresh UTXO view, and a reorg can make them relevant again. `reconcileConfirmed` archives only matching known signed transaction IDs at six confirmations and detaches stale receipts after reorg. Missing, unknown, or conflicted records are not time-unlocked.

The separately requested unsigned-failure policy has a narrower contract: this app did not capture a complete signed result. It must preserve complete signed callbacks, persistence failures, recovery attempts, and concurrent signed writes. Historical no-raw initial attempts cannot be safely deleted merely because a chain check reports unspent: an active signer in another tab must also be excluded. The current BroadcastChannel refresh by itself is not a cross-tab signing cancellation protocol.

## Verification

`apps/companion/test/pending-monitor.test.ts` exercises fake-clock deadlines, four-read budgets/rotation, one scan per cycle, hidden/ineligible contexts, unavailable/missing data, and owner/selection/hidden aborts.

`tools/pending-status-review/refresh.test.ts` bundles the actual `main.ts`, discovery, public source, local source, SDK and wallet implementations; only device/DOM/storage and fixture transport are mocked. It verifies fresh public/local balance/history, missing/unavailable retention, account/payment/abort exclusion, real pending-to-confirmed application, two-through-five cheap reads, sixth-confirmation archival, restored mature-history reconciliation, and safe manual reorg detachment. CI invokes it through `apps/companion/test/payment-status-refresh.test.ts`.

Results: 23 focused tests passed (`monitor-tests.txt`). The existing hosted UI/QR/cache suite is also rerun (`refresh-tests.txt`). These are source/fixture simulations, not physical Ledger, Android native-host, or real-money qualification.
