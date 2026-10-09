# Native Ledger firmware

Development firmware. Do not use with valuable funds. This is a native Rust Ledger application, not a host signer or an ECDSA substitute. There is no seed entry, secret-key export, raw-digest signing command, software signing fallback, or broadcast implementation in the firmware.

## Verified status (9 October 2026)

The native application has compiled and linked for **Nano S Plus, Nano X, Stax, Flex and Nano Gen5 (`apex_p`)**, using the real Ledger Rust SDK, generated C bindings, Ledger linker layouts, and NBGL UI. Mainnet and simnet builds pass for all five targets. Nano S Plus also builds testnet, testnet2 and regtest. Thirteen retained build manifests bind exact network/device, source and lockfile hashes, SDK commits, compiler versions and ELF bytes.

The active secure SDK is stable **v27.1.2 / API 27**, pinned to `6709cd2bdfebb224ee070f7c1211b54254262579`. The originally investigated `b03e7d...` development SDK declared API 0; it was replaced after source and runtime compatibility checks. No API-level override is needed for the active build. Latest device-specific SDK tags observed are Nano S Plus 1.7.0, Nano X 2.8.0, Stax 1.11.0, Flex 1.7.0 and Nano Gen5/Apex P 1.2.0, sharing API 27. Public firmware-rollout status is a separate check from SDK tag presence.

**Actual five-model emulator/node proof:** all five final release ELFs passed all 22 integration cases at the 16-input/1,507-byte limit in Speculos 0.27.1, using only the public BIP32 vector-one seed. Account metadata matched the independent fixture and full-address review passed. The companion independently verified native BIP340 signatures; isolated pinned Pearl simnet nodes rejected a bit-flipped signature, accepted and mined the genuine transaction, and the watch-only wallet discovered the result and handled invalidation/reconsideration. Partial signature export followed by abort and a fresh successful session passed too. Current exact-ELF summaries and two compact screenshots per model are retained as `apps/ledger/tests/evidence/<model>/node-roundtrip.json` and `node-*.png`. Replay uses `tests/e2e/native-node-roundtrip.ts`, with installed tool paths explicitly supplied as documented in `tests/e2e/README.md`. No private-key host signer is used.

Physical-device installation, actual OS compatibility, physical disconnect behavior, hardware timing/side-channel resistance and a formal external security audit are not established by emulator or build success. Instrumented app-stack/allocator measurements and independent source/optimized-disassembly checks are recorded below; these do not replace physical validation. No physical device has been installed, upgraded, reset, or used to sign.

## Pinned sources and reproducible inputs

- Rust SDK: `LedgerHQ/ledger-device-rust-sdk@4123d2dc85a2085115e6a36826460a9fe742cfb1`
- Secure SDK: `LedgerHQ/ledger-secure-sdk@6709cd2bdfebb224ee070f7c1211b54254262579` (v27.1.2, API 27)
- Rust: `nightly-2025-12-05`, including `rust-src`
- Cargo dependency lockfile: `apps/ledger/Cargo.lock`; builds use `--locked`
- Narrow SDK modification: `apps/ledger/patches/strict-transport.patch`

Per-device file locks span compilation and manifest creation; staging takes the same lock, and SDK preparation has its own shared lock. Artifact publication uses atomic rename, and every emulator run snapshots its ELF before execution. A build manifest is emitted only if source inputs remain unchanged throughout compilation. Staging refuses a different target/network label or ELF bytes that no longer match their manifest. These safeguards also prevent a parallel build from overwriting code already mapped by an emulator.

The preparation script checks exact source commits and the **entire diff against HEAD**, including staged edits, against the checked-in patch. It refuses unexpected untracked Rust-SDK files and any secure-SDK modifications. A local regression checks fresh `--no-checkout` clones, repeated preparation, and rejection of staged/unreviewed edits.

The application is an isolated Cargo workspace so host tests do not require an embedded toolchain. Vendor checkouts and binaries are ignored; official sources are downloaded by the preparation script.

## Build

