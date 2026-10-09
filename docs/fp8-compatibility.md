# FP8 and transaction compatibility

Reference pins from source review on 2026-10-09:

- Pearl released v1.4.11: 2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4
- Pearl implementation oracle: 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701
- FP8 proposal branch: 684f7045f3b3b7c5b7598f46c06b7dceb506f74b, PR311

Ordinary P2TR signing uses Bitcoin-style transaction serialization, BIP32/BIP86, Bech32m, SHA256-tagged BIP341 and BIP340. The inspected FP8 proposal preserves the transaction/signature sources; it changes mining/proof certificates and node/SPV validation. This is a version-specific finding, not a claim about an eventual activation release.

The Ledger does not mine blocks or validate Pearl ZK proof certificates. A companion using a node/indexer trusts that backend's chain view. A future independently validating SPV companion must implement the actual Pearl certificate/proof rules, including FP8 V4 when active. Bitcoin headers-only assumptions are insufficient.

Before deployment, repeat differential signer tests against the final supported release, verify actual chain activation parameters and backend versions, and test rejection/recovery with an outdated backend. The official testnet Blockbook hostname currently serves Testnet2, which must be checked by chain identity and genesis rather than inferred from the hostname.

No XMSS signing is added by FP8 support. XMSS one-time state, rollback/restore safety and PQ-only policy need a separate design and audit. Ordinary Taproot key-path custody remains classical.

Sources: https://github.com/pearl-research-labs/pearl/tree/2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4 and https://github.com/pearl-research-labs/pearl/pull/311 .
