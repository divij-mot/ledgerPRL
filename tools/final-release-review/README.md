# Portable final release crosscheck

This source-only package contains a concise review, an artifact-specific read-only validator, its successful result, and six isolated replay/negative controls. It includes no binaries, source snapshot, copied build manifests, secret candidates, or broad scan output.

Requirements: Python 3.9+ and the original complete qualification/reproduction directories, including ELFs, package files and underlying runtime JSON. The checker also needs the reviewed source snapshot and its retained `tools/compiled-cleanup-review/identities.json`. No dependency installation, network, emulator, device or Rust toolchain is used. The existing independent APDU decoder is checked against an exact SHA256 before being loaded; this is not a new independent parser implementation.

Use a source snapshot corresponding to local `d1fd0d3` / published `8db0cf0`. The later host-only compact-backup export edit changes one of the 39 bound runtime sources, so a source-exact replay correctly rejects that newer tree. This does not invalidate the unchanged final502 native artifacts.

```sh
python3 validate.py \
  --repo /path/to/reviewed-source-snapshot \
  --qualification-dir /path/to/final-qualification-run \
  --reproduction-dir /path/to/canonical-build-reproduction \
  --output /path/to/new-validation-results.json

python3 test_validation.py \
  --repo /path/to/reviewed-source-snapshot \
  --qualification-dir /path/to/final-qualification-run \
  --reproduction-dir /path/to/canonical-build-reproduction \
  --output /path/to/new-validation-controls.json
```

Output files must be new and outside all input trees. Create the controls output's parent directory beforehand. Controls create temporary source copies/symlinked evidence overlays under that output parent and delete only those temporary overlays afterward; originals remain untouched.

The validator requires the exact 25-model/network and 30-suite matrices, full source inventories and actual bytes. It does not follow historical absolute paths in JSON. Missing inputs fail rather than skip. The original retained run used `pearl-lexical-requalification-20261009-1852` and `prl-build-repro`; those names are provenance, not required absolute paths.

A PASS means counts, statuses, recorded source bindings, artifact bytes, canonical output equality and pinned APDU decoding are consistent. It does not replay native tests, independently reverify runtime signatures, prove fresh compilation, or establish physical/device/browser/human-audit approval. See `REPORT.md` for the exact review and subsequent host fix.

A separate root replay against a fresh Git archive of the recorded checkpoint passed the full validator and all six controls on 2026-10-09. Compact outputs are `independent-validation.json` and `independent-controls.json`; this repeats the same coverage.
