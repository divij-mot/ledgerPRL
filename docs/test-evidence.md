# Test evidence

Development checkpoint, 2026-10-09. Passing software tests are not physical Ledger proof, a human security audit, or mainnet readiness.

## Recorded host checks

- Rust no_std core unit/integration, compile-fail, parser/amount property and hostile-APDU tests; independent rust-bitcoin BIP341 differential checks and cross-language derivation/serialization/signature fixtures. Host Clippy and formatting checks use the pinned CI toolchain.
- TypeScript SDK/wallet/companion tests cover exact amounts over 2^53, malformed bundles/transactions, field tampering, terminal error/cancellation, reservations, backup restoration, interrupted-signing recovery and concurrency. Host typechecks and production builds passed at recorded checkpoints. [Companion test boundaries](../apps/companion/test/README.md) distinguish real host modules from mocked browser/storage/transport/network behavior.
- [Independent state-machine campaign and mutation audit](../tools/core-state-review/REPORT.md): the hardened harness passed 85,599,171 APDUs with public mock signing callbacks; 13 selected in-scope broken implementations were detected independently. Repeated original/hardened traces are counted separately, never added. This harness deliberately does not provide independent cryptographic or physical-zeroization evidence.
- Pinned upstream Pearl commit 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701: upstream node/txscript and node/btcutil/hdkeychain test packages pass.
- Independent Go oracle tools/pearl-oracle: actual Pearl computes both fixture BIP341 digests identically, verifies both signatures, executes both Taproot spends successfully, and matches account public key, BIP86 scripts, receive address, txid and wtxid. Fixture amounts include 9007199254740993 grains. Different valid Schnorr nonce choices are allowed.

Commands (from root unless noted):

```
cargo +1.99.0 test --locked --workspace
cargo +1.99.0 clippy --locked --workspace --all-targets -- -D warnings
cargo +1.99.0 fmt --all -- --check
npm run check
(cd tools/pearl-oracle && go run -mod=readonly . ../../fixtures/protocol-v1.json)
```

## Recorded native and browser evidence

- [Final native qualification](../tools/native-release-qualification/README.md): all 25 combinations of five modeled devices and five networks passed builds, read-only network/address checks and offline package verification; all five simnet targets passed six runtime suites each. The [earlier native evidence index](../apps/ledger/tests/evidence/README.md) retains historical snapshots separately. This is not physical OS qualification.
- [Actual Pearl integration](e2e-evidence.md): all five modeled release targets completed 16-input simnet signing, acceptance, mining and reorg checks; a separate Nano S Plus run covered all four distinct-key tweak-parity combinations. The public script-engine fixture itself has synthetic outpoints and was not mined or broadcast.
- [Trusted-display review](../apps/ledger/tests/evidence/trusted-display/README.md), [mixed-session stability](../apps/ledger/tests/evidence/stability/README.md), and [offline package verification](../apps/ledger/tests/evidence/packaging/README.md) retain their exact scope and artifact hashes. App memory was measured in separately instrumented emulators; release timing is host-observed emulator time, not physical-device performance. See [firmware measurements](firmware.md#instrumented-memory-measurements).
- [Built companion desktop rendering](../apps/companion/test/evidence/rendering/README.md): empty-state presentation/navigation was checked in an actual cloud browser. [Companion qualification limits](companion.md#verification-and-remaining-qualification) identify what this bounded review did and did not exercise.

## Final lexical-key-lifetime requalification

The final `crypto.rs` source hash is `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`. Its current retained checks are:

- [Independent optimized-code cleanup review and replay](../tools/compiled-cleanup-review/README.md): all 25 exact model/network ELFs passed bounded original-slot control-flow/address and zero-store checks. Explicit stores cover the 32-byte scalar, 32-bit length and 8-bit curve field; three ABI padding bytes, register/spill copies, SDK scratch, OS exceptions and physical erasure are outside this claim.
- [Definitive normal-ticker timeout run](../tools/native-wallclock/final-requalification/README.md): all five modeled devices passed receiving, review and partial-export expiry at exactly 1,200 ordinary ticks, 60 stale-state rejections, fresh approval/signature recovery, and five 125-second idle controls. A separate validator replay passed. Earlier failed, interrupted and canceled attempts remain explicitly recorded and do not count as passes.
- [Final trusted-display requalification](../apps/ledger/tests/evidence/trusted-display/final-requalification/README.md): 125 accepted flows, 400 exact displayed fields and 20 warning details across five models. Six Stax capture-recovery repeats add no unique coverage.

- [Final transaction and repeated-session matrix](../tools/native-release-qualification/README.md): 30 suites, 77 hostile-event cases, 220 node-roundtrip checks and 100 mixed sessions passed. Ten retained transactions contain 100 native signatures, rechecked by the SDK and pinned Pearl script engine. Its 63-file native/runtime source snapshot predates subsequent host-only recovery changes; those changes receive separate host regression tests.
- [Canonical-path reproducibility](../tools/build-reproducibility/README.md): all 25 isolated rebuilds and complete packages match their reference bytes exactly. Four different-path builds differ in loadable code/data; three remapping pilots did not solve that. The tested builder uses fixed logical paths, pinned installed tools and private SDK/cache copies. This is not a claim of arbitrary-builder portability.
- [Fresh release crosscheck](../tools/final-release-review/README.md): independent artifact/source/count checks and six negative/portability controls passed, including a separate root replay.

These results do not retroactively rebind older resource reports or later host changes to this source. Physical and exceptional OS behavior remain separate.

Reports apply to their recorded source/tool/artifact hashes, not automatically to later edits. [Checkpoint mappings](checkpoints.json) relate retained local source commits to published commits with the same Git tree.

## Not established

Physical installation/signing/screens/restore, physical app/OS memory and latency, full loaded-account browser/import/IndexedDB interruption workflows, every intended model/network/retail-OS combination, final exact-commit CI, third-party human audit and Ledger functional/release approval remain gates. The original Nano S is unsupported; retail Nano X requires a vendor-controlled distribution route. No passing software result authorizes valuable-funds use, hardware changes, submission or publication.
