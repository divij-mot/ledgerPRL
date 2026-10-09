## Executed compatibility matrix, 2026-10-09

Official refs were rechecked at 17:37 UTC: v1.4.11 remains the latest release at `2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4`; master remains `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`; FP8 PR #311 remains open and unmerged at `684f7045f3b3b7c5b7598f46c06b7dceb506f74b`.

The public-fixture transaction matrix passed against immutable, blob-verified snapshots of all three refs, with each ref's actual dependencies:

- The unchanged Pearl production oracle passed its 2 BIP341 digest and BIP340 signature/script checks, BIP32/BIP86 account and address checks, and transaction identifiers.
- 81 generated transactions produced identical actual Pearl mempool outcomes per ref: 74 accepted, 4 expected fee rejections, 2 dust rejections, and 1 immature-coinbase rejection. The cases cover 1–16 inputs, one/two outputs, all five supported networks, 99/100-confirmation maturity, fee/dust boundaries, amounts above 2^53, and the maximum grain amount.
- Each ref passed 610 valid input-script checks, 81 byte-for-byte transaction roundtrips, 50 address derivations, 100 address decodings, and 3,455 expected tamper/range rejections. A second edge pass repeats the 610 valid input-script checks; these are not additional unique signatures.
- Complete upstream txscript, HD-key, chaincfg and mempool package tests passed, as did focused transaction-wire and amount/address tests.
- Genesis hashes, HRPs, coin types, 100-block maturity, 10^8 grains/PRL, the 2.1×10^18-grain limit and default 1,000-grain/kvB relay policy matched the wallet. The wallet fixture generator passed 2,469 assertions.

The tested wallet checkpoint was `87ca040566122a290c79a0a1fbd7590723b9da81`; exact source and dependency hashes accompany the replay package. The first release-source run accidentally retained current transitive dependency versions; it is excluded from these corrected results. The exact-release run passed after using the release's own dependency versions. No production pin, oracle or native binary was changed.

Scope matters: these are synthetic UTXO/public-key transaction checks, not live-chain acceptance, hardware testing, V4 proof validation or an FP8 activation guarantee. Broad certificate tests remained excluded after reporting the missing `zkpow` mining build; TLS-certificate tests failed denied network-interface enumeration and were not bypassed. They are documented limitations, not wallet-transaction failures or counted passes.

The inspected FP8 parameters still disable activation on mainnet, Testnet and Testnet2 (`Fp8ForkHeight=0`), and select V4 from height 1 on regtest/simnet. An eventual activated release and its node/SPV backend must be verified separately. Repeat the differential matrix against that exact release and test outdated-backend rejection/recovery before real funds.

Portable probes, immutable refs, saved dependency locks, per-ref summaries, hashes and replay instructions are provided in the accompanying compatibility replay package. Its frozen public cases reproduce this finding; they do not automatically validate later wallet changes.

The replay validates the complete upstream source entry set, rejects injected files/symlinks, and compiles fresh pinned Git archives with pre/post source-integrity checks. Fourteen adversarial controls include rejecting an extra Go source before compiler invocation; a replay with space-containing compiler/work paths was also tested.
