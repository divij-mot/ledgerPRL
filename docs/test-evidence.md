# Test evidence

Development checkpoint, 2026-10-09. Passing software tests are not physical Ledger proof, a human security audit, or mainnet readiness.

## Reproduced

- Rust no_std core: 29 unit/integration tests plus one compile-fail doctest, 1,024-case parser/amount properties and 512 generated hostile APDU sequences. Independent rust-bitcoin BIP341 digests across 96 transaction shapes, including every input; shared cross-language fixture independently checked for BIP32 public derivation, BIP86 scripts, addresses, signatures, serialization, transaction IDs and virtual size.
- Rust Clippy with all targets and warnings denied; formatting applied.
- TypeScript SDK: 100 tests, including exact amounts over 2^53, malformed and truncated bundles/transactions, field tampering, terminal error/cancellation and concurrency cases; SDK and CLI strict TypeScript checks.
- Pinned upstream Pearl commit 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701: upstream node/txscript and node/btcutil/hdkeychain test packages pass.
- Independent Go oracle tools/pearl-oracle: actual Pearl computes both fixture BIP341 digests identically, verifies both signatures, executes both Taproot spends successfully, and matches account public key, BIP86 scripts, receive address, txid and wtxid. Fixture amounts include 9007199254740993 grains. Different valid Schnorr nonce choices are allowed.

Commands (from root unless noted):

```
cargo test --locked --workspace
cargo clippy --locked --workspace --all-targets -- -D warnings
npm run test --workspace @pearl-ledger/sdk
npm run typecheck --workspace @pearl-ledger/sdk
npm run typecheck --workspace @pearl-ledger/cli
(cd tools/pearl-oracle && go run -mod=readonly . ../../fixtures/protocol-v1.json)
```

## Still in progress / not demonstrated

Complete five-model stable-OS emulator/UI/lifecycle matrix, physical-device signing, measured device memory/stack/latency, full GUI/backend adversarial paths, CI for the final exact commit, third-party human audit and Ledger functional/release review. Native builds and an actual Nano S Plus Speculos-to-Pearl simnet roundtrip have now passed; see docs/e2e-evidence.md for the recorded integration evidence. The public fixture's outpoints are synthetic and script-engine verification does not mean it was mined or broadcast.
