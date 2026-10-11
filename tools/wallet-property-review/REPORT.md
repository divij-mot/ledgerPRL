# Independent wallet recovery and storage boundary review

This packet uses frozen public fixtures and offline deterministic tests. It does
not establish absolute security or qualify a physical Ledger, browser WebHID,
real network acceptance, or power-loss durability.

## Reproduced findings

1. **Malformed persisted reservation data was trusted.** `WatchStorage` checked
   only the outer schema, payment-array type and integer change index. Loading a
   signed record whose reservation list had become empty then allowed the same
   two inputs to be reserved for another payment. Invalid local high-water bounds
   and a persisted null row were also insufficiently checked. This is a
   fail-closed hardening gap: the test injects malformed local data and does not
   establish an external corruption path. It does not imply resistance to
   malicious same-origin code that can directly delete or alter storage.

2. **The exported merge helper was not atomic on rejection.** A valid incoming
   backup could add an earlier record before a later reservation conflict threw.
   The target retained the earlier addition despite the error. Both journals in
   the minimal reproduction pass the production backup importer. The UI's
   enclosing IndexedDB transaction abort is intended to contain this, so the
   direct-helper result is not evidence of a UI partial commit.

The initial campaign's seed was `0x51a9beef`. Original source hashes and failing
assertions are in `results-original-51a9beef.json` and `campaign-51a9beef.log`.
The six-case local-bound group stopped on its first failure in that initial run;
its reported number was the planned group size, not six completed assertions.
Later runs attempt all six before reporting failure.

## Reviewed fixes

The local journal path now validates bounded recovery metadata, payment states,
canonical bundle-derived reservations, duplicate identities/outpoints, signed
transaction identity and state consistency. Validation runs before callbacks and
before writes. Missing storage and the explicitly supported older absent receive
range remain distinct from malformed rows. Live signing-attempt ownership and
archive metadata remain local and are preserved. Full account ownership and
signature checks remain at import, signing and broadcast boundaries.

Merge preparation now occurs in a private candidate. Conflicts and capacity
errors leave both original journals unchanged. Successful commits retain the
existing payment object identities required by current callers.

The wallet-local cache holds at most 2,000 entries of deterministic checks on
immutable canonical bundle/signed-byte strings. Mutable states, reservations,
metadata and recovery bounds are checked on every read and before each write;
decoded cached objects never escape the module. The separately investigated SDK
point-cache proposal is not applied. Canonical input paths conservatively raise
legacy recovery high-water marks only after the complete row passes validation.
Atomic merges use bounded ID/outpoint maps while preserving existing payment
object identities on successful commit.

`WatchStorage.removeSavedSnapshot()` deletes only the optional
`public-cache["last-snapshot"]` record. Success, absent-cache, request error,
transaction error, abort and synchronous failure cases leave journals untouched.
The real UI calls it only through the explicit Clear saved watch copy action.

## Latest recorded verification

- Focused integrity/deletion tests: 32 passed (`review-focused.log`).
- Seed `0x51a9beef`: 12,447 property cases passed with unchanged observed source
  hashes (`results-reviewed-51a9beef.json`).
- Seed `0x8d12f4a7`: 12,447 passed, but the report correctly records a concurrent
  `main.ts` UI edit; it is not a frozen whole-tree result.
- `review-full-check.log` reached the final production build and successful
  tracked-file secret-pattern scan after all workspace tests/typechecks. Later
  UI/report edits require their own final checkpoint replay.

The latest maximum-shape structural benchmark (`storage-performance-reviewed.json`)
uses 2,000 records, 32,000 inputs and about 15.8 MB: 6,146 ms cold, then 25/18 ms
warm while other checks were active. It uses synthetic serialization and dummy
witnesses, not valid signatures or browser/device timing. A very full journal's
first read can still pause the UI; this limitation is not hidden by the warm
cache result. The earlier 7.7-second repeated-validation result remains recorded.

## Repeatable campaigns

From the repository root with installed Node 24 dependencies:

    node --import tsx tools/wallet-property-review/campaign.mts
    PRL_SEED=0x8d12f4a7 PRL_OUTPUT=/tmp/wallet-campaign.json node --import tsx tools/wallet-property-review/campaign.mts
    node --import tsx --test packages/wallet/test/journal-integrity.test.ts apps/companion/test/storage-integrity.test.ts
    node --import tsx tools/wallet-property-review/storage-performance.mts

The property campaign covers all state-pair merges, 1,000 histories of 30 replay
steps, exact monetary boundaries and seeded amounts, malformed JSON/schema
fields, signed-byte mutations, stale callback ownership, emergency recovery and
local-row corruption. Reports include seed, source hashes, source-change checks,
case groups, timings and limitations. Case counts are test invocations, not
independent vulnerabilities or real device transactions.

The performance script uses synthetic canonical serialization with dummy
witnesses. It measures structural checking only and makes no signature-validity
claim. Validation runs in a fresh child process to avoid fixture construction
priming a cache.

## Browser limitation

`browser-storage.mts` is an isolated loopback-only regression harness for actual
Chromium IndexedDB cross-tab serialization, transaction abort, tab closure and
module-worker cancellation. It uses a new disposable profile, never an existing
profile, and blocks non-loopback requests. The initial launch was blocked before
any test by the executor's socket restriction; no real browser result was
obtained. `browser-results-8d12f4a7.json` explicitly records zero executed cases
and the launch blocker. Do not count the presence of this harness as passed
browser evidence or use it to bypass a separate UI-upload permission boundary.

All completed storage-handler regressions in this packet model the IndexedDB
event source. The production class is real; browser scheduling, transaction
rollback, quotas and crash behavior are not established by those models.
