# Native firmware reproducibility audit, 2026-10-09

## Findings

The independent checkout at a different logical absolute path did **not** reproduce the Nano S Plus/Nano X mainnet/simnet firmware. All four full ELF hashes, zero-padded load-image hashes and Ledger application hashes differ. Native source manifests, original recorded environment values, SDK pins and compiler versions match.

A separate fresh checkout, mounted at the reference's original logical source path inside an isolated namespace, reproduced **all 25 frozen reference firmware and package trees exactly**. Devices: nanosplus, nanox, stax, flex, apex_p. Networks: mainnet, testnet, testnet2, regtest, simnet. Independent standard-library ELF/APDU reconstruction agrees with the official package application hashes for every variant.

The source used for the replay is commit e36dc35abcd47277a491d5bc4155a576e0ff2855. Crypto source SHA-256 is 50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1. Later parent documentation-only changes did not alter the measured native source manifests.

## Why this is a firmware difference

The reference ELF has no .debug* sections to strip. Absolute Rust source paths occur in allocated .rodata, including pearl-core transaction.rs/address.rs/session.rs and Ledger SDK io_new.rs. Rust crate disambiguators also differ. Changed sections include .text, .rodata, .rel_flash, relocation tables and symbol/string tables. Canonical-path fresh builds restore the reference bytes exactly, isolating path dependence in this experiment.

For example, Nano S Plus/mainnet:

- Reference ELF: 734ad170d4621eb98b20809f548cacbe32e5409d158d3e2eea47a6736fbeb136
- Different-path ELF: 1a82fa07436d15b432feba53020e1aae9745083399180e55d343878b00f56aa5
- Reference application hash: 8787dc47f3e9731c7704713c747cc5f6f737f706ddedb9353844b965dd65d1c7
- Different-path application hash: 8734ffcf6b73a45155751c9aae4e3bc8c9a1c7c2de17e0c1c61b11e26c82598d
- Fresh canonical-path ELF and application hash: exact reference matches

See evidence/comparison.json for all four comparisons and evidence/path-dependence.json for selected paths and symbols. The complete 25-variant hashes/checks are in evidence/canonical-all25-comparison.json.

## Isolation

Both baseline checkouts were local Git clones using --no-hardlinks, without object alternates or parent-shared source inodes. SDK Git checkouts and the locked Cargo cache were privately copied. The native targets were initially absent. Every build/package operation used a bubblewrap namespace with the outer filesystem read-only and only the private run/cache writable. In the canonical control, the reference source pathname resolved to the private copy inside the namespace, proven by inode equality; the real host parent had a different inode.

All frozen artifacts and SDK bytes remained unchanged, and the native source snapshot still matched all 25 reference manifests afterward. Parent documentation/evidence files changed concurrently; none were writable from these build namespaces. SDK revision/transport-patch checks and production source-stability checks ran unchanged.

Cargo was explicitly offline, Git network protocols were disabled, and Rustup auto-install was disabled. No downloads, credentials, hardware, funds, commits or push were used. Extra network-namespace and ptrace diagnostic probes were unavailable under this kernel; filesystem isolation succeeded. This is not a claim of network syscall tracing or a new network-security boundary.

## Recommendation and limits

Use the documented fixed logical build layout inside a namespace/container to preserve already-qualified bytes. The physical host checkout path is arbitrary. The historical logical paths are still part of this firmware's reproducibility contract; choosing a cleaner new logical root changes firmware bytes and requires new provenance and requalification.

Three separate remapping pilots, including Rust runtime paths and C file/debug prefix maps, failed cross-root ELF/load equality. They remain unqualified experiments; see REMAP-PILOTS.md. There was no production build-script, SDK or native-source change from this audit.

The result covers rebuild/packaging equality on the measured installed toolchain, not arbitrary compiler/OS versions. Key executable digests are recorded, but no complete builder-image digest or distributable container image was created. No additional runtime or physical-device testing was performed by this task. The canonical outputs reproduce the original qualification inputs exactly.

## Retention

This compact folder contains source/text evidence, checksums and configurable replay/check programs. Large payloads, complete compiler logs, original fixed-run audit helpers and source tarball remain in the separate archive identified by external-artifacts.json. Checksums are integrity records, not signatures or attestations by Ledger.
