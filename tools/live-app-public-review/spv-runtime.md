# Official macOS ARM64 runtime inspection

Downloaded [Pearl v1.4.11](https://github.com/pearl-research-labs/pearl/releases/tag/v1.4.11), release commit `2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4`, into a fresh temporary directory:

`/private/tmp/pearl-spv-runtime-ygy09w9x`

The [ARM64 archive](https://github.com/pearl-research-labs/pearl/releases/download/v1.4.11/pearl-darwin-arm64-v1.4.11.tar.gz) is 53,652,814 bytes. Its computed SHA-256 is `27324c98bb6288c29db86165d124b4f48f3a0806aee97354bbd9288287c6922b`, matching **both** the exact GitHub release asset digest and [official checksums.txt](https://github.com/pearl-research-labs/pearl/releases/download/v1.4.11/checksums.txt). The checksum manifest itself hashes to `eaa2abd2547c79208da69fcc01924dbbf1a848cdba4e6053745ca97075f64d13`.

Archive inspection found only its root directory and four regular executables: `pearld`, `prlctl`, `oyster`, `oystercli`. There are no symlinks, hardlinks, special files, path traversal, setuid/setgid entries, `.a` archives, or `.dylib` files. Regular files were extracted manually into `extracted/` with restrictive permissions. `oyster` and `pearld` are ARM64 Mach-O executables; `otool -L oyster` lists only standard macOS libraries/frameworks. No separate zk-pow build library is distributed in this archive.

Only `oyster --version` and `oyster --help` were executed, with explicit unused temporary `--appdata` and `--configfile` paths and temporary cwd. The exact release source was inspected first: help/version exit during argument pre-parsing before configuration loading. Version returned `oyster version 1.4.11+2bb142f`; help returned its documented options (exit 1). The unused data/config paths remained absent. Nothing was installed into PATH or a home directory; no wallet was created/opened, server started, sync performed or seed requested.

Help exposes `--usespv`, `--appdata`, `--configfile`, and wallet creation options, but no watch-only creation or extended-public-account import option. The inspected release RPC registrations do not expose `ImportAccount`. Source-level Go watch-only APIs are a possible integration route, not evidence that the released CLI can safely import the Ledger account. Do not use seed-based creation/import as a shortcut. No conclusion about a completed watch-only adapter or SPV chain validation follows from this inspection.

[Machine-readable provenance](spv-runtime-provenance.json) records archive and executable hashes, source release identity, and help inspection. Raw archive manifest, checksum file, exact-source inspection and help/version output are retained in the temporary runtime directory.
