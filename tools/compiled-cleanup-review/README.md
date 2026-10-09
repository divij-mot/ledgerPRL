# Portable independent compiled cleanup crosscheck

This package retains the completed independent review of 25 exact Pearl Ledger development ELFs. It contains no ELFs, full disassembly, caches, repository files, or copied evidence from `native-secret-review`.

## Result and claim

The five simnet pilots received fresh manual optimized-ARM review. All 25 model/network ELFs passed the bounded original-slot caller CFG/address and actual zeroizer-shape checks. Exact claim: **scalar32 + d_len32 + curve8 are explicitly zeroed in the original application key slot on the reviewed ordinary success/returned-error paths**. Three ABI padding bytes are not explicitly overwritten by Drop. CPU registers/spills, SDK scratch, OS exceptions/reset paths, and physical erasure remain outside this result. Read `REPORT.md` for assumptions and precise coverage.

## Contents

- `REPORT.md`: report, exact five-pilot address table, method, and limits
- `identities.json`: exact source hash plus all 25 ELF and adjacent build-manifest SHA256 identities
- `replay.py`: self-contained Python-standard-library replay with explicit input/tool/output arguments
- `evidence/cfg-results.json`: retained all-25 caller CFG/address results
- `evidence/wipe-shapes.json`: manually reviewed per-model zero-store instruction shapes and all-25 comparison results
- `evidence/all-artifact-checks.json`: all-25 ELF hashes and raw selected-function byte hashes; raw function hashes need not be equal across networks
- `evidence/selected-pilot-snippets.txt`: compact selections from this review's original disassemblies
- `SHA256SUMS`: checksums of every retained package file except this checksum file itself

## Replay

Replay runs ARM objdump over all 25 ELFs. Schedule it outside timing-sensitive emulator measurements. It does not rebuild artifacts.

Requirements: Python 3.9+; an ARM GNU `arm-none-eabi-objdump` producing the retained GNU disassembly syntax; all exact retained ELFs/manifests; final `crypto.rs`. The checker is intentionally artifact-specific, not a general ARM verifier. The retained run used `/tmp/pearl-toolchain/root/usr/bin/arm-none-eabi-objdump`; an equivalent executable may be elsewhere. Use `--objdump-library-dir` if its dynamic libraries are not on the loader's default path.

```sh
cd /path/to/portable
sha256sum -c SHA256SUMS
python replay.py \
  --source-file /path/to/ledgerPRL/apps/ledger/src/crypto.rs \
  --artifacts-dir /path/to/immutable/artifacts \
  --objdump /path/to/arm-none-eabi-objdump \
  --objdump-library-dir /path/to/toolchain/usr/lib/x86_64-linux-gnu \
  --output-dir /path/to/new-empty-replay-output
```

`--objdump-library-dir` is optional. All other arguments are required. The output directory must be new or empty and outside the package, artifact directory, and source-file directory. Never point it at a build/artifact directory. Do not run Python with `-O` or `-OO`; the checker rejects this because the bounded helper includes assertions.

The checker verifies the actual crypto source SHA256, all exact ELF and manifest SHA256 values, manifest crypto source hash, model/network identity, and pinned SDK identifiers **before** invoking objdump. It checks inputs again after replay. It does not rebuild source or claim to rehash the entire working source tree; the complete recorded build-source manifest is instead bound by its exact manifest SHA256. Unsupported pointer definitions/control-flow exits, changed artifacts, changed source, or retained-result/zeroizer-shape mismatch fail closed.

Replay writes full generated disassembly and `replay-results.json` to the supplied output directory, leaving the retained package and immutable artifacts untouched. A successful replay reproduces the bounded caller/drop results; it does not repeat physical testing or automatically prove every manually reviewed RNG/helper observation.

The portable wrapper passed syntax/help and early wrong-source rejection checks during packaging. A separate end-to-end replay on 2026-10-09 passed all 25 exact artifacts, including pre/post identity checks. Its compact result is retained in `evidence/independent-replay.json`; this repeats the existing matrix and adds no unique artifact coverage.