Prerequisites: Git, `flock` (util-linux), GNU `patch`, the pinned Rust toolchain, Clang/libclang, ARM GNU embedded GCC/newlib, LLVM `llvm-nm`/`llvm-objcopy`, Python and the SDK's image dependencies. Ledger's official app-builder environment supplies these. Pin your builder image by digest in a release pipeline; this repository does not claim bit-for-bit reproducibility across arbitrary host toolchains.

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
./scripts/ledger-test-artifact.sh nanosplus regtest
python3 apps/ledger/tests/artifact-race.py
```

Arguments are device followed by network (`mainnet`, `testnet`, `testnet2`, `regtest`, `simnet`). The default is Nano S Plus/regtest. Exactly one network is compiled into the binary; conflicting Cargo features are compile errors. Build commands only produce an ELF at `apps/ledger/target/<device>/release/pearl-ledger`. They never load a device.

App install metadata restricts secp256k1 derivation to `86'/808276'` on mainnet or `86'/1'` on other networks. Each network has a distinct app name; the full network name is shown during account/address/transaction review. No root derivation, recovery-app privilege, Bitcoin derivation allowance, or XMSS path is requested. The master fingerprint comes from the OS master-identifier syscall.

## Trusted review and protocol

`pearl-core` is the allocation-free parser, policy, BIP341 sighash and chunked APDU state machine. The adapter copies a short APDU before lending its SDK communication object to NBGL. Ownership-validated transaction state is immutable, and a `ReviewedTransaction` token exists only after the trusted UI accepts.

NBGL's full review flow is used on all five devices, including Nano NBGL button controls. It shows network, account path, **full recipient address**, exact eight-decimal PRL amount, exact fee, change amount, full change address and change path. Address verification shows the full address, network, path and BIP86 policy. Account export requires review and explains its watch-only privacy impact. No blind/light-review bypass exists. Account numbers above 100 and address indexes above 50,000 receive a separate physical "Unusual path" warning; they remain available for deliberate recovery. Fees at least 10% of inputs, when input total is over 100,000 grains, receive a separate high-fee approval. The comparison uses a division/ceiling threshold, never overflowing multiplication; five boundary/overflow tests exercise it.

See `protocol-v1.md` for every field, command and status. All inputs and change must independently match device-derived BIP86 keys. An external recipient x-only key is validated using SDK decompression, on-curve/infinity checks, field range and canonical round-trip checks. The device cannot establish chain truth or infer a recipient's hidden Taproot script policy from its address.

## Small cryptographic boundary

The small additional C bridges live in the tracked SDK patch; they add no cryptographic implementation or path permissions. All application `unsafe` calls are confined to `src/crypto.rs` (besides the Rust 2024 entry-point attribute). Every fallible syscall/cryptographic return code is checked. The SDK's RNG has a void API; hardware failure aborts within the OS rather than providing a recoverable return code.

1. Derive the checked BIP32 path with Ledger's `os_derive_bip32_no_throw` and no user-supplied seed. A tiny compiled C shim exposes this standard inline wrapper and catches C exceptions before returning to Rust. Ordinary BIP32 through the newer `sys_hdkey_derive` returns unsupported (`0x4213`) in Speculos 0.27.1; there is one checked standard derivation implementation, not a runtime fallback.
2. Obtain the public key via SDK randomized fixed-base secp256k1 multiplication.
3. Normalize the internal scalar to even Y with SDK subtraction.
4. Compute `tagged_hash("TapTweak", x(P))` with no script-tree bytes. Reject `t >= n`.
5. Add the tweak modulo the group order with the SDK. Reject zero using the SDK’s fixed-length, non-throwing `cx_math_is_zero` through a three-line C bridge. Independent optimized-disassembly review confirmed exactly 32 byte-load/OR iterations controlled only by a public loop counter on all ten mainnet/simnet binaries. No short-circuit secret-byte predicate remains.
6. Compute the digest from the immutable reviewed transaction in the core.
7. Feed fresh secure-element auxiliary randomness into `cx_ecschnorr_sign_no_throw`, using `CX_ECSCHNORR_BIP0340 | CX_RND_PROVIDED | CX_LAST` and SHA256. The SDK handles final output-key parity and tagged BIP340 nonce derivation.
8. Require exactly 64 bytes and verify the signature with the SDK before releasing it. The companion verifies it independently too.

There is no custom point/scalar arithmetic and no high-level ECDSA sign call. Private scalars remain in caller-owned guarded buffers, with no private-key return values between helper functions. Temporary raw derivation, normalized scalar and nonce/signature buffers use `Zeroizing`; the SDK key's scalar and metadata zeroize on every normal/error return. Keys are already dropped before any transport polling/UI begins. Fatal OS exceptions/panics do not run Rust destructors; platform teardown/RAM-clearing behavior must be verified on physical devices before a release claim.

## Why the SDK transport patch is necessary

The unmodified pinned SDK accepts four-byte/extended APDUs, filters malformed requests before the application sees them, and rejects concurrent requests without ending the ongoing review. Those behaviors do not satisfy this application's strict session contract.

The tracked patch also binds the standard checked BIP32 wrapper. Its transport changes:

- Accepts only five-byte short headers plus exactly `Lc` bytes
- Validates the exact SEPH envelope length and button/touch/ticker/display/status/ITC payload bounds before indexing or calling C UI handlers
- Allows only correctly formed idle BOLOS version/quit commands; rejects unused certificate-loading, measurement and unknown BOLOS commands. Stack measurement is enabled only in separately built test instrumentation
- Distinguishes benign partial button releases, display completion/redisplay and ordinary status events from faults
- Latches transport errors, malformed/nested/BOLOS commands during an active session, locked-device events and relevant reported USB power loss
- Enforces 1,200 SDK ticker events without fresh command progress, including during review (nominally two minutes with the normal 100 ms ticker; measure on each supported OS)
- Synchronously rejects a blocking NBGL review on a fault; a sticky fault is checked again before UI consent can succeed
- Returns control to the application to zeroize the core session before exiting

A fault cannot be cleared by an approval callback, a new command or `set_strict_session`. Reopen the app to start fresh. The patch intentionally fails closed for unclassified transport events, so compatibility testing must cover actual OS event streams. Physical cable/radio disconnect delivery and timeout timing remain device/OS-specific validation gates. OS app exit also destroys the application context; no transaction/key state is persisted in NVM.

## Re-run native tests

Install official Speculos **0.27.1**, its QEMU dependency and the repository’s Node dependencies. Set `SPECULOS_BIN` and `SPECULOS_PYTHON` to that same virtual environment if it is not on `PATH`. These tests use only the public BIP32 vector-one seed and create their own emulator process; there is no physical device access or host private-key signing fallback.

```sh
SPECULOS_MODEL=nanosp node --import tsx apps/ledger/tests/native-smoke.ts
SPECULOS_MODEL=nanosp node --import tsx apps/ledger/tests/native-warnings.ts
SPECULOS_MODEL=nanosp SPECULOS_INJECTOR=apps/ledger/tests/speculos-injector.py \
  node --import tsx apps/ledger/tests/native-faults.ts
