# Native Ledger development app

Development app build. Do not use with valuable funds. This is a native Rust Ledger application, not a host signer or an ECDSA substitute. There is no seed entry, secret-key export, raw-digest signing command, software signing fallback, or broadcast implementation in the app.

## Recorded build and runtime checkpoints (9 October 2026)

Evidence below is bound to its recorded source and ELF hashes. See the [final lexical-source requalification](test-evidence.md#final-lexical-key-lifetime-requalification) for later checks; an older passing artifact is not automatically a passing current artifact.

The earlier retained build checkpoint compiled and linked for **Nano S Plus, Nano X, Stax, Flex and Nano Gen5 (`apex_p`)**, using the real Ledger Rust SDK, generated C bindings, Ledger linker layouts, and NBGL UI. Mainnet and simnet builds pass for all five targets. Nano S Plus also builds testnet, testnet2 and regtest. Thirteen retained build manifests bind exact network/device, source and lockfile hashes, SDK commits, compiler versions and ELF bytes.

The active secure SDK is stable **v27.1.2 / API 27**, pinned to `6709cd2bdfebb224ee070f7c1211b54254262579`. The originally investigated `b03e7d...` development SDK declared API 0; it was replaced after source and runtime compatibility checks. No API-level override is needed for the active build. Latest device-specific SDK tags observed are Nano S Plus 1.7.0, Nano X 2.8.0, Stax 1.11.0, Flex 1.7.0 and Nano Gen5/Apex P 1.2.0, sharing API 27. Public firmware-rollout status is a separate check from SDK tag presence.

**Actual five-model emulator/node proof:** all five release ELFs at that earlier checkpoint passed all 22 integration cases at the 16-input/1,507-byte limit in Speculos 0.27.1, using only the public BIP32 vector-one seed. Account metadata matched the independent fixture and full-address review passed. The companion independently verified native BIP340 signatures; isolated pinned Pearl simnet nodes rejected a bit-flipped signature, accepted and mined the genuine transaction, and the watch-only wallet discovered the result and handled invalidation/reconsideration. Partial signature export followed by abort and a fresh successful session passed too. Those source-bound exact-ELF summaries and two compact screenshots per model are retained as `apps/ledger/tests/evidence/<model>/node-roundtrip.json` and `node-*.png`. Replay uses `tests/e2e/native-node-roundtrip.ts`, with installed tool paths explicitly supplied as documented in `tests/e2e/README.md`. No private-key host signer is used.

Physical-device installation, actual OS compatibility, physical disconnect behavior, hardware timing/side-channel resistance and a formal external security audit are not established by emulator or build success. Instrumented app-stack/allocator measurements and independent source/optimized-disassembly checks are recorded below; these do not replace physical validation. No physical device has been installed, upgraded, reset, or used to sign.

## Installation is a separate gate

This deliverable is an application for Ledger OS, **not an OS/BOLOS firmware image or flashing procedure**. Compiling an ELF and running it in Speculos do not establish installation compatibility. Speculos does not emulate installation/OS-update syscalls or the hardware watchdog. [Ledger development framework](https://developers.ledger.com/docs/device-app/references/framework).

Ledger documents development sideloading for Nano S Plus, Stax, Flex and Nano Gen5 (`apex_p`), conditional on actual device OS/API and package compatibility. **An ordinary retail Nano X cannot sideload this unpublished app.** Its physical testing requires a Ledger-controlled distribution or special-development-device arrangement. A host option for development Nano X devices is not a retail workaround. Pearl has no vendor test-provider or production listing; this document does not authorize changing providers. [Official loading restrictions](https://developers.ledger.com/docs/device-app/beginner/vscode-extension), [official four-model sideload installer](https://github.com/LedgerHQ/app-boilerplate-rust/blob/0f857a78085678a26b332cf99128e22c0e5a6bde/tools/sideload/README.md), [vendor deployment process](https://developers.ledger.com/docs/device-app/submission-process/process).

The API-27 versions above are SDK-to-OS mappings, not proof that a particular retail device has received or is eligible for an update. Record the actual OS/API separately for each owner-approved test device. Consumer rollout is staged. [current official SDK API mapping](https://github.com/LedgerHQ/ledger-secure-sdk#about-api_level-branches), [Ledger rollout guidance](https://support.ledger.com/de/article/4405549392401-zd).

### Seed, trust and device safety

- Ordinary app loading and an OS update are different operations. The documented app-loading route begins with an already-unlocked device and on-device confirmation; it does not require recovery-phrase entry or a seed reset. An untested installer is not guaranteed harmless, so use a dedicated, no-value test device after separate approval.
- The extension's **quick setup** assigns a generic test seed/PIN. It is not an app-install prerequisite and must never be applied to a valuable existing wallet. [Official quick-setup warning](https://developers.ledger.com/docs/device-app/beginner/vscode-extension).
- A custom developer CA changes device trust and can bypass per-install confirmation. Ledger says Genuine Check is unavailable until that CA and its loaded apps are removed. It is optional, is not a retail Nano X remedy, and is not used by this project. [Developer tools](https://developers.ledger.com/docs/device-app/references/tools), [CA privileges](https://developers.ledger.com/docs/device-app/explanation/ledger-os/features).
- A separate OS upgrade carries a small reset risk and may require recovery from backup. Never promise a seed-preserving firmware update or hide one inside “install app.” [Ledger OS-update guidance](https://support.ledger.com/fr/article/8458939792669-zd).
- Recovery entry, factory reset, quick setup, CA enrollment, security-warning bypasses, privileged USB configuration and provider/trust changes are not hidden prerequisites. None has been performed. Hardware use, changes to device/security state, private-source sharing and vendor submission require separate owner authorization.

## Offline install packaging

The existing frozen ELF is the input; packaging does **not** rebuild or modify it. `scripts/ledger-package.py` snapshots an ELF/build-manifest pair under the target lock, verifies source hashes and target/network identity, converts to Intel HEX, and uses pinned Ledger `HexLoader` with a file-only sink to emit unsigned install-manager APDUs. It does not import the hardware communication module, create keys, authenticate, load a device, enroll a CA or flash an OS.

The official current Rust route is `cargo-ledger` → `ledgerblue`. The reviewed cargo-ledger revision `906d6963a9dfcbd19ad090b8501e26cd317ff988` invokes `loadApp --offline`, but also emits deletion of an existing same-name app; loadApp creates an unused manager key even offline. This wrapper deliberately uses the same pinned loader API without either behavior. No delete or signed-commit command is permitted. A future authorized replacement install must separately decide how an existing app is handled. [Pinned cargo-ledger implementation](https://github.com/LedgerHQ/cargo-ledger/blob/906d6963a9dfcbd19ad090b8501e26cd317ff988/src/utils.rs).

Independent checks reconstruct every APDU-written byte and zero-filled image gap against the ELF, validate HEX checksums, command order, per-segment CRC, entry point, API, data/install lengths and final commit, and compare the computed application hash with Ledger's canonical `hashApp` calculation. The install TLV must contain exactly the expected app name/version/icon and **secp256k1-only** derivation prefix. Duplicate/unknown TLVs, extra curves, wildcard/root/SLIP21 paths, unexpected flags, deletion/trust commands or a different model/network fail closed. `package.json` records both ELF SHA256 and Ledger application hash; they measure different byte sequences and must not be confused.

### Effective permissions

| Model       | Target ID    | Effective app flags |
| ----------- | ------------ | ------------------- |
| Nano S Plus | `0x33100004` | `0x0`               |
| Nano X      | `0x33000004` | `0x200`             |
| Stax        | `0x33200004` | `0x200`             |
| Flex        | `0x33300004` | `0x200`             |
| Nano Gen5   | `0x33400004` | `0x200`             |

Cargo's base `flags = "0"` is not the whole effective policy: the pinned official Rust SDK adds `APPLICATION_FLAG_BOLOS_SETTINGS` (`0x200`) on the four Bluetooth-capable targets. Its build-script comment identifies Bluetooth enabling as the reason; the secure SDK defines the flag as permission to change settings. This is a real privilege to disclose and review, not a claim of harmlessness. The current official Rust boilerplate also starts with `flags = "0"` under this SDK policy. Do not silently remove it or accept additional bits. Master-seed (`0x10`), preloaded (`0x20`), global-PIN (`0x40`) and library (`0x800`) flags are not permitted. [Pinned SDK flag addition](https://github.com/LedgerHQ/ledger-device-rust-sdk/blob/4123d2dc85a2085115e6a36826460a9fe742cfb1/ledger_device_sdk/build.rs#L92-L110), [secure SDK flag definitions](https://github.com/LedgerHQ/ledger-secure-sdk/blob/6709cd2bdfebb224ee070f7c1211b54254262579/include/appflags.h), [official boilerplate metadata](https://github.com/LedgerHQ/app-boilerplate-rust/blob/0f857a78085678a26b332cf99128e22c0e5a6bde/Cargo.toml).

Network app names are `Pearl Dev`, `Pearl Test Dev`, `Pearl Test2 Dev`, `Pearl Reg Dev` and `Pearl Sim Dev`. Mainnet permits only `86'/808276'`; the four other networks permit only `86'/1'`. Nano X packages are vendor-review artifacts and do not establish a retail sideload route.

```sh
python3 -m venv /path/to/packaging-venv
/path/to/packaging-venv/bin/python -m pip install -r apps/ledger/packaging-requirements.txt
/path/to/packaging-venv/bin/ledger-manifest --check . ledger_app.toml
/path/to/packaging-venv/bin/python scripts/ledger-package.py --check-configuration
/path/to/packaging-venv/bin/python scripts/ledger-package.py \
  --device nanosplus --network simnet --output /path/to/fresh-package-directory
/path/to/packaging-venv/bin/python -m unittest discover \
  -s apps/ledger/tests -p package_test.py -v
```

Use `--objcopy` or `LEDGER_OBJCOPY` for an explicit official ARM GNU objcopy path. Output directories must be new; cooperating publishers are locked and a complete verified generation is renamed into place. Packages include `.elf`, original `.build.json`, `.hex`, `.apdu`, application `.sha256` and `package.json`. The dependency snapshot pins ledgerblue 0.1.58, ledgered 0.17.0, pyelftools 0.33 and transitive versions; reports also hash the actual loader/parser/hash modules. It is a version snapshot, not a cross-platform wheel-hash lock. Physical installation and installed permissions remain unverified until a separately authorized device test.

All thirteen existing model/network ELF variants passed the offline packaging checks on 2026-10-09. Compact reports, exact hashes and replay details are retained in `apps/ledger/tests/evidence/packaging/`. Two inspection/provenance defects found during independent review were fixed and regression-tested before regenerating the reports; valid package image/APDU bytes were unchanged.

## Publication configuration status

The official manifest is at repository root (`ledger_app.toml`) with `build_directory = "./apps/ledger"`, as expected by Ledger's metadata workflow. It lists build targets, not installation eligibility. The minimal manual-only `.github/workflows/ledger-review.yml` uses read-only repository permissions, validates the real root manifest with pinned Ledger tooling and runs offline rejection tests. It has no secrets, native build, hardware loading, submission, release or automatic push/PR trigger. Local preflight success is **not Ledger publication compliance**, and the GitHub workflow has not been dispatched as part of this packaging task.

`apps/ledger/publication/official-gates.json` records disabled/documentary references to Ledger's guidelines, build and Ragger workflows at `77dc9ecd7b4bb8d25346ca503ad2f603e62911b4`. That upstream build runs `cargo update ledger_device_sdk`, uses a mutable `:latest` builder, lacks a preparation hook for this reviewed SDK patch, and requests action/pull-request write permissions; its Ragger workflow additionally requests contents-write access for snapshot pull requests. Nested tool/action references are not all immutable. The existing TypeScript native tests are not an implemented Ragger suite. These incompatibilities must be resolved with Ledger without weakening source pins or silently increasing privileges. The custom SDK patch, effective flags and test integration are explicit vendor-review items. [Pinned metadata discovery](https://github.com/LedgerHQ/ledger-app-workflows/blob/77dc9ecd7b4bb8d25346ca503ad2f603e62911b4/.github/workflows/_get_app_metadata.yml), [pinned native build workflow](https://github.com/LedgerHQ/ledger-app-workflows/blob/77dc9ecd7b4bb8d25346ca503ad2f603e62911b4/.github/workflows/reusable_build.yml).

No project license has been chosen, no private source has been disclosed to Ledger/an auditor, no agreement has been accepted and no app submitted. The required owner/vendor/human-review gates remain in [the submission checklist](submission-checklist.md). The canonical protocol is linked from [docs/apdu.md](apdu.md); no second protocol copy or runtime change was introduced.

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

The independent [trusted-display review](../apps/ledger/tests/evidence/trusted-display/README.md) passed 125 emulator flows across all five models, including mainnet/simnet full-address pagination, maximum amount/path values and explicit reject/approve gestures. It retains 400 exact field comparisons, 20 warning-detail comparisons and selected original screenshots. Account export retains the standard SDK's generic touchscreen “Hold to sign” wording; the flow exports watch-only data and does not sign a transaction. Physical-screen validation remains a separate gate.

`pearl-core` is the allocation-free parser, policy, BIP341 sighash and chunked APDU state machine. The adapter copies a short APDU before lending its SDK communication object to NBGL. Ownership-validated transaction state is immutable, and a `ReviewedTransaction` token exists only after the trusted UI accepts.

NBGL's full review flow is used on all five devices, including Nano NBGL button controls. It shows network, account path, **full recipient address**, exact eight-decimal PRL amount, exact fee, change amount, full change address and change path. Address verification shows the full address, network, path and BIP86 policy. Account export requires review and explains its watch-only privacy impact. No blind/light-review bypass exists. Account numbers above 100 and address indexes above 50,000 receive a separate physical "Unusual path" warning; they remain available for deliberate recovery. Fees at least 10% of inputs, when input total is over 100,000 grains, receive a separate high-fee approval. The comparison uses a division/ceiling threshold, never overflowing multiplication; five boundary/overflow tests exercise it.

See `protocol-v1.md` for every field, command and status. All inputs and change must independently match device-derived BIP86 keys. An external recipient x-only key is validated using SDK decompression, on-curve/infinity checks, field range and canonical round-trip checks. The device cannot establish chain truth or infer a recipient's hidden Taproot script policy from its address.

## Small cryptographic boundary

The small additional C bridges live in the tracked SDK patch; they add no cryptographic implementation or path permissions. All application `unsafe` calls are confined to `src/crypto.rs` (besides the Rust 2024 entry-point attribute). Every fallible syscall/cryptographic return code is checked. Signing obtains auxiliary entropy through checked `cx_get_random_bytes` before constructing a derived private key; a returned error fails closed. The void SDK convenience wrapper is not used. Nonreturning OS faults and SDK-internal EC randomization remain separate platform qualification limits.

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

Retained current-binary summaries and compact node screenshots are in `apps/ledger/tests/evidence/`; the reusable node-roundtrip harness and earlier checkpoint evidence are in `tests/e2e/`. Native smoke tests reject zero/all-FF recipient x-only keys in the SDK, then perform a valid address/sign operation to exercise BN-resource cleanup. Warning tests require extra emulated device UI button/touch approval for account 101, index 50,001 and a 20% fee. Fault tests exercise final-approval races, malformed/nested/BOLOS commands, malformed SEPH, reported USB power loss, actual 1,200-tick timeout and benign partial button release.

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

## Mixed-session stability replay

`apps/ledger/tests/native-stability.ts` keeps one immutable app snapshot and one emulator process alive for the whole run. The deterministic ten-session cycle mixes full signing, address verification, account export, partial/full upload cancellation, visible review rejection, forged ownership/invalid point rejection, offset/hash errors, partial-signature cancellation, and a 16-input maximum. Transaction shapes vary input branches/indices, output ordering, change presence, fee boundaries and exact amounts above JavaScript’s safe-integer range. Every completed cycle must return to idle, canceled/rejected approvals must be unusable, and every exported signature is independently verified.

Run release and instrumented replays separately, with fresh output directories on a filesystem large enough for immutable ELF snapshots:

```sh
# Existing simnet release artifact; 100 successive mixed sessions by default.
SPECULOS_MODEL=nanox PEARL_EVIDENCE=/path/to/fresh-release-evidence \
  node --import tsx apps/ledger/tests/native-stability.ts

# Separately named instrumented artifact; 20 mixed sessions by default.
# Build it first with ledger-build-instrumented.sh if not already available.
SPECULOS_MODEL=nanox PEARL_INSTRUMENTED=1 \
  PEARL_EVIDENCE=/path/to/fresh-instrumented-evidence \
  node --import tsx apps/ledger/tests/native-stability.ts
```

Repeat for `nanosp`, `stax`, `flex` and `apex_p`. Concurrent runs need distinct `SPECULOS_API_PORT` values with gaps of at least two. The harness refuses bulk `/tmp` evidence and existing snapshots. It retains a 256 KiB emulator-log tail, 64 recent UI observations, 32 recent APDUs and at most eight sampled screenshots. Official Speculos `DELETE /events` clears historical OCR observations after each idle session; it does not alter current screen content, firmware state or consent. This bounds an emulator-side observation cache rather than mistaking its intentional growth for native leakage.

Release reports include exact ELF and test-source hashes, all session results, signature counts, latency distributions and emulator process RSS sampled after each ten-session cycle. RSS and host JavaScript heap are **not native app allocator measurements**. The separate instrumented replay initializes app-stack/allocator measurement once, keeps cumulative peaks across the run, and checks that every sampled idle heap baseline equals its initial value. It reports app-stack high-water and allocator occupancy, subject to the instrumented-memory limitations above. All interaction is emulated device UI; no physical Ledger is attached. Timings include host contention, rendering, gestures, transport and verification and do not estimate physical-device performance.

All five models passed 100 successive mixed release sessions and a separate 20-session instrumented replay on 2026-10-09. The release runs verified 1,130 signatures. Instrumented idle heap stayed at 160 B at initialization and sessions 10/20; cumulative peak remained 1,672 B after the first cycle. Host emulator RSS increased by 2.2–8.4 MiB over release sessions 10–100, which is retained separately and is not attributed to native allocation. Full distributions, hashes, limitations and replay commands are in `apps/ledger/tests/evidence/stability/README.md`.

## Normal-clock pending-state expiry

The [portable wall-clock qualification](../tools/native-wallclock/README.md) ran untouched Speculos 0.27.1 with its normal 100 ms ticker on all five simnet models. Incomplete upload, unapproved final review, and approved-but-partly-exported signatures each caused explicit native exit after 1,200 observed normal ticks. The final portability replay measured 120.127–120.958 seconds across those 15 cases; five completed-session idle controls remained responsive after 125 seconds.

All 60 stale-state restart probes rejected old fetch/review/append requests. A new transaction required fresh emulated approval and independently verified signatures. Twelve preflight controls check exact source inventories and copied ELF/manifest identity before execution. Original qualification and full portable replay are separate evidence for the same matrix, not additional unique coverage. No accelerated or injected ticker was used. These are emulator results, not a guarantee of physical-device timing, RAM erasure, or every transport/scheduling race.

## Checked entropy and private-key lifetimes

The [native secret-lifecycle review](../tools/native-secret-review/REPORT.md) records checked auxiliary-randomness acquisition before private-key derivation and lexical key scopes that end before public-only identifier/verification calls. The bounded host controls check both wiped contents and the original key-storage address. An intermediate explicit by-value `drop(key)` candidate was rejected because its optimized code wiped a moved temporary; it was not accepted as qualified firmware.

The retained source-bound assembly reviews verify original-slot scalar/metadata cleanup on ordinary success/error paths in all five simnet and five mainnet models. These are distinct from hardware proof: OS exceptions, IO_RESET restart, panics and nonreturning syscalls can bypass Rust cleanup. App and OS-owned RAM, register/spill behavior and physical fault handling remain release gates. Run the portable controls only with the documented exact SDK setup; a host mock or source hash is not a substitute for reviewing the emitted native code.

## Required release validation

- Verify API27 firmware rollout/device compatibility, pin a builder image digest, then reproduce every target/network build
- Execute end-to-end account export, address review and multi-input BIP340 signing in Speculos and on physical devices using public test keys only
- Exercise normal partial button releases and touch/hold confirmations, rejection, duplicate/nested/malformed APDUs, short/extended lengths, disconnect, lock, timeout, restart and faults at the final approval boundary
- Independently compare both secret-key parity branches, tweaks, addresses, all BIP341 digests and signatures with Pearl and published BIP340/BIP86 vectors
- Repeat the measured app-stack/heap and signing-latency checks on physical devices, including OS/syscall memory and fragmentation, at the 16-input/1,507-byte development limit
- Obtain independent security review and Ledger approval before distribution or valuable-funds use
