# Retained Session state-review result

## Current result: hardened v2

The complete portable v2 campaign passed on 2026-10-09. No production counterexample was observed across **85,599,171 APDUs**, including all directed suites and one million large randomized episodes across four seeds and five networks.

The campaign recorded 2,021,281 review callbacks, 1,992,609 successful approvals, 10,046,469 signing callbacks, 3,887,998 signature releases, 20,320,457 expected rejected APDUs and 3,213,434 lifecycle resets. Every result matched the state/response/callback oracle. See `results/hardened-v2/summary.json`, complete run logs and metadata. Rejected APDUs are intentional negative tests, not failed tests.

The original campaign has its own preserved source, report, hashes, logs and 85,599,171-command total. **Do not add the two campaigns' counts**: v2 reruns the same deterministic traces with stronger assertions. Original evidence is under `results/original/`; its source is `provenance/original-main.rs`.

## Independent audit and corrections

An independent mutation audit exposed original harness gaps: callback status expectations reused production Error::status_word; recipient/change accessors and confirmation arguments were incompletely checked; unknown direct-binary suite names could report zero coverage. The retained v2 harness now uses literal status mapping, independently decoded complete recipient/change fields and ordered outputs, input-wrapper consistency, complete account/address confirmation arguments, and explicit unknown-suite/zero-coverage refusal.

The independent reviewer verified a clean v2 directed replay and detection of **13 of 13 in-scope synthetic defects**. The constant-sighash and physical-zeroization mutants remain explicitly outside this harness's independent scope. The reviewer separately confirmed the repository's rust-bitcoin differential digest test rejects the constant-sighash mutation. The compact mutation summary is `audit/results/hardened-v2/mutations-summary.json`; the portable runner, exact patches, historical/v2 logs and concise report are retained under `audit/`.

## Portability and provenance

- V2 source SHA-256: `c91d2246ce829a32e5507b052273f4465e34cf8ec77dc460d89306697e872e18`.
- Original source SHA-256: `528ccb34685a352f7280c3a55ad0577566f9d2022cdeb7da7494b33d5967d84b`.
- Reviewed production snapshot provenance: commit `87ca040566122a290c79a0a1fbd7590723b9da81`; exact core/manifest/lock hashes remain in `provenance/production-source.sha256`.
- Toolchain: `rustc 1.99.0 (b940084d7 2026-09-28)`; locked offline release build with overflow checks.
- Full v2 campaign ran through the portable wrapper in an isolated minimal checkout fixture whose directory contained spaces. Its core sources and manifests matched the live repository exactly; no production snapshot is included in this retention package.
- Full-campaign runner is archived for exact attribution. Subsequent final-wrapper read-only guards were checked separately: a 15,709-command space-path smoke, a 3,256,677-command final-wrapper directed baseline, exact Cargo dependency resolution, and 18 isolated positive/refusal controls passed. Those counts are not added to either campaign.
- Strict Clippy, rustfmt and Python syntax checks passed. Unknown suites and zero episodes exit 2.

The supported wrapper refuses changed/missing/extra production or harness source, modified portable manifests/locks, unexpected build scripts, source symlinks and checkout-local Cargo configuration before building. It verifies the resolved core dependency and repeats source checks after each run. It has no mismatch-override option.

The package contains no target/cache/binary or copied production source. Production files, existing tests and Git state were not modified by this work. See README for placement and replay commands; runnable entrypoints discover paths at runtime; absolute paths in historical audit logs are retained only as provenance.

## Limits

These are finite deterministic tests, not proof or a security guarantee. Public mock keys/signatures are not real BIP340/secp256k1. Commitment hashing, address formatting and sighash calls share production implementations; there is no independent cryptographic oracle here. Separate repository digest and Go/native fixture evidence is identified in README. Physical approval, hardware isolation, native SDK behavior, transport integration, entropy and physical zeroization are not established. Source pre/post checks are not filesystem immutability or a hermetic toolchain guarantee.
