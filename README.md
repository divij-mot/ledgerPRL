# ledgerPRL

A work-in-progress native Ledger signer and minimal companion for Pearl (PRL).

## Status

Implementation in progress. This repository is not yet audited, approved by Ledger, or validated on physical hardware. Do not use development builds with valuable funds.

## Initial scope

- Keys derived on the Ledger from its existing seed; the companion never requests recovery words.
- Classical, empty-tree BIP86 Taproot key-path PRL signing, with full recipient, amount, fee and change validation on the device.
- A narrow versioned transaction-signing protocol and a minimal watch-only companion.
- Tests against pinned Pearl protocol definitions, including the current FP8 proposal where relevant.

This initial signer is not post-quantum custody. XMSS signing, arbitrary scripts, swaps and Ledger Wallet Accounts integration are outside the initial implementation.

## Security requirements

No opaque-digest signing or software-key fallback. Use exact integer amounts, restricted derivation paths, bounded parsing and explicit on-device approval. Existing Ledger seeds must never be reset or imported into the companion.

Implementation, test evidence, limitations and installation instructions will be committed as work progresses.
