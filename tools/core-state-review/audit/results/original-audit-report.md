# Independent audit of the Pearl core-state harness

Audit date: 2026-10-09. Scope: the existing external harness and read-only production core, with deliberate mutations confined to this audit directory. No production vulnerability is asserted by a deliberately broken copy passing a test. No production source or existing evidence was changed. No network service, hardware, real account, credentials, or funds were used.

## Hardened result and independent verification

The separately retained hardened-v2 harness closes the five demonstrated in-scope blind spots. Its source SHA-256 is `c91d2246ce829a32e5507b052273f4465e34cf8ec77dc460d89306697e872e18` (retained package `tools/core-state-review/src/main.rs`). I reviewed the changes and reran every mutation independently: **13 selected in-scope mutants detected; 2 explicit exclusions survived; no build failures**. The normal v2 baseline passes the complete 3,256,677-command directed/small-walk campaign with exactly the original counters. Unknown suites, zero episodes, and extra arguments now refuse with exit 2.

The two surviving mutants are constant BIP341 digest and omitted buffer zeroization. These are scope controls, not approved behavior. Separately, I copied the existing production `tests/sighash.rs`, its public fixture/helper, and unmodified core into an isolated workspace and ran the existing offline/locked Rust differential suite: **4 tests pass normally; the constant-sighash mutant fails 3 tests**. This demonstrates independent host digest/fixture coverage elsewhere. No native emulator, Go node, or physical-device test was rerun by this audit.

Portable-source preflight also passed independent negative controls for modified core source, extra core modules, unexpected core build script, changed harness source, redirected harness dependency, modified harness lockfile, unexpected harness build script, and source symlinks. Clean and restored controls pass. This binds checked source/build manifests in an ordinary trusted Cargo environment; it is not a toolchain/supply-chain attestation.

A full hardened campaign is being retained separately by its owner. Do not combine its repeated seeds/counts with original counters or apply original logs retroactively to changed harness code. This audit's v2 verification is the complete directed/small-walk campaign and mutation controls described here.

Reproduce the hardened audit with `python hardened/run-mutations.py`; evidence is under `hardened/results`. Reproduce separate host digest controls with `python run-digest-control.py`; evidence is under `results/digest-control-*`. `run-provenance-probes.py` checks the retained package from its recorded local path in an isolated copy.

## Result at the original harness revision

The state/parser oracle is substantive, but its original independence claims need qualifications. The unchanged original source reproduces its recorded small campaign exactly: 3,256,677 APDU commands, with the same per-suite and final counters. Eight targeted security/state regressions are detected. Seven other mutations survive all five directed/random suites, demonstrating specific testing gaps or explicitly documented exclusions.

Original harness source: SHA-256 `528ccb34685a352f7280c3a55ad0577566f9d2022cdeb7da7494b33d5967d84b`.

### Original gaps, now fixed in hardened v2

1. **Callback status words share the implementation under test.** The model calls production `Error::status_word()` for callback failures (original `src/main.rs` lines 454, 461, 487, 496, 552, 566, 575, 583). Changing `UserRejected` from `0x6985` to success `0x9000` passes every suite. The original mock still verifies that no signature is released after rejection, but it cannot independently establish that rejection has a non-success status. The mutant reduces the counted APDU failures by 588 while the executable still reports PASS. Use an independent literal mapping for all 14 errors.

2. **Review-facing recipient/change accessors are incompletely observed.** The review mock reserializes the underlying raw transaction and checks totals, address strings, input paths, and only `change().is_some()`. It does not check the actual `ValidatedTransaction::recipient()` or `change()` output content. Returning the change output from `recipient()`, or the recipient output from `change()`, both pass the entire original campaign. Native `apps/ledger/src/ui.rs` lines 159–172 use these methods for displayed amounts and the change path. Add independent decoded amount, role, branch, index, and script/key checks for each accessor, plus ordered wrapper input/output comparisons.

3. **Confirmation callback arguments are only partly represented.** The original mock ignores both arguments to `confirm_account`, and ignores the path supplied to `confirm_address` (lines 189–198). A wrong public-account confirmation payload and an unrelated address confirmation path both pass all suites. Record and compare the complete callback arguments, not just occurrence/address text.

4. **Unknown suite names can produce zero-work success.** Invoking the original binary with `1 0 misspelled_suite` exits successfully with `PASS TOTAL` and zero commands. This is not an observed error in the archived runs, whose counters were verified. Reject unsupported modes and zero-work execution. The new portable wrapper's fixed suite list already limits this particular caller mistake.