SPECULOS_MODEL=nanosp node --import tsx apps/ledger/tests/native-latency.ts
node_modules/.bin/tsc -p apps/ledger/tests/tsconfig.json --noEmit
node --import tsx --test apps/ledger/tests/speculos-driver.test.ts
./scripts/ledger-lint.sh nanosplus
```

Repeat with `nanox`, `stax`, `flex` and `apex_p` (the build/lint target for emulator `nanosp` is `nanosplus`). Native Clippy treats warnings as errors except two explicitly documented syntax-style suggestions: the reviewed nested warning branch and explicit division/remainder fee threshold. Defaults create a fresh temporary output directory and print its path. Set `PEARL_EVIDENCE` to a fresh directory on a sufficiently large filesystem for retained/concurrent runs. An existing ELF snapshot is never overwritten, and an evidence-write failure still terminates the emulator child. Each run stores an immutable ELF snapshot, exact SHA256, Speculos version, public-seed identifier, UI text and screenshots. The fault suite additionally records the injector source SHA256. Its small Python wrapper permits numeric SEPH tags absent from upstream’s Python enum; it changes only test input generation, never firmware, crypto, syscalls or approval logic. A Python emulator exception cannot count as a passing fault test: the suite requires the native app’s explicit fail-closed exit.

Retained current-binary summaries and compact node screenshots are in `apps/ledger/tests/evidence/`; the reusable node-roundtrip harness and earlier checkpoint evidence are in `tests/e2e/`. Native smoke tests reject zero/all-FF recipient x-only keys in the SDK, then perform a valid address/sign operation to exercise BN-resource cleanup. Warning tests require extra physical-button/touch approval for account 101, index 50,001 and a 20% fee. Fault tests exercise final-approval races, malformed/nested/BOLOS commands, malformed SEPH, reported USB power loss, actual 1,200-tick timeout and benign partial button release.

## Instrumented memory measurements

Memory instrumentation is applied only to a separate mirrored source/build tree. It is never applied to the verified release SDK checkout or published as a release ELF. The script uses the SDK’s official app-stack paint/high-water mechanism. A reviewed allocator wrapper delegates to the same `embedded-alloc` heap and samples `used()` after **every allocation**, including transient reallocation peaks. BOLOS B0/57 initialization/query is available only in these separately named `INSTRUMENTED` binaries; release tests verify that command is rejected.

```sh
./scripts/ledger-build-instrumented.sh nanox
SPECULOS_MODEL=nanox node --import tsx apps/ledger/tests/native-memory.ts
```

Three flows passed on all five instrumented models: ordinary 16-input signing; all input/change recovery warnings plus a high fee; and absolute permitted bounds with account/index 2³¹−1, total input at Pearl MAX_MONEY, and the longest amount/path display strings. Measurements initialize while idle, complete trusted review/signing/all signature fetches, then query while idle. Active-session BOLOS fault handling stays enabled.

| Model       | Linker app-stack span | Measured app-stack high-water | Remaining span | Peak allocator occupancy |
| ----------- | --------------------: | ----------------------------: | -------------: | -----------------------: |
| Nano S Plus |              31,968 B |                      12,472 B |       19,496 B |           1,836 /8,192 B |
| Nano X      |              19,660 B |                      12,752 B |        6,908 B |           1,836 /8,192 B |
| Stax        |              26,772 B |                      12,568 B |       14,204 B |           1,836 /8,192 B |
| Flex        |              26,772 B |                      12,576 B |       14,196 B |           1,836 /8,192 B |
| Nano Gen5   |              30,868 B |                      12,576 B |       18,292 B |           1,836 /8,192 B |

Ordinary-flow heap peak was 1,668 B; the longer warning flow reached 1,672 B; absolute bounds reached 1,836 B, leaving 6,356 B of the configured heap. App-stack high-water did not increase. Each report includes the instrumented ELF and both patch hashes. These are observed **instrumented Speculos app** measurements, not strict upper bounds for release code, physical-device guarantees or OS/syscall-stack measurements. Instrumentation changes code layout and may slightly change stack use. Allocator occupancy does not establish the largest available contiguous block or worst-case fragmentation.

## Repeated-session timing

Five successive maximum-16-input sign/fetch/verify sessions passed on each release model. Median elapsed time from starting the final approval gesture through retrieving and independently verifying all signatures was 5.57 s (Nano S Plus), 5.95 s (Nano X), 7.63 s (Stax), 7.87 s (Flex), and 8.47 s (Nano Gen5). Touchscreen values include the 2.5-second hold gesture. These are host-observed Speculos timings under concurrent development workload, not secure-element CPU benchmarks or hardware timing guarantees. Exact per-round values and ELF hashes are retained in `apps/ledger/tests/evidence/<model>/latency.json`.

## Required release validation

- Verify API27 firmware rollout/device compatibility, pin a builder image digest, then reproduce every target/network build
- Execute end-to-end account export, address review and multi-input BIP340 signing in Speculos and on physical devices using public test keys only
- Exercise normal partial button releases and touch/hold confirmations, rejection, duplicate/nested/malformed APDUs, short/extended lengths, disconnect, lock, timeout, restart and faults at the final approval boundary
- Independently compare both secret-key parity branches, tweaks, addresses, all BIP341 digests and signatures with Pearl and published BIP340/BIP86 vectors
- Repeat the measured app-stack/heap and signing-latency checks on physical devices, including OS/syscall memory and fragmentation, at the 16-input/1,507-byte development limit
- Obtain independent security review and Ledger approval before distribution or valuable-funds use
