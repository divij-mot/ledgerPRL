# Ledger host reuse and local patch

The six modules in `src/upstream/` derive from LedgerHQ/app-bitcoin release **2.5.1**, commit `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`. Their original source is retained in `provenance/upstream-original/`. `upstream.json` records original and adapted SHA-256 values; `upstream.patch` is the complete unified diff. Apache-2.0 text is preserved in `LICENSE.app-bitcoin`.

Run `python3 packages/bitcoin-prl-adapter/provenance/verify_upstream.py` from the repository root. It checks every original/adapted byte and reconstructs the exact patch. Source changes must update this review record intentionally.

## Necessary local changes

- Explicit `buffer` imports let the same byte protocol run in a browser without a Node global. SHA-256 uses the repository's existing pinned noble implementation instead of pulling a Bitcoin transaction stack into the browser.
- ESM import extensions and checked-array annotations support the repository's stricter TypeScript settings. The Merkle algorithm, Merkle map commitments, wallet-policy serialization and interpreter command formats retain upstream structure.
- The two number-based uint64 helpers are replaced with bigint-only helpers. There is no `Number(amount)` path. Varints reject unsafe/fractional Number inputs and noncanonical encodings; conversion to Number is used only for bounded counts/indices.
- Negative indices, malformed proof requests and interleaved continuation queues fail closed. Merkle leaves are bounded and copied. Known preimages are copied to prevent caller mutation.

`src/client.ts` preserves the documented upstream `AppClient.makeRequest` interruption framing and `AppClient.signPsbt` Merkle commitments. It intentionally exposes only PRL network-bound account/address/ordinary-payment operations. It adds exact account/address checks, terminal cancellation behavior, independent signature verification, a durable completed-signature callback and signed-result recovery. General policy registration, arbitrary message signing, MuSig and script-path operations are absent.

`src/psbt.ts` is the narrow local policy boundary. The upstream JavaScript `PsbtV2` amount accessors take `number`, including `setInputWitnessUtxo` and `setOutputAmount`, and therefore cannot cover Pearl's 2.1e18-grain range. Raw PSBT maps are built/parsed with exact bigint u64 values; they are served by the retained upstream Merkle interpreter. This is not a general PSBT implementation.

## Alternatives inspected

- The pinned `bitcoin_client_js` package is version 0.3.1. Its amount API remains number-based even though its current Bitcoin library dependency is newer.
- The official Bitcoin Signer Kit 1.3.3 package advertises a `bitcoinjs-lib ^6.1.6` peer and Bitcoin-specific signer orchestration. It was not treated as an exact-grain or PRL-network adapter. Existing modern DMK transport is retained by the companion; deprecated LedgerJS transport packages were not added.
- The pinned Rust host client 0.6.2 uses `bitcoin::psbt::Psbt` and exact Bitcoin amount types. Its protocol and independent-address-check pattern were inspected. It is not a direct browser dependency; the Python host is used as an independent executable protocol oracle instead.

Reference sources:
- https://github.com/LedgerHQ/app-bitcoin/tree/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a/bitcoin_client_js
- https://github.com/LedgerHQ/app-bitcoin/tree/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a/bitcoin_client_rs
- https://github.com/LedgerHQ/app-bitcoin/blob/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a/doc/bitcoin.md
- https://raw.githubusercontent.com/LedgerHQ/device-sdk-ts/develop/packages/signer/signer-btc/package.json (inspected 2026-10-09; moving branch, not a runtime pin)

## Independent executable oracle

`test/upstream_oracle.py` loads only serialization/Merkle/policy modules from the retained official Python client. Eleven module hashes are pinned in `python-oracle-sources.json`. Package startup and hardware transports are not imported. The typing-only `Protocol` symbol can come from Python's standard library when `typing_extensions` is absent.

The test compares exact maximum-grain PSBT amounts and round-trip metadata, wallet-policy bytes/id, every map commitment, hundreds of full interpreter command/response pairs, preimage/proof continuation chunks, and Merkle roots/proofs through 4,096 leaves. The frozen `test/fixtures/ledger-psbt-v2.json` covers the existing two-input `fixtures/protocol-v1.json` payment with **435** oracle command/response pairs and contains the complete expected SIGN_PSBT APDU. This is software protocol evidence, not physical-device or vendor qualification.
