# Independent Ledger Bitcoin PRL checkpoint review

Checkpoint: 2026-10-09 21:25 UTC. This is a source review and narrow software/emulator checkpoint, not an independent human audit, Ledger approval, physical-device validation, or production authorization. **Do not use development accounts with valuable funds.**

## Decision

Proceed with development of the pinned Ledger Bitcoin fork and exact-integer PSBT adapter. Do not release for valuable funds until the remaining release gates below are met. Keep the seedless MetaMask Snap optional: a separate hardware bridge is still required, and RPC integration does not imply compatibility with existing Ethereum websites.

The native baseline was changed from unreleased development head to the official model-tagged Bitcoin 2.5.1 commit `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`. The PRL adaptation is independently changed software; upstream approval does not transfer to it.

## Findings and disposition

1. **Monetary accumulation:** merely changing Bitcoin's per-value limit is unsafe at Pearl's 2,100,000,000,000,000,000-grain maximum. Nine maximum inputs overflow uint64, and five exceed int64. Native input, owned-input, output and change sums now check aggregate limits before addition.
2. **High-fee overflow:** at total 2.1e18 and fee 1.9e18 grains, `10 * fee` wraps and previously missed the warning. Division/remainder comparison fixes this. Confirmed in the actual emulator review screens.
3. **Secret-derived signing buffer:** the SDK uses the signature buffer as a nonce workspace. The initial adaptation failed to wipe this buffer on errors. The tested build explicitly wipes it on normal error/success paths. Compiled disassembly shows 40-byte private-key and 65-byte signature-buffer wipes. This is not exception/fault-injection or side-channel proof.
4. **Public export privacy:** at this checkpoint native `display=0` still permitted silent exports for conventional account indices; the host always requested review. Requiring device approval for all public-account exports was recommended and remains a pending follow-up against a later build.
5. **P2MR boundary:** external witness-v2, 32-byte Merkle-root recipients are supported without P2MR custody. Inputs/change remain ordinary BIP86 P2TR. Old Rust `LedgerPearlClient` rejects P2MR before any APDU.

Source inspection also checked native policy/HMAC rejection, disabled message/registration/swap/MuSig dispatch, exact BIP86 account paths, on-device input/change derivation, chain-context checks, duplicate inputs, DEFAULT-only signing, positive values, one external recipient, at most one change, and network/account/change review fields. No additional defect was confirmed in that inspected scope.

## Executed evidence

Exact tested Nano S Plus ELF SHA-256:

`8e45823f822fbc675dcd2e2c0868667905e4e26e64a711dc62fec0392febf737`

Speculos 0.27.1, public BIP32 test-vector seed only; no physical device, real wallet seed, live-chain transaction, or money movement was used.

- 29 hostile raw-PSBT requests rejected by compiled firmware, deliberately bypassing host validation: missing/wrong/trailing network binding; unsupported global keys/counts/version/locktime/modification flags; individual and aggregate amount limits; zero values; negative fees; unsupported sighashes/sequences; duplicate outpoints; P2MR input/change; unknown witness version; fake change; foreign internal key; script-tree/MuSig fields; nonzero policy HMAC.
- Three approved emulator signing cases: overflow-sized high fee, maximum-minus-one recipient with one-grain fee, and arbitrary all-FF-root P2MR recipient with P2TR change.
- Actual locked Pearl implementation `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701` accepted all four input scripts, transaction sanity and synthetic-UTXO input checks. Twelve amount/recipient/sequence mutations failed. `go mod verify` passed. These checks do not establish mempool fee policy, live-chain acceptance, or the ability to spend a P2MR output.
- Seven exact amount-format strings (including 2^53 ± 1, maximum and maximum-minus-one), bounds canaries, 1,000,000 randomized money/high-fee helper comparisons against a 128-bit oracle, and 400,000 fee-threshold checks passed under ASan/UBSan. Leak scanning was disabled because LeakSanitizer is unsupported under the execution environment's tracing.
- Ten P2MR address/script cases (all five networks, zero and all-FF roots) matched the actual locked Pearl address implementation. P2MR change and unsupported witness versions rejected; old adapter made zero APDU calls for P2MR.

The Nano amount screen wraps the final fractional digit to its second line. Screenshots were inspected and all digits are present. An initial test assertion expected an unwrapped string; the assertion was corrected to reconstruct the display's line wrapping and the whole 32-case native suite reran successfully. This was a test-harness correction, not a firmware change.

`evidence/result.json` and `evidence/pearl-oracle.json` contain the actual passing cases. `review.mts` and `oracle.go` preserve the exact executed harnesses. They currently contain audit-workspace paths; they are archival replay sources, not a claimed portable runner. Full screenshots, ELF snapshot and logs remain with the native worker in the evidence directory named by `firmware.json`. No binary is included here.

The source-hash listing records files observed at review completion; it is **not** a cryptographically proven build-to-source manifest. Later source or toolchain changes require a new build-linked review and replay.

## Remaining release gates

- Source-bound, reproducible build/package provenance for the final selected SDK, app and supported retail OS/model combinations; no autoapproval, debug or excessive derivation permissions in distributable artifacts
- Final-source native adversarial replay, malformed Merkle proof/omission/reordering checks, cancellation/disconnect/reset behavior, maximum resource measurements and fault-injection cleanup tests
- Physical device review, full address/amount/path readability, signing/denial, interrupted-session behavior and recovery/restore interoperability
- Final host/browser tests covering immutable requests, signature verification, replay/concurrency, ambiguous signing/broadcast persistence, stale/reorganized chain data and backup recovery
- Actual loaded MetaMask validation if the optional Snap is distributed; no entropy/private-key permissions, no hot fallback, exact origin/account scope, restart/expiry behavior and honest site-compatibility claims
- Independent human security/dependency review and any required Ledger distribution review; project licensing and production distribution decisions
- Document the scanner's bounded discovery limits. A capped address/history/UTXO scan is not complete recovery or complete miner history

Genesis/network PSBT metadata prevents workflow mix-ups but does not change consensus BIP341 signatures. It cannot by itself provide cryptographic cross-chain replay protection. Some test networks share paths/HRPs, and regtest/simnet also share genesis in the pinned parameters. The host still trusts its node/indexer chain view; Bitcoin headers-only SPV assumptions are insufficient for Pearl's certificate/proof rules.

## Primary references

- [Pinned Ledger Bitcoin baseline](https://github.com/LedgerHQ/app-bitcoin/tree/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a)
- [Ledger Bitcoin protocol](https://github.com/LedgerHQ/app-bitcoin/blob/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a/doc/bitcoin.md)
- [Pinned Pearl implementation](https://github.com/pearl-research-labs/pearl/tree/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701)
- [MetaMask Snap permissions](https://docs.metamask.io/snaps/reference/permissions/)
