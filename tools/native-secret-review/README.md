# Pearl native secret-lifetime host controls

Expected frozen crypto SHA256:
`50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

The checked RNG and lexical key scopes are present in this source. The runner refuses earlier or changed sources, checks the complete live core Rust inventory and relevant SDK provenance, and repeats the checks after testing. It never edits repository files. An exact source match does not prove deployment.

## Required setup and run

Requirements: Python 3.9+, Git, Rust/Cargo with edition-2024 support (reviewed host toolchain: 1.99.0), a host C compiler for libsecp256k1, prepared pinned Ledger SDK checkouts, and cached locked host dependencies. No native target toolchain, emulator, device, credentials or funds are used.

The full-provenance check intentionally fails if either vendor checkout is missing. Prepare them with the repository's existing script; it verifies the exact SDK commits, full tracked Rust-SDK patch, absence of untracked Rust-SDK files, and clean secure SDK. This setup downloads official Ledger sources when missing; it does not build native applications.

```sh
cd /absolute/path/to/ledgerPRL
bash scripts/ledger-prepare-sdk.sh
python3 /absolute/path/to/native-secret-review/run.py \
  --repo "$PWD" --output /absolute/path/to/fresh-audit-output
```

Output must be a fresh directory outside the repository. It contains the generated instrumented source, temporary host Cargo project, logs, test binaries and `summary.json`; these generated files do not belong in this source-only package. The core dependency points directly to the verified repository's `crates/pearl-core`, with no source snapshot substituted. Paths containing spaces were tested.

The runner executes `cargo test --locked --offline` in debug and release profiles. Optional arguments: `--cargo /path/to/cargo`, `--toolchain 1.99.0` (default: stable), or `--check-only`. CARGO_HOME/RUSTUP_HOME may select installed caches/toolchains; compiler-wrapper, RUSTFLAGS and cross-target overrides must be unset. Missing dependencies are a hard failure. For an initially empty cache, an explicit `cargo fetch --locked --manifest-path OUTPUT/host-project/Cargo.toml` after the first offline failure can populate the exact locked dependencies, followed by a new run in a fresh output directory. Do not count that failed first run as a pass.

## Eight controls

1. Returned RNG error aborts before key construction/derivation and invalidates the signing session.
2. Successful signing retains the 32-byte auxiliary data and BIP340 PROVIDED mode, and produces a verifiable signature.
3. Nine modeled derivation/init/public/hash/add/sign/verify failures wipe key scalar/metadata and prevent signature export.
4. Incorrect returned signature length fails before verification/export.
5. Sixty-four public synthetic scalars agree with independent public-point BIP86 tweaking, covering 31 odd and 33 even internal points.
6. Exact-order tweak, zero result, and post-tweak public-generation failure fail closed.
7. Ordinary returned master-identifier error is propagated after the account key is wiped.
8. Original key-slot wipe occurs before the identifier syscall or public verification.

The live crypto module receives only one generated observer call, immediately after PrivateKey Drop's three zeroization statements. The host mock records the original scalar address during key initialization; the observer must see that same address plus zero scalar/metadata. A narrow source precondition also rejects explicit `drop(key)`. No production test branch or substituted crypto implementation is added. SDK calls are host mocks backed by SHA256/libsecp256k1 and synthetic scalars; the real core parser/Session supplies the review token, with a mocked UI/provider.

## Evidence and future CI

`expected.json` binds source files, host harness/lock and SDK commits. `evidence/final-host-results.json` records the final-source 8+8 pass. `evidence/final-assembly.md` and `final-elf-review.json` bind the separate manual optimized original-slot review to five exact simnet pilot ELFs. The mainnet-assembly.md and mainnet-elf-review.json supplements add all five exact mainnet variants, with 50 relocation-aware region comparisons. `historical-assembly.md` records earlier findings, including the rejected by-value-drop implementation that passed the old contents-only observer. These observations are not interchangeable.

A future lightweight CI integration can use the existing SDK-prepare script and locked host-cache setup, then this runner: no Ledger native build is necessary for host controls. Current normal CI does not prepare vendors, so invoking the runner there without a required setup step must fail. Do not silently skip provenance checks. Source/hash changes require explicit review and manifest updates; this package intentionally does not auto-bless changed production code. A separate native ELF and physical-device gate remains necessary.
