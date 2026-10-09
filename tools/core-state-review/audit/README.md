# Independent mutation audit

## Result

The original state harness had five demonstrated missed mutation cases: a rejection reported as success, swapped recipient/change review accessors, and incorrect account/address confirmation arguments. Hardened v2 catches all five, in addition to the eight original positive controls: **13 selected in-scope mutants detected**. Both unchanged baselines independently passed the exact 3,256,677-command directed/small-walk campaign. No production defect was demonstrated by these deliberately modified copies.

Two controls intentionally remain outside the state harness's independent coverage: constant BIP341 sighash and omitted memory zeroization. Separate existing Rust digest tests passed 4/4 normally and failed 3/4 with the constant digest. This is host evidence, not native SDK, physical UI, hardware isolation, or real-funds qualification.

Original and hardened results are retained separately. Do not add their repeated command counts together or attribute older evidence to changed code. The original 85,599,171-command campaign's log arithmetic and core-source/commit hashes reconciled independently; this audit itself reran the directed/small-walk campaign, not those four large walk seeds. The separate complete hardened campaign is documented by the parent package.

## Portable runner

Install this directory as `<repository>/tools/core-state-review/audit`, beside the retained v2 harness. No full production source, compiled executable, dependency cache, or target directory is bundled here.

With the pinned Rust 1.99.0 toolchain and dependency cache available:

```sh
export PRL_REPOSITORY="/path with spaces/Pearl"
python "$PRL_REPOSITORY/tools/core-state-review/audit/run_mutations.py" preflight
python "$PRL_REPOSITORY/tools/core-state-review/audit/run_mutations.py" smoke --output "/new evidence directory"
```

`smoke` runs the unchanged baseline and rejection-status/recipient/change mutations. Each uses the fixed seed `53544154455f5632`, 200 walks per network, and every directed suite. On the recorded host it completes in approximately 20 seconds. Each build, metadata query, and harness subprocess has a 120-second timeout.

- `all`: baseline plus all 15 separate mutations, including the two expected scope exclusions.
- `--cases baseline,rejection_status_is_success`: run a bounded named subset; baseline is always included.
- `--harness original`: explicit historical control using the retained `provenance/original-main.rs`. The default is hardened v2; there is no silent historical fallback.
- `--repository` / `PRL_REPOSITORY`: live repository containing the reviewed core. When installed, its path can also be inferred.
- `--package` / `PRL_REVIEW_PACKAGE`: retained harness package; inferred from the installed audit directory by default. Supply explicitly when running this audit directory standalone.
- `--cargo`, `--rustc`: individual executable paths, including paths with spaces. Defaults use `CARGO`, `RUSTC`, or PATH. Do not put shell commands/arguments into these values.
- `--cargo-home`, `--rustup-home`: optional cache/toolchain paths; the corresponding environment variables are supported.
- `--output`: a new evidence directory; existing directories are refused.
- `--work-parent`: optional existing parent for an automatically removed temporary workspace.

The runner first checks exact live core hashes/inventory and retained harness/build hashes, captures verified bytes, and builds only a new temporary copy. It refuses unexpected build inputs/local Cargo configurations and checks that Cargo resolves `pearl-core` to that isolated copy. Every mutant starts from pristine captured core bytes; its generated patch must equal the retained patch. All subprocess arguments use arrays, without shell interpolation. The live source is rechecked afterward. Compiler wrappers are refused. Global toolchain/cache/configuration trust is not a supply-chain attestation.

A build failure, timeout, unexpected exit, changed patch, or missed expected mutation fails the runner. Expected surviving scope controls are labeled `SURVIVED`, never treated as security proof. Fresh run metadata records the selected source hash, runner/spec hashes, arguments, actual exits, and whether expectations matched.

## Retained evidence

- `results/original/`: original baseline/mutation logs and summary (8 detected, 7 survived).
- `results/hardened-v2/`: v2 baseline/mutation logs and summary (13 detected, 2 survived), plus CLI refusal controls.
- `patches/` and `mutations.json`: exact source modifications and portable specifications.
- `results/provenance-and-counts.json`: original source/commit/dependency/counter reconciliation.
- `results/digest-control-*`: separate existing host BIP341 differential controls.
- `results/original-audit-report.md`: preserved historical report, including original absolute provenance paths. Its paths describe that execution environment; use the portable runner above for new work.

Source identity: v2 `c91d2246ce829a32e5507b052273f4465e34cf8ec77dc460d89306697e872e18`; original `528ccb34685a352f7280c3a55ad0577566f9d2022cdeb7da7494b33d5967d84b`.
