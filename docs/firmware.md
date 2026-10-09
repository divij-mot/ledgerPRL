# Native Ledger firmware

Development firmware. Do not use with valuable funds. This is a native Rust Ledger application, not a host signer or an ECDSA substitute. There is no seed entry, secret-key export, raw-digest signing command, software signing fallback, or broadcast implementation in the firmware.

## Verified status (9 October 2026)

The native application has compiled and linked for **Nano S Plus, Nano X, Stax, Flex and Nano Gen5 (`apex_p`)**, using the real Ledger Rust SDK, generated C bindings, Ledger linker layouts, and NBGL UI. Mainnet builds pass for all five targets; the five-device simnet matrix is exercised by `scripts/ledger-build-matrix.sh`.

The active secure SDK is stable **v27.1.2 / API 27**, pinned to `6709cd2bdfebb224ee070f7c1211b54254262579`. The originally investigated `b03e7d...` development SDK declared API 0; it was replaced after source and runtime compatibility checks. No API-level override is needed for the active build. Latest device-specific SDK tags observed are Nano S Plus 1.7.0, Nano X 2.8.0, Stax 1.11.0, Flex 1.7.0 and Nano Gen5/Apex P 1.2.0, sharing API 27. Public firmware-rollout status is a separate check from SDK tag presence.

**Actual Nano S Plus emulator/node proof:** Speculos 0.27.1 executed account export, full-address review and real two-input BIP340 signing using only the public BIP32 vector-one seed. Returned account metadata matched the independent fixture. The companion verified the signatures; the pinned Pearl simnet node rejected a bit-flipped signature, accepted the genuine transaction, mined it, and the watch-only wallet discovered the result and handled reorg behavior. See `tests/e2e/native-node-roundtrip.ts` and its generated evidence. This is native application execution, not a mock device.

Physical-device installation, actual OS compatibility, measured stack high-water, physical disconnect behavior, side-channel review and independent security audit are not established by emulator or build success. No physical device has been installed, upgraded, reset, or used to sign.

## Pinned sources and reproducible inputs

- Rust SDK: `LedgerHQ/ledger-device-rust-sdk@4123d2dc85a2085115e6a36826460a9fe742cfb1`
- Secure SDK: `LedgerHQ/ledger-secure-sdk@6709cd2bdfebb224ee070f7c1211b54254262579` (v27.1.2, API 27)
- Rust: `nightly-2025-12-05`, including `rust-src`
- Cargo dependency lockfile: `apps/ledger/Cargo.lock`; builds use `--locked`
- Narrow SDK modification: `apps/ledger/patches/strict-transport.patch`

The preparation script checks exact source commits and the **entire diff against HEAD**, including staged edits, against the checked-in patch. It refuses unexpected untracked Rust-SDK files and any secure-SDK modifications. A local regression checks fresh `--no-checkout` clones, repeated preparation, and rejection of staged/unreviewed edits.

The application is an isolated Cargo workspace so host tests do not require an embedded toolchain. Vendor checkouts and binaries are ignored; official sources are downloaded by the preparation script.

## Build

Prerequisites: Git, the pinned Rust toolchain, Clang/libclang, ARM GNU embedded GCC/newlib, LLVM `llvm-nm`/`llvm-objcopy`, Python and the SDK's image dependencies. Ledger's official app-builder environment supplies these. Pin your builder image by digest in a release pipeline; this repository does not claim bit-for-bit reproducibility across arbitrary host toolchains.

```sh
rustup toolchain install nightly-2025-12-05 --component rust-src,rustfmt,clippy
./scripts/ledger-prepare-sdk.sh
./scripts/ledger-build.sh nanosplus regtest
./scripts/ledger-build.sh nanox regtest
./scripts/ledger-build.sh stax regtest
./scripts/ledger-build.sh flex regtest
./scripts/ledger-build.sh apex_p regtest
./scripts/ledger-build-matrix.sh
./scripts/ledger-test-prepare.sh
```

Arguments are device followed by network (`mainnet`, `testnet`, `testnet2`, `regtest`, `simnet`). The default is Nano S Plus/regtest. Exactly one network is compiled into the binary; conflicting Cargo features are compile errors. Build commands only produce an ELF at `apps/ledger/target/<device>/release/pearl-ledger`. They never load a device.

App install metadata restricts secp256k1 derivation to `86'/808276'` on mainnet or `86'/1'` on other networks. Each network has a distinct app name; the full network name is shown during account/address/transaction review. No root derivation, recovery-app privilege, Bitcoin derivation allowance, or XMSS path is requested. The master fingerprint comes from the OS master-identifier syscall.

## Trusted review and protocol

`pearl-core` is the allocation-free parser, policy, BIP341 sighash and chunked APDU state machine. The adapter copies a short APDU before lending its SDK communication object to NBGL. Ownership-validated transaction state is immutable, and a `ReviewedTransaction` token exists only after the trusted UI accepts.

