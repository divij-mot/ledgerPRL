# Companion and SDK final boundary review

Initial reviewed source: d1fd0d38069c09b871b836377812e2fc4bef8b3d.
Original source hashes are retained in `ORIGINAL-SOURCES.json`; final tested
source hashes are in the terminal results and `VERIFICATION.json`.

## Confirmed findings

1. Full-backup capacity mismatch. On original source, 2,000 valid 16-input
   signed payments produced 16,944,441 bytes of pretty JSON, above the 16 MiB
   export limit. All 32,000 signatures independently verified, every input was
   distinct, and every payment passed the declared fee/dust policy. This is a
   recovery-availability bug; it does not bypass signatures or release inputs.

   Fixed by compact JSON and omission of diagnostic last-error text alongside
   already-excluded local signing-attempt authority. Every recovery field,
   including archive records, remains. Old backups remain readable and the
   16 MiB importer limit remains. Actual compact output: 16,218,359 bytes.
   Conservative maximum serialization, including widest permitted metadata,
   is 16,588,384 bytes. Compact JSON alone is insufficient when all records have
   worst-case escaped diagnostics. Repository regressions use the actual SDK
   serializer to establish the 3,620-character maximum signed transaction and
   actual account serialization widths.

2. Maximum-journal reconciliation deadline. The actual UI failed after
   80,065 ms while locally verifying a valid restored 2,000-payment journal,
   before its first RPC and with no journal change. Moving the same deadline
   after local validation alone is insufficient: the actual bridge also repeats
   signature verification, taking another 124,682 ms on this host.

   Fixed policy: keep record/signature bounds and yielding/cancellation for
   local validation; then allow 80 seconds per necessary 100-record batch,
   capped at 20 batches / 1,600 seconds. Existing request timeouts, 4,160-call
   ceiling, signature checks, same-tip requirement and atomic compare/commit
   remain. The owned network timer and forwarded cancel listener are explicitly
   cleaned up on cancellation, failure and success. A changing real chain tip
   can still require a retry; no reorg semantics were relaxed.

   The first complete actual-UI / actual-bridge replay passed in 308,550 ms:
   183,734 ms local checks, 124,682 ms bridge checks, 20 batches, 2,180 read-only
   mocked RPCs and one atomic commit. All signed bytes and 32,000 reservations
   remained unchanged. That first run predates final explicit timer cleanup.
   A later exact-timer run was interrupted by executor disconnection and is
   explicitly marked incomplete. The final current-parent replay then passed
   and its process exited 0: 296,701 ms total, 176,594 ms local checks, 119,968 ms
   actual bridge checks, 20 batches, 2,180 read-only mocked RPC calls and exactly
   one atomic commit. Every signed byte and all 32,000 reservations matched.
   `reconcile-parent-final.json` records the exact tested main/dependency hashes;
   `parent-reconcile-function-match.json` matches the final reconciliation body
   to the frozen, independently reviewed revision.

3. Synchronous import responsiveness. Unchanged cryptographic import of the
   same journal took 187,604 ms, and a current-parent roundtrip took 191,158 ms.
   A zero-delay callback could not run during either import. This is a CPU/UI
   responsiveness limitation, not relaxed validation. Separate changes move
   the unchanged validator into a one-shot module worker; its testing is
   recorded separately and this report does not qualify actual browser use.

## Independent checks and boundaries

Sixteen fresh SDK/recovery probes cover caller mutation during signing, wrong
review hash, invalid/shuffled witnesses, changes to recipient/value/fee/input
fields and order, configured-network rejection, uncertain-backup callback
ownership, archive authority stripping and corrupted signed bytes/reservations.
No fresh signature-to-intent bypass or lock-release bug was demonstrated.

Eight fake-clock orchestration cases check delayed local CPU work, combined
batch allowances, deadline expiry, cancellation and changed tips. Five existing
genuine-signature UI/bridge controls pass with the changed scope. Final controls
assert no retained owned timer or forwarded listener. A separate reviewer also
reported passing 7 independent count cases and 7 teardown cases, including
cancel/deadline while storage commit was queued; those reports are separate
from the cryptographic capacity run.

All work is offline and deterministic with published BIP32 vector-one fixtures.
No user key, funded account, physical device, browser import/upload, live node,
external write or network broadcast is used. DOM/storage/RPC in capacity replay
are explicit mocks; SDK/bridge signature validation is real. Control-flow-only
regressions that stub signatures say so explicitly. This is not IndexedDB crash,
physical-device, consensus, browser CSP/WebHID or live-node qualification.

## Portable rerun

Use Node 24.19 from the repository root, with its installed dependencies. Set
PRL_ROOT to test a different checkout, PRL_REVIEW_OUTPUT to a writable evidence
folder, and PRL_REVIEW_JOURNAL to a preexisting generated journal if needed.
The 16 MiB journal is deliberately not committed. It is regenerated from the
public fixture; its deterministic compact SHA-256 is
54d70adaecb7ace97221ca34912c9c93e0a180d94195533605219a65e4ae96b3.

    export PRL_REVIEW_OUTPUT="$(mktemp -d)"
    node --import tsx path/to/intent-boundaries.mjs
    node --import tsx path/to/backup-ceiling.mjs --expect-fixed
    node --import tsx path/to/parent-roundtrip.mjs
    PRL_RECONCILE_LABEL=reconcile-parent-final node --import tsx path/to/reconcile-capacity.mjs

Generation and full signature validation take minutes. Omitting --expect-fixed
from generation reproduces the original export failure on the old checkout.
Source/dependency hashes accompany capacity results. Existing result files
must not be mistaken for a fresh replay against modified source.

## Final parent checks

The parent reported final combined checks passing: 100 SDK, 71 wallet and 88
companion tests, workspace type checks, build and secret-pattern scan. These are
parent-run aggregate checks, separate from this packet's independent probes.
Node version for the capacity replay was v24.19.0. `VERIFICATION.json` records
the final terminal result and a readback match of production source hashes.
`SHA256SUMS` covers this compact packet; it excludes the reproducible large
public journal.
