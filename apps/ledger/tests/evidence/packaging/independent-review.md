# Independent review: offline Ledger packaging and preflight

Reviewed 9 October 2026, UTC. Scope: the new offline package generator, manifest, manual preflight workflow, documentary publication gates and related instructions. No firmware code was rebuilt by this review. No device was opened, authenticated, reset, flashed or loaded. No key, credential, CA, agreement, vendor submission, publication or permission change was made.

## Result

**The final offline package set passes independent byte-level replay and adversarial checks. Two verifier defects found during review were corrected and retested. This is software packaging validation, not a hardware-install approval, human security audit or Ledger publication-compliance result.**

Reviewed generator SHA256: `f6e5cedd5e2f2803a634140518beb652e939d771610a6e9a70bddd8b250110b0`.

The final package set is in `/workspace/shared/pearl-ledger-packaging/packages/final-v2/`. Every model has mainnet and simnet packages; Nano S Plus also has testnet, testnet2 and regtest: **13 packages total**. All final `.elf`, build-manifest, `.hex`, `.apdu` and application-hash files remain byte-identical to their first reviewed versions; the corrected generator is recorded in new package reports.

## What was independently established

- A separate **standard-library-only verifier**, importing no Ledger libraries or project parser, reconstructed the ARM ELF32 allocated flash image and every install APDU write. It checked target IDs, API 27, entry point, code/data/parameter boundaries, metadata, app names, version, icon presence, allowed curve/path TLV, command order, segment CRCs and exact terminal unsigned commit.
- All 13 reconstructed image hashes match the package reports and Ledger's canonical application hash. The ordinary file SHA256 and Ledger application hash are intentionally different. Example: Nano S Plus mainnet ELF SHA256 is `470b2edadffd7c73897ff09f6e8e3e15df675919acbf15801c5a2188f2a59ab3`; its application hash is `40a78ce2055a2a5c8622f1bc8310209eee354b43984965283b3c293e209739a2`.
- Implicit zero gaps are included correctly in the application hash: 128 bytes on Nano S Plus, 72 on Nano X, 144 on Stax and 456 on Flex/Gen5. No missing payload byte was mistaken for an allowed gap.
- Effective flags are exactly `0` on Nano S Plus and `0x200` on Nano X/Stax/Flex/Gen5. The latter is the reviewed SDK's settings privilege; the documentation discloses it and does not describe base Cargo `flags = "0"` as the effective flag set. Extra privilege bits are rejected.
- Permission TLV is exactly secp256k1 plus the two-element hardened prefix `86'/808276'` for mainnet or `86'/1'` for other networks. App names distinguish all five networks. Additional curves, wildcard/root derivation and altered prefixes are rejected.
- A fresh package was emitted under runtime hooks that refuse hardware-transport imports and Ledger private-key construction. It reproduced every artifact byte exactly. Code inspection also confirms `HexLoader` is called with a file-only sink and `secure=False`; upstream `loadApp` and `runScript` are not invoked.
- The generated command set contains only create-app, segment selection/data/flush/CRC and unsigned commit. It contains no delete-existing-app, signed commit, CA operation, OS update or extra command after commit.
- All report file checksums were independently recomputed. The complete source-key set and valid source digests are checked before and after packaging.

Full per-package hashes and parameters: `independent-install-matrix-final.json`. Independent verifier: `independent-install-replay.py`.

## Adversarial and concurrency checks

The isolated independent regression pass completed **27 checks** on the final generator. Coverage included changed flags/API/entry/sizes, altered loaded bytes, wrong model/network, extra curves, wildcard/path changes, duplicate metadata, forbidden deletion/CA/unknown operations, extended signed commit, repeated/early/missing commit and trailing bytes.

Two concurrent generators aimed at one fresh output directory produced exactly one complete verified winner and one refused overwrite. The winner's artifact bytes matched the reviewed package. Separately, changing the isolated live ELF or a covered source file after the snapshot caused packaging to fail without publishing a destination. All mutations were made only in copied review trees; the real source and frozen ELFs were untouched.

Evidence: `offline-install-regressions-final.json`, `review-install-regressions.py`, and the isolated workspace/log paths recorded in the JSON.

## Findings closed during review

