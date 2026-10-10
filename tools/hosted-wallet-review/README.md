# Independent hosted wallet delta review

Reviewed the automatic-fee, Max, QR and remembered-account/cache changes on 2026-10-10. No unresolved P0–P2 finding was established in this bounded host review after the corrections below. This is an AI code review and finite regression testing, not a professional audit, exhaustive concurrency proof, or physical-device qualification.

The reviewed source snapshot is recorded in `reviewed-source.json`. It includes the relevant production modules, fee helpers, core wallet dependencies and regression harnesses. The parent owned production `main.ts` changes; this reviewer identified issues, implemented the shared fee helpers/quote-rate validator, and wrote the regression tests. No user wallet state, real camera, physical device, private key or real transaction was used by these tests.

## Corrected findings

1. **Automatic fee choices could appear unavailable with valid quotes.** The old `quotedPayment` API intentionally checks an existing selection, but the new automatic UI supplied an empty selected-input set. The UI now uses `paymentAtRate` with independently validated `quoteRate`; the old API retains its existing admission check. The actual-main test confirms all three target choices work with automatic inputs and the default uses the live Medium rate. Missing estimates are explicitly labeled as the relay-floor fallback.
2. **A quote could expire while draft storage was queued.** The chosen rate was checked before the asynchronous journal wait. The atomic update now rechecks the current rate/freshness before saving. A controlled clock advance after the queue boundary confirms an expired explicit target cannot allocate a draft.
3. **A scanned explicit amount could be overwritten by prior Max state.** QR acceptance now clears Max when the request supplies an amount. The actual handler preserves that amount, remains in the recipient step, and creates no payment or device signing call. A cancelled late decode leaves the previous recipient/amount unchanged.
4. **Max could disable higher-rate choices rather than reprice the recipient.** Alternative quotes were priced against the old maximum amount. In Max mode they now use `maximumPaymentAtRate`, allowing the user to choose a higher rate and reducing the recipient amount accordingly. Exact custom total fees also reprice Max without silently changing the entered fee.

## Verified boundaries

- Exact bigint rate/size calculations; bounded input selection; no-change versus change; dust rejection rather than hidden fee absorption; manual input constraints; automatic Max excludes uneconomic additional inputs.
- New cross-tab reservations cannot silently raise the reviewed fee or allocate a conflicting draft. Custom dust failures leave the journal unmodified.
- Late fee responses cannot rewrite a prepared canonical payment, install rates for another account, or trigger signing.
- QR parsing binds the network and Pearl scheme, rejects duplicate/unsupported fields and malformed amounts. Camera permission resolving after cancellation stops all acquired tracks. Late cancelled image decoding closes its bitmap without reading pixels.
- Cached hosted balances restore neither validation nor device verification. The ordinary Send action stays disabled until resync; a previously saved draft still requires fresh source validation before any signing call. An unavailable source preserves the draft/reservations and produces no signing call.
- A delayed cached view cannot reopen an account after the actual Close handler clears it. Cache decoding checks account identity, owned raw transaction data and history structure; optional cache fields do not restore spend authority.

## Test results

- `ui.test.ts`: **10 passed**, executing the actual bundled `main.ts`, fee/SDK/wallet/cache logic with explicit DOM/storage/transport/QR-decode mocks.
- `qr-cache.test.ts`: **4 passed**, executing the real QR/cache validators and real cancellation logic against synthetic browser APIs.
- `apps/companion/test/hosted-wallet-ui.test.ts` runs both files in normal companion CI.
- Four previously failing legacy wrappers passed after adapting their setup to the new defaults. Frozen-transaction tests now explicitly select Custom fees and manual coin control; no exact-byte, signature, reservation or cancellation assertion was removed. Anonymous fee paths are isolated from owned-process request counts and account-operation deadline models. The former private-mode fee test now permits only the newly authorized address-free fee/status request shape.
- All **15 payment/recovery sequences passed**, including their unchanged-production-source guard and exact original/alternate signed-byte assertions. Replay output used a temporary location; historical evidence was not overwritten.
- Fee helper suite: **16 passed**, including preserved original quote tests and the extracted `quoteRate` validation checks.
- Companion TypeScript check passed after the parent corrected an unrelated QR-test typing error. Scoped diff whitespace check passed.

