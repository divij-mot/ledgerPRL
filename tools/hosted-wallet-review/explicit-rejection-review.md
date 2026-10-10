# Independent initial-attempt result policy review

10 October 2026. Public fixtures only. The tests execute actual bundled `main.ts`, wallet validators and the Bitcoin-derived adapter over its frozen public protocol endpoint. DOM, storage and node-preflight replies are explicit mocks. Two tests inject an error at the client/UI result boundary to exercise complete-before-staging and unclassified failures. No user profile, physical/native device, real network or actual broadcast was used.

## Final contract

The final policy is based on the result returned to the app, not on claiming that Ledger emitted no raw signatures. `SigningFailedWithoutResultError` is created only after the adapter's signing engine has unwound with no complete independently verified transaction. A fresh initial attempt can then be discarded atomically if its full journal record and attempt owner remain unchanged, no signed recovery was staged and no signed bytes were persisted. The same exact-record cleanup also handles failure after the signing-state commit but before the adapter signing function is invoked; it has local proof that this call never started. Rejection, cancellation, transport failure and partial signature collection can all produce this result.

Complete verified bytes take priority: a failed durability callback carries `VerifiedSigningResultError`; a failed final ACK retains the complete result with a warning. The UI stages/preserves a complete result even if it arrives before the usual callback staging boundary. Recovery attempts, old/historical records, concurrent changes and unclassified exceptions do not gain cleanup authority. A missing mempool transaction or the user's recollection of an old rejection does not clear an existing journal.

This supersedes the narrower intermediate bare-denial classifier. Reservations remain visible in Send/coin control; Portfolio does not describe them as network-pending payments. Root owns production UI changes and the adapter reviewer owns the terminal no-result classifier; this reviewer changed tests and documentation only.

## Executed independent UI regressions

**24/24 passed** in `explicit-rejection-ui.test.ts`:

- Initial review denial, generic transport loss, failure before the first signature, one valid partial signature followed by failure, and cancellation after a valid partial: the current initial record clears, no broadcast occurs, high-water marks remain, and reload does not recreate the cleared attempt.
- Recovery denial and partial/cancelled recovery retain every prior reservation and the historical signing ambiguity.
- Queued cleanup encountering a signed record, replacement attempt, restored ambiguity without an attempt owner, or another record update retains that exact concurrent record.
- An unclassified client/UI error cannot unlock by message text or resemblance to a status code.
- A complete verified transaction with a failed durable write preserves exact emergency recovery bytes and reservations.
- A complete result delivered through the adapter error before UI staging is preserved before any cleanup branch.
- Final ACK loss and a final valid response that wins a cancellation race preserve the exact signed transaction and reservations. The latter test resolves the response first, then aborts before its continuation processes the final yield; no extra ACK or broadcast occurs.
- The original reservation-copy check was subsequently updated for the total-balance presentation described below.
- Five post-commit/pre-adapter cases inject cancellation or journal-refresh failure during the first read after signing-state commit. Initial attempts clear; recovery attempts and a concurrently changed record stay reserved. All assert zero device APDUs at this boundary.

Actual partial response indices are observed at the transport boundary rather than inferred from an attempted endpoint yield. The concurrent tests hook an observed failure outcome before the queued journal read. The late response that *loses* cancellation and arrives after engine unwind is covered separately by the adapter review; this UI suite's winning-response case must not be conflated with it.

The normal companion CI wrapper executes the suite. Mock atomic persistence is not an IndexedDB power-loss proof. While expanding the harness, a callback fixture initially referenced an unavailable helper and the new response-observation counter had not yet been wired; those test-fixture errors were corrected without changing production code or weakening result-preservation assertions.

## Composed payment/recovery histories

The existing suite remains **15 histories**. Each initial no-result mode (review rejection, before-first-yield, after-first-yield, cancellation after first yield) first verifies discard/unreserve, no complete signed bytes/broadcast, persistence across reload and unchanged receive/change high-water marks. It then installs a **separate explicitly historical ambiguous test fixture** with no attempt proof, so the original recovery-denial, fresh recovery, exact original/alternate signed-byte, timeout/retry, backup-merge and archive/reorg assertions still execute. This fixture transition models old records; it is not a product action or user-data migration.

Storage failure, lost ACK and successful signing retain their complete-byte paths. **15/15 passed**, with unchanged production source hashes during the run. Historical earlier evidence was not overwritten.

Evidence: `explicit-rejection-ui.txt`, `explicit-rejection-wrapper.txt`, `explicit-rejection-sequences.txt`, `explicit-rejection-sequences.json`, and `explicit-rejection-source.json`. The filenames retain the original reported symptom; this report states the broader final app-result policy precisely.

## Portfolio presentation follow-up

Two focused actual-main cases passed after the portfolio headline changed from spendable balance to total unspent owned balance. An unsigned reservation leaves the headline unchanged and does not display the full reserved input as a network-pending payment. A source-reported unconfirmed own-change fixture appears in total Balance, while the real wallet preparation policy rejects it as unconfirmed and Send availability stays zero. The latter fixture is synthetic and unrelated to the owner’s values. No optimistic amount subtraction or fabricated change is used. The final frozen-source run passed all 24 cases and the normal wrapper. The 15 composed histories also passed with before/after/current production hashes matching. Two legacy wrappers were updated only for the ordering in which an initial attempt clears before recovery has atomically claimed it: they now require zero stale recovery APDUs and no resurrection. All 18 and 19 underlying probes passed, preserving the already-claimed recovery and exact complete-byte assertions.