1. **Duplicate ELF metadata accepted.** The original duplicate check compared a prefixed section name against stripped dictionary keys. A real ELF with a duplicate identical target-ID section was accepted. The generator now normalizes the name before checking. Identical and conflicting duplicates have artifact-independent unit tests; the independently mutated real ELF is rejected.
2. **Incomplete provenance map accepted.** Replacing a copied build manifest's source map with an empty object allowed packaging, silently removing source checks. The final generator requires the complete source-key contract and valid matching SHA256 values before and after emission. Empty, omitted, extra and malformed/mismatched digests now fail. Independent re-execution confirms the original empty-map counterexample is rejected.
3. **Documentary corrections.** Upstream Ragger's `contents:write` requirement is now disclosed separately from build/guidelines `contents:read`; all request additional action/PR write permissions. The SDK-mapping citation now points to the current official API table instead of a pinned README whose table predates API 27. Neither correction changes binaries.

Initial counterexample evidence is retained in `duplicate-metadata-repro.json` and `offline-install-regressions-initial.json`; the final results supersede their failed status.

## Manifest, workflow and authorization review

The root `ledger_app.toml` resolves `build_directory = "./apps/ledger"`, Rust and all five build targets through Ledger's real manifest parser. The manual workflow has only `workflow_dispatch`, repository `contents:read`, credential persistence disabled on checkout, and commit-pinned checkout/Python actions. It contains no release, device load, vendor submission or automatic push/PR trigger. The pinned Python action exists in the [official actions/setup-python repository](https://github.com/actions/setup-python/commit/ece7cb06caefa5fff74198d8649806c4678c61a1).

Official Ledger workflows remain explicitly **inactive/documentary**. Inspection of their pinned source confirms mutable builder/dependency behavior and broader write permissions, so the local preflight is correctly not presented as a substitute. The custom transport patch, settings flag and TypeScript functional-test integration remain vendor-review topics.

Docs explicitly reserve private-source disclosure, license choice, audit costs, legal acceptance, vendor submission and hardware/trust/OS actions for specific owner approval. No documentation grants those permissions. Nano X packages are marked non-retail-sideload and vendor-review-only. Development tooling is not presented as a way to bypass that restriction.

## Verification environment and reproducibility limits

- Verified source references: cargo-ledger `906d6963a9dfcbd19ad090b8501e26cd317ff988`; Rust boilerplate `0f857a78085678a26b332cf99128e22c0e5a6bde`; Ledger workflows `77dc9ecd7b4bb8d25346ca503ad2f603e62911b4`.
- Runtime review tools: Python 3.12.14; ledgerblue 0.1.58; ledgered 0.17.0; pyelftools 0.33; ARM GNU objcopy 2.44. Reports hash the actual loader/parser/hash modules; `offline-install-reviewed-hashes.json` also records the executable, reviewed source and evidence hashes.
- The Python requirements are a pinned-version snapshot, not a cross-platform wheel-hash lock. The Ubuntu hosted runner image is mutable. Same-environment artifact reproducibility was verified; universal bit-for-bit reproducibility was not.
- A separate, freshly created Python **3.12.14** virtual environment successfully installed the exact `packaging-requirements.txt`: all **37 required distributions** matched their pinned versions; only pip was additional, and `pip check` reported no broken requirements. The install fetched/built packages rather than inheriting the worker environment. `pyDes` and `python-u2flib-host` built successfully from their registry source distributions.
- In that clean environment, the exact workflow manifest check, configuration check and test command passed: **11 tests, zero skips** with local frozen ELFs available. On an isolated source-only copy with no native artifacts, the same commands passed with **10 passes and one explicit expected skip** for the optional real-ELF test. The workflow's final summary-generation script also ran successfully. The clean local execution is not a hosted GitHub Actions run.
- Clean-environment evidence: `clean-packaging-install.log`, `clean-packaging-python.log`, `clean-packaging-freeze.txt`, `clean-packaging-pip-check.log`, `clean-packaging-checks.log`, `clean-preflight-source-checks.log` and `clean-preflight-step-summary.md`. The exact environment/source-copy locations are recorded in the matching `*-path.txt` files.
- GitHub Actions itself and official Ledger enforcer/build/Ragger jobs were **not dispatched**. No physical OS compatibility, actual installation, secure-channel negotiation, device-side hash, watchdog/timing/side-channel behavior, vendor approval or professional human audit was established.

The package hashes bind reviewed local bytes; they are not a Ledger signature or an authenticated public-release attestation. Target identity is bound by ELF metadata/report verification; any future hardware loader must independently validate the actual target before replaying its APDUs. No hardware-loading instructions were executed or authorized here.
