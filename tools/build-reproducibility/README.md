# Native build reproducibility evidence and offline replay

## Result

- **25/25 canonical logical-path rebuilds and complete offline packages match the frozen reference bytes exactly.** This includes ELF, load image, application hash, build manifest, HEX, APDU, hash file and package.json.
- **4/4 different-checkout-path builds differ in actual firmware bytes**, not just debug metadata. Absolute runtime paths and path-dependent Rust identities are observable.
- Three isolated remapping pilots failed cross-path ELF/load equality. Their outputs are not qualified firmware.

The smallest proven approach for the existing qualified bytes is a fixed logical source path inside a private build namespace. The physical host checkout can live elsewhere. This folder does **not** provide, download or claim to validate a standalone builder/container image.

Read [REPORT.md](REPORT.md), [CANONICAL-RECIPE.md](CANONICAL-RECIPE.md) and [REMAP-PILOTS.md](REMAP-PILOTS.md).

## Files

- evidence/canonical-all25-comparison.json: full measured matrix with exact ELF/load-image/application hashes and per-file equality checks
- evidence/comparison.json: four changed-path builds and their canonical-path controls
- evidence/path-dependence.json: selected embedded-path, section and Rust-symbol evidence
- evidence/isolation.json and preflight.json: private-copy/mount proofs and unchanged native inputs
- evidence/tool-binaries.json: hashes of selected installed executables; not a complete builder-image lock
- evidence/parameterized-verifier-all25.json: the new configurable verifier checked against all 25 saved packages
- builder-layout.json: fixed logical paths and pinned SDK revisions of the measured builder
- SHA256SUMS and check_evidence.py: compact-folder integrity and recorded-result checks
- external-artifacts.json: identity/hash of the separate 9.7 MB full evidence archive

No ELF, HEX, APDU, source tarball, dependency cache or full compiler log is included here. The copied independent_elf_apdu.py is the existing standard-library verifier from apps/ledger/tests/package-independent.py at source commit e36dc35abcd47277a491d5bc4155a576e0ff2855; its original hash is recorded in external-artifacts.json.

## Check the retained evidence

    python3 tools/build-reproducibility/check_evidence.py

This validates local file hashes and the recorded matrix. It does not rebuild firmware or independently recreate missing external payloads.

## Independently verify existing payloads

Supply caller-local artifact/package directories. All 25 variants are selected by default:

    python3 tools/build-reproducibility/verify.py \
      --reference-artifacts /local/reference/artifacts \
      --candidate-artifacts /local/rebuild/artifacts \
      --reference-packages /local/reference/packages \
      --candidate-packages /local/rebuild/packages \
      --output /local/check/comparison.json

This uses only Python's standard library. It compares complete files and reconstructs load images/application hashes from ELF and APDU bytes without Ledger parser imports. Failure or any mismatch returns nonzero. Omit both package arguments for an explicitly labeled ELF-only comparison. --devices and --networks can select a subset.

## Fresh offline rebuild using the existing builder

Requires the **already-installed builder layout** described in CANONICAL-RECIPE.md and builder-layout.json. There is no install, download, network, device or container-provisioning fallback. Select a new output directory outside the source checkout:

    python3 tools/build-reproducibility/replay.py \
      --source /local/ledgerPRL \
      --sdk-source /local/pinned-sdk-checkouts \
      --cargo-cache /local/populated-cargo-home \
      --output /local/new-private-rebuild \
      --reference-artifacts /local/reference/artifacts \
      --reference-packages /local/reference/packages

--sdk-source contains ledger-device-rust-sdk and ledger-secure-sdk; it defaults to SOURCE/apps/ledger/vendor. --cargo-cache defaults to /tmp/pearl-cargo. Only bin and registry are copied; credentials are not copied. --commit selects an existing local revision (default HEAD); there is no fetch. --packaging-python can select an already-installed environment with the pinned packaging libraries. A smoke replay can add --devices nanosplus --networks mainnet.

The script clones with --no-hardlinks, copies SDKs and the cache, starts with no native targets, verifies source manifests, then builds/packages inside bubblewrap with the outer filesystem read-only. The input checkout and reference payloads are never output destinations. A minimal sandbox /dev has no Ledger USB passthrough. Compiler outputs and full logs go only to the caller's new private output directory. Existing output directories are refused; failed outputs are retained for diagnosis.

## Boundaries

This evidence demonstrates byte reproduction on the measured builder, not portability across arbitrary toolchain/OS installations, new runtime qualification, hardware support or vendor approval. For exact existing bytes, do not change the canonical logical root or enable experimental remapping flags. Future environment/profile changes need complete provenance and requalification.