NBGL's full review flow is used on all five devices, including Nano NBGL button controls. It shows network, account path, **full recipient address**, exact eight-decimal PRL amount, exact fee, change amount, full change address and change path. Address verification shows the full address, network, path and BIP86 policy. Account export requires review and explains its watch-only privacy impact. No blind/light-review bypass exists. Account numbers above 100 and address indexes above 50,000 receive a separate physical "Unusual path" warning; they remain available for deliberate recovery. Fees at least 10% of inputs, when input total is over 100,000 grains, receive a separate high-fee approval. The comparison uses a division/ceiling threshold, never overflowing multiplication; five boundary/overflow tests exercise it.

See `protocol-v1.md` for every field, command and status. All inputs and change must independently match device-derived BIP86 keys. An external recipient x-only key is validated using SDK decompression, on-curve/infinity checks, field range and canonical round-trip checks. The device cannot establish chain truth or infer a recipient's hidden Taproot script policy from its address.

## Small cryptographic boundary

The small additional C bridge lives in the tracked SDK patch; it adds no cryptography or path permissions. All application `unsafe` calls are confined to `src/crypto.rs` (besides the Rust 2024 entry-point attribute). Every fallible syscall/cryptographic return code is checked. The SDK's RNG has a void API; hardware failure aborts within the OS rather than providing a recoverable return code.

1. Derive the checked BIP32 path with Ledger's `os_derive_bip32_no_throw` and no user-supplied seed. A tiny compiled C shim exposes this standard inline wrapper and catches C exceptions before returning to Rust. Ordinary BIP32 through the newer `sys_hdkey_derive` returns unsupported (`0x4213`) in Speculos 0.27.1; there is one checked standard derivation implementation, not a runtime fallback.
2. Obtain the public key via SDK randomized fixed-base secp256k1 multiplication.
3. Normalize the internal scalar to even Y with SDK subtraction.
4. Compute `tagged_hash("TapTweak", x(P))` with no script-tree bytes. Reject `t >= n`.
5. Add the tweak modulo the group order with the SDK. Reject zero.
6. Compute the digest from the immutable reviewed transaction in the core.
7. Feed fresh secure-element auxiliary randomness into `cx_ecschnorr_sign_no_throw`, using `CX_ECSCHNORR_BIP0340 | CX_RND_PROVIDED | CX_LAST` and SHA256. The SDK handles final output-key parity and tagged BIP340 nonce derivation.
8. Require exactly 64 bytes and verify the signature with the SDK before releasing it. The companion verifies it independently too.

There is no custom point/scalar arithmetic and no high-level ECDSA sign call. Private scalars remain in caller-owned guarded buffers, with no private-key return values between helper functions. Temporary raw derivation, normalized scalar and nonce/signature buffers use `Zeroizing`; the SDK key's scalar and metadata zeroize on every normal/error return. Keys are already dropped before any transport polling/UI begins. Fatal OS exceptions/panics do not run Rust destructors; platform teardown/RAM-clearing behavior must be verified on physical devices before a release claim.

## Why the SDK transport patch is necessary

The unmodified pinned SDK accepts four-byte/extended APDUs, filters malformed requests before the application sees them, and rejects concurrent requests without ending the ongoing review. Those behaviors do not satisfy this application's strict session contract.

The tracked patch also binds the standard checked BIP32 wrapper. Its transport changes:

- Accepts only five-byte short headers plus exactly `Lc` bytes
- Distinguishes benign partial button releases, display completion/redisplay and ordinary status events from faults
- Latches transport errors, malformed/nested/BOLOS commands during an active session, locked-device events and relevant reported USB power loss
- Enforces 1,200 SDK ticker events without fresh command progress, including during review (nominally two minutes with the normal 100 ms ticker; measure on each supported OS)
- Synchronously rejects a blocking NBGL review on a fault; a sticky fault is checked again before UI consent can succeed
- Returns control to the application to zeroize the core session before exiting

A fault cannot be cleared by an approval callback, a new command or `set_strict_session`. Reopen the app to start fresh. The patch intentionally fails closed for unclassified transport events, so compatibility testing must cover actual OS event streams. Physical cable/radio disconnect delivery and timeout timing remain device/OS-specific validation gates. OS app exit also destroys the application context; no transaction/key state is persisted in NVM.

## Required release validation

- Verify API27 firmware rollout/device compatibility, pin a builder image digest, then reproduce every target/network build
- Execute end-to-end account export, address review and multi-input BIP340 signing in Speculos and on physical devices using public test keys only
- Exercise normal partial button releases and touch/hold confirmations, rejection, duplicate/nested/malformed APDUs, short/extended lengths, disconnect, lock, timeout, restart and faults at the final approval boundary
- Independently compare both secret-key parity branches, tweaks, addresses, all BIP341 digests and signatures with Pearl and published BIP340/BIP86 vectors
- Measure peak stack/heap and signing latency at the 16-input/1,507-byte development limit
- Obtain independent security review and Ledger approval before distribution or valuable-funds use
