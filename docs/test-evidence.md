# Test evidence

Development checkpoint, 2026-10-09. Passing software tests are not physical Ledger proof, a human security audit, or mainnet readiness.

## Current C-port and direct-website checkpoint

The current signer is `apps/ledger-bitcoin-prl`, a restricted Ledger Bitcoin-based C application. The previous Rust signer at `apps/ledger` and its custom canonical-bundle protocol are a different implementation. Its retained native results below do not qualify the C application or its PSBT protocol.

- [Latest aggregate host checkpoint](../tools/host-checkpoint-review/README.md), approximately 22:42 UTC: workspace typechecks, 415 tests (27 adapter, 64 optional Snap, 103 SDK, 86 wallet, 6 CLI, 129 companion), production builds and tracked-file secret-pattern scan passed. The optional Snap tests do not establish MetaMask integration. These are working-source results; final published-commit CI for the new changes remains a separate gate.
- [Wallet integrity/property review](../tools/wallet-property-review/REPORT.md): reproduced malformed persisted reservations and partial mutation on rejected direct merges, then checked the fixes. One campaign passed 12,447 cases with unchanged observed source hashes; the second passing 12,447-case campaign records a concurrent UI edit. Maximum-shape structural timing uses synthetic witnesses and is not browser/device/signature-validity evidence. The separate direct Chromium storage harness executed zero cases after its launch was blocked.
- [Website custody/privacy review](../tools/website-privacy-review/REPORT.md): nine deterministic checks, modeled UI context/cache controls, a bounded dependency error-path check and 31 focused tests passed. Source/build hashes are retained. No production private-key input or software-signing workflow/fallback was found; the bundle still includes generic cryptographic signing APIs. This is not a human audit, hostile-host privacy guarantee or universal telemetry/XSS proof.
- [Real-browser public-fixture review](../apps/companion/test/evidence/website-qa/astra-real-browser-2026-10-09.md): 12 bounded cases passed on `index-B9WJtHC4.js`, SHA-256 `4062ec6b173da7cb05dbc27a91928225571530a88171b47d2fbde8f1b4b671e0`. Explicit restore, close/form reset, narrow optional-cache removal and preservation of an existing unsigned draft/receive range across reload were observed through the actual UI. File imports, crash/eviction/cross-tab races, actual Ledger signing, live chain and public TLS were not exercised.
- [Public-indexer review](../tools/public-indexer-review/README.md): 18 existing and six independent offline cases passed, and selected pinned upstream source identities were checked. The fresh actual-client live probe was cancelled and produced zero usable live observations. Historical backend observations do not establish current availability or deployed-proxy compatibility.
- [Static native source review](../tools/device-source-review/README.md): provenance/control-flow inspection identified two unfixed low-severity trailing-byte/acknowledgement validation gaps. No build or native execution was performed. This does not establish an approval bypass or prove the absence of one.
- [Historical C-port checkpoint](../tools/bitcoin-prl-independent-review/README.md): the 29 hostile requests, three approved signing cases and Pearl oracle results apply only to recorded Nano S Plus ELF `8e45823f822fbc675dcd2e2c0868667905e4e26e64a711dc62fec0392febf737`. Its source list was observed after review and is not a proven build-to-source manifest. Other native candidates retain separate evidence; none inherits these results automatically. The current native/emulator lane is paused after a blocked test, and no final current-source/native matrix is claimed.

## Historical host and previous-Rust core checks

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

## Historical previous-Rust native and early browser evidence

The native results in this section and the next are for the earlier Rust application only. “Final” in a linked archival report means that report's historical checkpoint, not the current C-port release.