Evidence: `regressions.log`, `legacy-harnesses.log`, `payment-replay.log`, and `fee-helper.log`. The test models are not real IndexedDB durability tests or a browser permission-prompt qualification. The parent’s separately performed public-service/real-UI checks do not extend these mock-test claims.

## Entry-route default follow-up

Reviewed the isolated network-initializer change: HTTPS-hosted entries and the known `/`, `/index.html`, and `/live.html` routes now default to mainnet; absent location or unsupported non-HTTPS development routes retain the regtest fallback. A ten-case table executes the actual bundled initializer for HTTP/HTTPS standalone and Discover routes, unsupported paths and missing location. It verifies the selected network and confirms initialization creates no account, validation, request or signing call. The complete focused suite passed again: 11 actual-main tests plus 4 QR/cache tests, **15/15** total. Evidence: `route-default.log`. Only `main.ts` and this regression harness changed from the prior snapshot; their hashes were updated in the same 40-file manifest. This change adds no native Android code or qualification claim.

## Final health-label follow-up

Reviewed the pure `networkHealth()` predicate correction: only local mainnet account 0 without public-source consent receives the local-sync label; nonzero accounts receive the public-network label. The new actual-main regression opens the local standalone entry, verifies the initial local label, loads account 1 while the selected index remains 0, and verifies the rendered public-network labels with no request or signing call. The focused CI wrapper passed, executing all 16 underlying cases (12 actual-main and 4 QR/cache). Evidence: `health-label.log`. Only the `main.ts` and regression-harness hashes were updated in the 40-file manifest; all other hashes and metadata were retained. No transaction, synchronization, or permission behavior changed.

## Final ETA and fee-refresh follow-up

Reviewed the short ETA presentation and limited visible-amount-screen refresh scheduler. Labels use Pearl’s pinned 194-second target (`≈3 min`, `≈32 min`, `≈1 h 21 min`) only for a fresh valid quote; expired estimates become `Unavailable`, and Custom has no estimated time. Equal-rate Medium/Slow choices intentionally remain available. Automatic explanatory paragraphs and the permanently empty quote-status state/props were removed; the Custom minimum-fee validation remains.

The controlled-clock regression reproduced an input-driven scheduling defect: inputs at ages 104 and 110 seconds delayed the 105-second renewal until after quote expiry. The parent corrected normal scheduling to use the absolute refresh deadline, with a separate 15-second busy retry. A further DOM regression covers the parent/product finding that replacing an option button’s full text erased its ETA child: price and time children are now updated independently. The mock models the real `textContent` descendant-removal behavior, so a future parent-text replacement fails this regression.

The expanded run passed **46/46**: 24 actual-main cases, 4 QR/cache cases, 17 fee-helper cases, and the legacy fee-policy wrapper. Controlled timer tests verify one anonymous six-request fee/status batch at 105 seconds, unreferenced Node timers, no refresh in hidden/other/recipient/review states, cache-aware visibility return, bounded busy deferral, no preparation while automatic fees load, no Custom overwrite, and no changes to prepared payments. Amount edits retain the displayed ETA children and cannot postpone renewal beyond expiry. Tests use fake clock/timer and visibility controls, not real elapsed polling or browser/hardware permissions. The legacy copy assertion now checks compact `Unavailable` instead of removed prose; existing exact-fee and authorization assertions remain. TypeScript and scoped whitespace checks passed.

Evidence: `eta-scheduler-before.log` and `eta-scheduler.log`. The seven changed production/test entries were refreshed in the same 40-file source manifest; the remaining hashes are unchanged. No unresolved P0–P2 finding was established in this final delta.
