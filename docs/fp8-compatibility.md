# FP8 and transaction compatibility

Reference pins from source review on 2026-10-09:

- Pearl released v1.4.11: 2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4
- Pearl implementation oracle: 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701
- FP8 proposal branch: 684f7045f3b3b7c5b7598f46c06b7dceb506f74b, PR311

Ordinary P2TR signing uses Bitcoin-style transaction serialization, BIP32/BIP86, Bech32m, SHA256-tagged BIP341 and BIP340. The inspected FP8 proposal preserves the transaction/signature sources; it changes mining/proof certificates and node/SPV validation. This is a version-specific finding, not a claim about an eventual activation release.

## Executed three-ref matrix

All three immutable refs passed the actual Pearl transaction oracle and the same 81 public-fixture mempool cases with their own dependency versions: 74 accepted and seven correctly rejected for fee, dust or immature coinbase. Per ref, the matrix also passed 610 valid input-script checks, 3,455 expected tamper/range rejections, 81 serialization roundtrips, 50 address derivations and 100 address decodings. It covers all five networks, 1–16 inputs, maturity and relay-policy boundaries, values above 2^53 and the maximum grain amount. Focused upstream transaction, script, HD-key, network and mempool tests passed.

The [portable replay package](../tools/fp8-compatibility/README.md) retains exact source/dependency hashes, public cases, corrected results and limitations. Its complete source-set verifier rejects extra Go files and substituted symlinks; builds use fresh pinned archives checked before and after execution. Fourteen adversarial provenance controls passed. An initial release run with newer transitive libraries is excluded from the corrected results. Certificate/mining and denied TLS-interface tests are explicitly outside the passing matrix.

These are synthetic UTXO checks, not live-chain acceptance, hardware qualification or V4 proof validation. The inspected FP8 proposal remains unmerged with mainnet activation disabled. Later wallet changes and an activated release require a new comparison.

## Deployment boundary

The Ledger does not mine blocks or validate Pearl ZK proof certificates. A companion using a node/indexer trusts that backend's chain view. A future independently validating SPV companion must implement the actual Pearl certificate/proof rules, including FP8 V4 when active. Bitcoin headers-only assumptions are insufficient.

Before deployment, repeat differential signer tests against the final supported release, verify actual chain activation parameters and backend versions, and test rejection/recovery with an outdated backend. The official testnet Blockbook hostname currently serves Testnet2, which must be checked by chain identity and genesis rather than inferred from the hostname.

No XMSS signing is added by FP8 support. XMSS one-time state, rollback/restore safety and PQ-only policy need a separate design and audit. Ordinary Taproot key-path custody remains classical.

Sources: https://github.com/pearl-research-labs/pearl/tree/2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4 and https://github.com/pearl-research-labs/pearl/pull/311 .
