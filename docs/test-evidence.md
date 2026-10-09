# Test evidence

Development checkpoint, 2026-10-09. Passing software tests are not physical Ledger proof, a human security audit, or mainnet readiness.

## Recorded host checks

- Rust no_std core unit/integration, compile-fail, parser/amount property and hostile-APDU tests; independent rust-bitcoin BIP341 differential checks and cross-language derivation/serialization/signature fixtures. Host Clippy and formatting checks use the pinned CI toolchain.
- TypeScript SDK/wallet/companion tests cover exact amounts over 2^53, malformed bundles/transactions, field tampering, terminal error/cancellation, reservations, backup restoration, interrupted-signing recovery and concurrency. Host typechecks and production builds passed at recorded checkpoints. [Companion test boundaries](../apps/companion/test/README.md) distinguish real host modules from mocked browser/storage/transport/network behavior.
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

- [Native evidence index](../apps/ledger/tests/evidence/README.md): stable API27 builds and smoke/warning/lifecycle results for Nano S Plus, Nano X, Stax, Flex and Nano Gen5. Retained builds cover all five on mainnet/simnet and Nano S Plus on the other three networks. This is not every model/network permutation or physical OS qualification.
- [Actual Pearl integration](e2e-evidence.md): all five modeled release targets completed 16-input simnet signing, acceptance, mining and reorg checks; a separate Nano S Plus run covered all four distinct-key tweak-parity combinations. The public script-engine fixture itself has synthetic outpoints and was not mined or broadcast.
- [Trusted-display review](../apps/ledger/tests/evidence/trusted-display/README.md), [mixed-session stability](../apps/ledger/tests/evidence/stability/README.md), and [offline package verification](../apps/ledger/tests/evidence/packaging/README.md) retain their exact scope and artifact hashes. App memory was measured in separately instrumented emulators; release timing is host-observed emulator time, not physical-device performance. See [firmware measurements](firmware.md#instrumented-memory-measurements).
- [Built companion desktop rendering](../apps/companion/test/evidence/rendering/README.md): empty-state presentation/navigation was checked in an actual cloud browser. [Companion qualification limits](companion.md#verification-and-remaining-qualification) identify what this bounded review did and did not exercise.

Reports apply to their recorded source/tool/artifact hashes, not automatically to later edits. [Checkpoint mappings](checkpoints.json) relate retained local source commits to published commits with the same Git tree.

## Not established

Physical installation/signing/screens/restore, physical app/OS memory and latency, full loaded-account browser/import/IndexedDB interruption workflows, every intended model/network/retail-OS combination, final exact-commit CI, third-party human audit and Ledger functional/release approval remain gates. The original Nano S is unsupported; retail Nano X requires a vendor-controlled distribution route. No passing software result authorizes valuable-funds use, hardware changes, submission or publication.