### Exclusions demonstrated rather than mistaken for coverage

- Changing every valid `Transaction::sighash()` to the same constant passes the entire state campaign. The mock compares `ReviewedTransaction::sighash` to the same underlying production function, and its public signature token is computed from the raw bundle rather than the digest. This is a forwarding/approval test, not an independent BIP341 oracle. Document this explicitly alongside shared bundle hashing and address encoding. Existing separate Rust differential tests are in `crates/pearl-core/tests/sighash.rs`; native/Go evidence is separately described in `docs/test-evidence.md` and `docs/e2e-evidence.md`.
- Removing all session buffer-zeroization calls also passes the API-state harness. This agrees with its documented memory-zeroization exclusion; it is not evidence that zeroization is unnecessary. Production has a separate internal storage-reset unit test. Neither kind of host test establishes physical hardware memory erasure.

## Positive mutation controls

The original harness detects each of these separate mutations, by assertion failure rather than build failure:

- Omit the review approval callback.
- Ignore a signing callback failure and synthesize a successful signature slot.
- Leave the session state live after an APDU error.
- Bypass input ownership matching.
- Bypass change ownership matching.
- Accept an out-of-order/replayed signature-fetch index.
- Return the wrong signature slot.
- Bypass the upload commitment check.

These results substantiate the fresh-approval, ownership, all-input-signing-before-release, sequential release, and fail-closed observable-state checks. They do not establish exhaustive bug detection.

## Oracle, coverage, and provenance audit

- Parsing does not call production `parse_bundle`. It uses independently sliced fixed records, a set for duplicate outpoints, literal policy bounds, and `u128` amount totals. The state model owns separately allocated byte buffers and signature tokens. The model does mirror protocol control flow, as expected for an exact status/order oracle, and has the shared-helper exclusions above.
- The mock requires successful approval during the same APDU invocation before signing; compares the entire serialized transaction against its reviewed snapshot; and adds a monotonically increasing approval epoch to each signature token. Ordered callback events and response bytes are compared for every APDU.
- Actual loop counts match the stated directed coverage: 327,680 declared BEGIN-length cases; 30,720 opcode/state/body combinations; 19,230 upload split boundaries; 6,370 callback-fault cases; and 78,000 individual serialized-bit mutations. The `episodes` statistic mixes some directed cases with walk episodes and is not a unique-transaction count. The four large runs contain 1,000,000 walk episodes; the small run adds 1,000 walk episodes.
- Parsed totals from all five included archived logs match `summary.json`: 85,599,171 APDU commands. Excluded exploratory/interrupted logs are not included. This audit independently reran the complete directed/small-walk campaign, not all four large random seeds.
- All seven core source files, crate/root manifests, and root lockfile match the recorded SHA-256 values in the snapshot, current production checkout, and the recorded original Git commit `87ca040566122a290c79a0a1fbd7590723b9da81`. Current checked HEAD at audit was `80ceec9f8b318b2d6ae90e496abf078e60802518`; the core content still matches. The original harness and original executable hashes verify. Harness dependency versions/checksums match production's lockfile.
- This is a host Cargo build of the same Rust source, not the native Ledger target, SDK/UI/transport execution, BIP340 cryptographic signing, physical isolation, or a third-party human audit. Source hashes and exact replay bind the observation to identified source; they do not confer a security guarantee.

## Reproduction and evidence

From this directory:

```
python run-mutations.py
```

The driver uses only the copied `snapshot`, rebuilds each of 15 separate mutants offline/locked, and runs `53544154455f5632 200 all` for each. The source is restored after the experiment and the normal binary rebuilt. Each build/run is bounded by a 120-second subprocess timeout. Requires the recorded locally installed toolchain/cache at `/tmp/pearl-cargo` and `/tmp/pearl-rustup`.

- `results/mutations-summary.json`: actual exits and patch hashes.
- `results/*.patch`: exact independent source mutations.
- `results/*.run.log` and `*.build.log`: complete observations.
- `results/baseline.run.log`: exact unmodified replay.
- `results/provenance-and-counts.json`: Git/source/dependency/counter reconciliation.
- `results/restored-source-check.log`: copied core restoration check.

The original harness and original campaign evidence were left unchanged. The separately versioned hardened-v2 verification is summarized above; its new results must not be added to or represented as the original campaign's evidence.
