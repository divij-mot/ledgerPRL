# Independent production Session state-machine review

Completed 2026-10-09 at approximately 18:22 UTC.

## Result

No production counterexample was observed. Five completed runs of the final external harness agreed with an independent APDU/state/callback oracle for **85,599,171 APDU commands**. No production, native, SDK, or existing checked-in test source was changed.

The recorded successful campaign contains:

- 1,000,000 large grammar-biased random-walk episodes across four distinct seeds and all five networks, plus directed suites and a smaller independent walk.
- 2,021,281 review callbacks and 1,992,609 successful review approvals.
- 10,046,469 signing callbacks, including deliberately failing callbacks.
- 3,887,998 expected signature releases.
- 20,320,457 expected rejected APDUs and 3,213,434 explicit lifecycle resets.

Every command checked the exact status, response bytes, resulting state, callback sequence, and approval epoch. Each signature callback required approval during that same APDU invocation and equality of the entire signed transaction with the reviewed snapshot. Every failure was checked for an empty response and return to Idle. Subsequent probes checked that stale review/fetch commands could not release signatures.

## Reviewed target and evidence

- Snapshot commit: `87ca040566122a290c79a0a1fbd7590723b9da81`. At completion, live HEAD was `80ceec9f8b318b2d6ae90e496abf078e60802518`; all reviewed core sources, manifests and lockfile still matched the snapshot hashes, and the live checkout was clean.
- Production core and manifest hashes: `results/production-sha256.txt`.
- Harness source SHA-256: `528ccb34685a352f7280c3a55ad0577566f9d2022cdeb7da7494b33d5967d84b`.
- Harness executable SHA-256: `f65a4bcab3b72519feb3ca3f90885f38894747893d7a47e40ff460b8b0b30c13`.
- Toolchain: `rustc 1.99.0 (b940084d7 2026-09-28)`.
- Build: offline release build with overflow checks enabled. Harness dependencies match the versions in the copied production lockfile.
- Strict harness Clippy (`--no-deps -- -D warnings`) passed.
- Snapshot and harness hashes were rechecked after the run.
- Exact run counters and included/excluded log names: `results/summary.json`.
- Full methods, limits, and commands: `README.md`; reproducible sequence: `run-review.sh`.

Completed seeds: `53544154455f5632` (all suites), `0000000000000002`, `9e3779b97f4a7c15`, `deadbeef20261009`, `ffffffffffffffff` (50,000 walk episodes per network each).

## Directed coverage that avoids shallow invalid-header fuzzing

- All 65,536 BEGIN size values, all 256 instruction bytes across six states and four body shapes.
- Every upload split boundary for 1-, 2-, and 16-input bundles, with and without change, on all five networks.
- All 14 Error variants at validation, every ownership derivation, review, and every signing position, followed by restart and fresh approval.
- Every bit of representative 1-, 2-, and 16-input bundles mutated with recomputed commitments, exercising parsing and ownership rather than only commitment rejection.
- All truncations of those bundles, trailing bytes, amount boundaries/aggregate overflow, duplicate outpoints, path hardening boundaries, output-role policy and output ordering.
- Reset/disconnect/timeout/app-exit at receiving and every signature-release position; interleaving, cancellation, abort, restart, partial failures, sequential fetch, out-of-order fetch, duplicate fetch and reuse of the same transaction with a new approval epoch.

The random walks reuse the same actual Session and Device across many transactions. The existing checked-in public mock expects exactly one lifetime review, so this separate epoch-aware mock adds meaningful repeated-session coverage without altering those tests.

## Tooling correction and exclusions

An incomplete early large run exposed a diagnostic-history performance issue in the harness: lifecycle reset messages were not initially bounded. This was fixed locally by bounding all trace additions. It did not expose a production failure. The interrupted run and an earlier successful exploratory source revision are excluded from the reported totals. The corrected source was rebuilt, checked, and rerun with fresh seeds; directed suites were also rerun against that exact final source. No production counterexample existed to shrink.

## Limits

This is finite deterministic testing, not a proof or a security guarantee. It establishes observed behavior of the actual Rust Session API under these modeled device responses. The independent parser uses offset-based records, a set of outpoints, and u128 amount sums, but the oracle shares production SHA-256 commitment and address formatting helpers. Mock keys/signatures are deterministic public bytes, not secp256k1/BIP340 implementations. Real cryptography, physical review, hardware isolation, native SDK behavior, transport integration, entropy and physical memory zeroization remain outside this result. No hardware, real keys, credentials, funds, remote services or vendor actions were used.