- [Final native qualification](../tools/native-release-qualification/README.md): all 25 combinations of five modeled devices and five networks passed builds, read-only network/address checks and offline package verification; all five simnet targets passed six runtime suites each. The [earlier native evidence index](../apps/ledger/tests/evidence/README.md) retains historical snapshots separately. This is not physical OS qualification.
- [Actual Pearl integration](e2e-evidence.md): all five modeled release targets completed 16-input simnet signing, acceptance, mining and reorg checks; a separate Nano S Plus run covered all four distinct-key tweak-parity combinations. The public script-engine fixture itself has synthetic outpoints and was not mined or broadcast.
- [Trusted-display review](../apps/ledger/tests/evidence/trusted-display/README.md), [mixed-session stability](../apps/ledger/tests/evidence/stability/README.md), and [offline package verification](../apps/ledger/tests/evidence/packaging/README.md) retain their exact scope and artifact hashes. App memory was measured in separately instrumented emulators; release timing is host-observed emulator time, not physical-device performance. See [firmware measurements](firmware.md#instrumented-memory-measurements).
- [Built companion desktop rendering](../apps/companion/test/evidence/rendering/README.md): empty-state presentation/navigation was checked in an actual cloud browser. [Companion qualification limits](companion.md#verification-and-remaining-qualification) identify what this bounded review did and did not exercise.

## Historical previous-Rust lexical-key-lifetime requalification

The previous Rust checkpoint's `crypto.rs` source hash is `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`. Its retained checks are:

- [Independent optimized-code cleanup review and replay](../tools/compiled-cleanup-review/README.md): all 25 exact model/network ELFs passed bounded original-slot control-flow/address and zero-store checks. Explicit stores cover the 32-byte scalar, 32-bit length and 8-bit curve field; three ABI padding bytes, register/spill copies, SDK scratch, OS exceptions and physical erasure are outside this claim.
- [Definitive normal-ticker timeout run](../tools/native-wallclock/final-requalification/README.md): all five modeled devices passed receiving, review and partial-export expiry at exactly 1,200 ordinary ticks, 60 stale-state rejections, fresh approval/signature recovery, and five 125-second idle controls. A separate validator replay passed. Earlier failed, interrupted and canceled attempts remain explicitly recorded and do not count as passes.
- [Final trusted-display requalification](../apps/ledger/tests/evidence/trusted-display/final-requalification/README.md): 125 accepted flows, 400 exact displayed fields and 20 warning details across five models. Six Stax capture-recovery repeats add no unique coverage.

- [Final transaction and repeated-session matrix](../tools/native-release-qualification/README.md): 30 suites, 77 hostile-event cases, 220 node-roundtrip checks and 100 mixed sessions passed. Ten retained transactions contain 100 native signatures, rechecked by the SDK and pinned Pearl script engine. Its 63-file native/runtime source snapshot predates subsequent host-only recovery changes; those changes receive separate host regression tests.
- [Canonical-path reproducibility](../tools/build-reproducibility/README.md): all 25 isolated rebuilds and complete packages match their reference bytes exactly. Four different-path builds differ in loadable code/data; three remapping pilots did not solve that. The tested builder uses fixed logical paths, pinned installed tools and private SDK/cache copies. This is not a claim of arbitrary-builder portability.
- [Fresh release crosscheck](../tools/final-release-review/README.md): independent artifact/source/count checks and six negative/portability controls passed, including a separate root replay.

- [Final-source instrumented memory](../tools/native-final-memory/README.md): 15 worst-case flows and 100 separate instrumented mixed sessions passed. Peak observed app stack was 12,824 B on Nano X (6,836 B remaining span); peak allocator occupancy was 1,836/8,192 B, with 160 B stable idle occupancy. These are separate instrumented emulator measurements, not release/physical/OS-stack bounds.

These results do not rebind later host changes to this source and do not apply to the C signer. Physical and exceptional OS behavior remain separate.

Reports apply to their recorded source/tool/artifact hashes, not automatically to later edits. [Checkpoint mappings](checkpoints.json) relate retained local source commits to published commits with the same Git tree.

## Historical large-wallet recovery checkpoint

- [Capacity and recovery review](../tools/wallet-recovery-review/REPORT.md): a genuine 2,000-record / 32,000-signature public fixture reproduced the backup-size and reconciliation-budget failures. Compact export preserves all recovery data within 16 MiB; final reconciliation preserves every signed byte and input reservation through 20 bounded batches and one atomic commit. The actual SDK/UI/bridge code runs against explicit local DOM/storage/RPC mocks, not a live browser or chain.
- The companion now validates full backups in a one-shot same-origin worker using the unchanged validator. Worker cancellation, late replies and queued/committed merge boundaries have regressions. Actual Node worker and Vite asset checks are separate from browser Worker/CSP/IndexedDB qualification. The maximum-history atomic merge still takes roughly 2.5–2.6 seconds synchronously on the measured host.
- That checkpoint's combined host checks passed 100 SDK, 71 wallet and 88 companion tests, workspace typechecks and production build. The newer aggregate is recorded above. [Dependency advisory snapshots](../tools/dependency-review/README.md) returned zero known npm advisories for the recorded lockfile; that is not a vulnerability-free guarantee.

## Not established

Physical installation/signing/screens/restore, physical app/OS memory and latency, the final C-port source-linked native/model/network matrix, full browser import/cross-tab/crash/interrupted-signing workflows, public TLS deployment, current live-indexer availability, final published-commit CI for the new changes, third-party human audit and Ledger functional/release approval remain gates. The bounded public-fixture UI checks above do not establish these broader flows. The original Nano S is unsupported; retail Nano X requires a vendor-controlled distribution route. No passing software result authorizes valuable-funds use, hardware changes, submission or publication.
