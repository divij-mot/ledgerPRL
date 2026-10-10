# Native PRL port qualification

These scripts build and test the experimental app at
`apps/ledger-bitcoin-prl`. They never install on a physical Ledger and never
broadcast. Emulator tests use only public BIP32 vector-one seed
`000102030405060708090a0b0c0d0e0f`. Never fund its addresses.

## Build-only

Provide official Ledger secure SDK v27.1.2, Clang/LLD/LLVM tools, ARM GCC and
newlib, Python and the official Ledger build-time Python dependencies. The
wrapper verifies an exact clean SDK checkout before building and refuses changes
to the snapshotted app sources during the build. It selects `bin/app.elf`, not
the device-loading target.

```sh
export BOLOS_SDK="$PWD/apps/ledger/vendor/ledger-secure-sdk"
export PRL_SYSROOT=/path/to/arm-none-eabi
# Add clang, ld.lld, llvm-objcopy, arm-none-eabi-gcc and Python tools to PATH.
tools/bitcoin-prl-port/build.sh nanos2 regtest
tools/bitcoin-prl-port/build.sh stax mainnet
```

Targets: `nanos2 nanox stax flex apex_p`. Networks:
`mainnet testnet testnet2 regtest simnet`. Per-target locks and target-only clean
prevent parallel builds or changed network defines from reusing stale objects.
Artifacts and manifests appear in ignored
`apps/ledger-bitcoin-prl/build-artifacts/<target>-<network>/`. The manifests record
app-source, ELF, HEX and build-log SHA-256 values, declared upstream/SDK metadata,
the SDK path, and compiler/linker/ARM-GCC version strings. They do not hash the
tool executables, sysroot/newlib, Python dependencies or build/provenance scripts,
and the SDK is not rechecked after the build. This is bounded local attribution
of the recorded app and binary bytes, not complete builder-input binding or a
cross-machine reproducibility claim.

Before native release qualification, bind the exact tool executables,
sysroot/libraries, Python dependencies and build recipe, or an equivalent
immutable reviewed builder, and verify SDK revision/cleanliness again after the
build. These remain unqualified release gates. The owner resumed isolated emulator testing on 10 October 2026; the limited
[Nano S Plus checkpoint](../live-app-native-review/README.md) records exact artifacts
and remaining qualification limits.

Clang 19 does not recognize one metadata-only SDK `nonstring` advisory attribute.
The Makefile retains that warning but waives `-Werror=unknown-attributes` for
SDK `app_metadata.o` only. App code and other SDK objects remain under `-Werror`.
The official SDK checkout itself is unmodified.

## Unit and native replay

```sh
tools/bitcoin-prl-port/unit.sh
# Node dependencies must already be installed using the repository lockfile.
export SPECULOS_BIN=/path/to/speculos-venv/bin/speculos
export SPECULOS_PYTHON=/path/to/speculos-venv/bin/python
export SPECULOS_MODEL=nanosp
export PEARL_APP_ELF="$PWD/apps/ledger-bitcoin-prl/build-artifacts/nanos2-regtest/app.elf"
node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-pilot.ts
node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-adversarial.ts
export SPECULOS_INJECTOR="$PWD/apps/ledger/tests/speculos-injector.py"
node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-review-faults.ts
```

Use official Speculos 0.27.1 with API27 shared libraries and qemu-arm available.
`SPECULOS_API_PORT` permits independent concurrent test runs. `PEARL_EVIDENCE`
must name a fresh output directory. Each run snapshots its ELF before execution,
hashes it, records the public seed/emulator version, and captures actual native
screens. The helper drives public emulated buttons/touches; it does not patch
firmware or bypass consent. The optional SEPH injector only permits numeric
event tags to reach firmware and is hash-recorded; it does not modify syscalls,
cryptography or policy.

The raw-protocol adversarial harness intentionally bypasses the production host
validator while supplying honest Merkle commitments/proofs for malformed data.
Success is an actual native rejection with no yielded signature. Lifecycle tests
require explicit firmware exit, not a Python/emulator exception, after faults.
The real timeout test advances the normal SDK ticker rather than shortening the
firmware deadline. Native positive tests verify returned BIP340 signatures in
the host; the separate pinned Pearl Go script-engine oracle adds chain-side
verification. Source-only unit checks are not substitutes for these proofs.

The pure C unit runner compiles all five network configurations with ASan/UBSan,
tests money/fee edges against a 128-bit oracle, exact amount strings with buffer
canaries, and derivation-path boundaries. Leak detection alone is disabled for
the restricted execution environment; address/undefined-behavior checks remain.

## Evidence and limits

Bounded, source-bound result summaries and selected display evidence are retained
under `evidence/` when a qualification checkpoint is frozen. Generated ELF/HEX
binaries and bulk emulator logs are not committed. Earlier results outside that
checkpoint are pilot evidence only. Do not count them toward a changed artifact.

Remaining release requirements include physical-device review/transport testing,
independent professional review, Ledger's application admission decision and
supported release tooling. Passing these emulator tests is not vendor approval,
tamper/fault resistance qualification, or a guarantee that a website is safe.
