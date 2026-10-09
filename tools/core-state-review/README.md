# Portable Pearl Session state review

Retain this directory at `tools/core-state-review` in a Pearl checkout. It contains the independent harness, original campaign evidence and separately attributed hardened-v2 evidence. It includes **no production-source snapshot, executable, target directory or cache**. Cargo depends on `../../crates/pearl-core` and uses a separate workspace, leaving production workspace membership unchanged.

## Portable commands

Requirements: Python 3.9+, the original `rustc 1.99.0 (b940084d7 2026-09-28)` toolchain on PATH, Cargo, and cached locked dependencies. Paths containing spaces are supported. Standard `CARGO_HOME`, `RUSTUP_HOME`, `CARGO_TARGET_DIR`, `CARGO` and `RUSTC` variables are honored; no machine-specific path is embedded.

From the repository root:

```sh
python3 tools/core-state-review/run_review.py preflight
python3 tools/core-state-review/test_preflight.py
python3 tools/core-state-review/run_review.py smoke
python3 tools/core-state-review/run_review.py directed
python3 tools/core-state-review/run_review.py replay
```

From another directory, quote the script path:

```sh
python3 "/path with spaces/checkout/tools/core-state-review/run_review.py" smoke
```

`preflight` invokes no toolchain. `test_preflight.py` changes only isolated temporary test fixtures. `smoke` builds offline/locked and runs 40 randomized episodes per network with a distinct portability seed. `directed` runs the bounded 3,256,677-command directed baseline. `replay` runs all directed suites and four 50,000-episode-per-network seeds using the hardened harness. Failures stop execution. Fresh results go to a new timestamped `results/replays/` directory; `--output "another new directory"` selects a destination. Existing result directories are refused. Set CARGO_TARGET_DIR outside this package to retain a cache; otherwise a temporary build directory is removed afterward.

Use the wrapper. Direct Cargo invocation bypasses provenance checks and is not the supported replay procedure.

## Fail-closed provenance

Before invoking a toolchain, exact SHA-256 checks cover every production module, the core manifest, repository manifest and Cargo.lock, harness source, and portable build manifest/lock. Production and harness source inventories must match exactly. Unexpected build.rs, checkout-local Cargo configuration, missing/extra/modified source files and source symlinks are refused with exit 2. Cargo metadata must resolve pearl-core to the exact preflighted live manifest. Checks repeat after building and after every completed run. There is no mismatch-override flag.

If your checkout differs, stop. Use a matching historical checkout or obtain a newly attributed review. Updating provenance hashes to fit different code does not preserve historical test evidence. Checks do not make the filesystem immutable during execution or fully constrain global toolchain configuration/environment; avoid concurrent edits and use a trusted toolchain.

## Two distinct harness generations

Original source, SHA-256 `528ccb34685a352f7280c3a55ad0577566f9d2022cdeb7da7494b33d5967d84b`, is archived unchanged as `provenance/original-main.rs`. Its five completed campaign logs, summary and report are under `results/original/`. They record 85,599,171 APDUs. The archived original report is historical: its independence claims are qualified by the later audit described below. Historical filenames in that report now reside under `results/original/` and `provenance/`.

A subsequent independent mutation audit found that the original oracle shared production Error::status_word, did not fully check recipient/change accessors or confirmation arguments, and could report zero-coverage success for an unknown direct-binary suite. These were harness coverage gaps, not observed production failures.

Hardened-v2 source, SHA-256 `c91d2246ce829a32e5507b052273f4465e34cf8ec77dc460d89306697e872e18`, is `src/main.rs`. It adds:

- Literal independent protocol error/status mapping
- Independently decoded recipient/change amount, script/key, role, branch and index; complete ordered output checks and wrapper-input consistency
- Full network/path and account-public confirmation arguments
- Unknown-suite and zero-coverage refusal

V2 campaign evidence is under `results/hardened-v2/`; packaging controls and smoke evidence are under `results/portability/`. Counts from original and v2 campaigns are **not added together**. The original source/provenance remains unchanged. The wrapper used for the v2 full campaign is archived separately; final wrapper additions for checkout-local config refusal and resolved-dependency inspection have their own portability smoke and directed-baseline evidence. Future fresh replay results are Git-ignored under `results/replays/`.

## Coverage and important limits

The oracle checks exact APDU responses, states and callback order; same-command successful review before signing; complete transaction equality between review and signing; fresh approval epochs across repeated sessions; sequential release; and invalidation after errors, abort, disconnect, timeout and app exit. Directed suites cover all BEGIN lengths, every opcode across six states, upload boundaries, every callback error and signing position, recomputed-hash serialized bit mutations, amount/path bounds and malformed/interleaved commands.

This is finite deterministic public-mock testing, not a security guarantee. Mock signatures and keys are not real BIP340/secp256k1 operations. Commitment hashing, address formatting and sighash access use production helpers; the sighash comparison reaches the same implementation and **is not an independent cryptographic oracle**. Separate repository evidence includes the rust-bitcoin differential tests in `crates/pearl-core/tests/sighash.rs` and the Go/native fixture evidence documented in `docs/test-evidence.md` and `docs/e2e-evidence.md`; this package does not claim to rerun or replace them. Physical review, native SDK behavior, real cryptography, transport integration and physical zeroization remain outside this result.

## Independent mutation controls

The concise review is [audit/AUDIT_REPORT.md](audit/AUDIT_REPORT.md). Exact patches, portable mutation specifications/runner, and separate original/v2 control logs are retained in `audit/`. After installation:

```sh
python3 tools/core-state-review/audit/run_mutations.py preflight
python3 tools/core-state-review/audit/run_mutations.py smoke --output "new audit evidence"
```

The bounded smoke runs the baseline plus rejection-status and recipient/change defects in a temporary source copy, never the live checkout. For explicit repo/package/toolchain paths, selected controls, historical-source controls and space-path tests, see [audit/README.md](audit/README.md). Historical logs may contain original absolute paths; current runnable scripts contain no machine-specific workspace paths. Fresh audit executions are not added to either full-campaign total.
