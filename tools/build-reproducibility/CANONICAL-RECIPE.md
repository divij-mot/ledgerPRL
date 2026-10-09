# Fixed logical paths, caller-local inputs

## What was demonstrated

The private host checkout /workspace/shared/prl-build-repro/control-source was mounted at /workspace/scratch/5d237258d612/ledgerPRL inside a bubblewrap namespace. It reproduced all 25 reference ELF/package trees exactly. The original host checkout was hidden by this mount and remained untouched. The physical checkout can therefore be elsewhere; the **logical path seen by compilers** must retain the recorded value to reproduce these existing bytes.

This folder supplies a replay against an existing Linux builder. It does not supply or provision a standalone container image. A future container can provision the same logical layout, but that image would need its own verification. The replay deliberately fails if the recorded tool layout/mount destinations are absent, rather than creating historical directories in the user's host filesystem or downloading tools.

## Fixed logical builder contract

builder-layout.json records:

- Source root: /workspace/scratch/5d237258d612/ledgerPRL
- Cargo home: /tmp/pearl-cargo (a private cache copy is mounted here)
- Rustup home: /tmp/pearl-rustup
- Compiler/tool prefixes: /tmp/pearl-ledger-tools, /tmp/pearl-toolchain/root/usr/lib/llvm-19/bin, /tmp/pearl-toolchain/root/usr/bin
- Build Python environment: /tmp/pearl-speculos-venv/bin
- Shared-library search path: /tmp/pearl-toolchain/root/usr/lib/x86_64-linux-gnu
- In the measured builder, /tmp/pearl-toolchain resolves to /workspace/shared/pearl-toolchain

The canonical source and Cargo mount destinations must already exist in that builder. Rustup/compiler installations are reused read-only. The ARM GCC wrapper at /tmp/pearl-ledger-tools/arm-none-eabi-gcc returns the original /tmp/pearl-toolchain/root/usr/lib/arm-none-eabi sysroot for -print-sysroot and delegates other calls to the installed compiler.

Pinned inputs: nightly-2025-12-05, rustc b33119ffdd483969934b10a886dc06dd29a473f9 (LLVM 21.1.5); clang 19.1.7; ARM GCC 14.2.1 20241119; Rust SDK 4123d2dc85a2085115e6a36826460a9fe742cfb1 with the exact reviewed strict-transport.patch; secure SDK 6709cd2bdfebb224ee070f7c1211b54254262579; committed Cargo locks, target/linker/profile configuration and exact native source-manifest bytes. For strong reproducibility, pin the whole toolchain installation, not version labels alone. evidence/tool-binaries.json covers selected executable digests only.

## Caller-local paths

These arguments may point to the caller's own locations:

- --source: existing local Git checkout, cloned privately; --commit selects a locally available revision
- --sdk-source: existing SDK checkouts, copied privately (default SOURCE/apps/ledger/vendor)
- --cargo-cache: existing populated Cargo home; only bin and registry are copied
- --output: a new private directory, disjoint from the source tree; all builds/packages/logs go here
- --reference-artifacts and --reference-packages: read-only accepted comparison inputs
- --packaging-python: already-installed Python environment with ledgerblue 0.1.58 and pyelftools 0.33

These paths are input/output locations, not Rust source-root replacements. The private source and Cargo cache are mounted at the fixed logical destinations before compilation.

## Replay behavior

replay.py uses --no-hardlinks cloning, rejects Git object alternates/external copied symlinks, copies pinned SDKs, checks clone inode independence and initially absent native targets, and uses a clean allowlisted environment. Cargo offline mode, disabled Rustup auto-install and Git protocol.allow=never are enforced. No credentials are copied. A minimal /dev is created without USB passthrough.

The clean environment omits developer overrides such as RUSTFLAGS, CARGO_ENCODED_RUSTFLAGS, CFLAGS, CC, AR, HEAP_SIZE, APP_STORAGE_SIZE, LEDGER_SDK_EXTRA_DEFINES, LEDGER_SDK_EXTRA_CFLAGS, LEDGER_APP_PACKAGE and Cargo profile/root-dir switches. Existing recorded Cargo/ancestor configuration remains part of the builder layout. The new private HOME prevents unrelated home-directory configuration from being introduced; CARGO_HOME and RUSTUP_HOME are explicit.

The essential namespace mapping is:

    bwrap --ro-bind / / --dev /dev \
      --bind "$PRIVATE_OUTPUT" "$PRIVATE_OUTPUT" \
      --bind "$PRIVATE_OUTPUT/cargo-home" /tmp/pearl-cargo \
      --bind "$PRIVATE_OUTPUT/source" /workspace/scratch/5d237258d612/ledgerPRL \
      -- python3 /path/to/canonical_build.py "$PRIVATE_OUTPUT/job.json"

The actual driver supplies an allowlisted environment, absolute Python/script paths and a private-mount safety marker. canonical_build.py refuses execution unless the canonical source root and private copy have the same inode. It snapshots sources, checks selected reference manifests, invokes unchanged production build/stage/package scripts, compares each resulting ELF to the reference, and verifies source stability afterward. verify.py then independently validates complete package equality and reconstructed application hashes.

The examples and CLI are in README.md. Existing output directories are refused. The default selection is all 25 variants; no hardware or publication step exists.

## Qualification boundary

Changing the canonical logical root, compiler layout, crate-cache path policy, native source or build flags can change firmware bytes. The remapping experiments did. A cleaner future build layout requires new reviewed provenance and runtime requalification. This recipe preserves already-qualified bytes; it does not remove historical path strings from them or establish physical-device compatibility.
