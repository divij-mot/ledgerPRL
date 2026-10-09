# Isolated path-remapping experiments (not a production proposal)

## Recommendation

Keep a canonical logical build root inside an isolated namespace/container for the already-qualified bytes. Do not adopt the tested remapping flags as a reproducibility fix: the pilots did not achieve equal full ELF or load-image bytes across two checkout paths. No production scripts, SDK sources, manifests, or qualified reference artifacts were modified.

## Scope and setup

Both private clones use source commit e36dc35abcd47277a491d5bc4155a576e0ff2855 and the same copied pinned SDKs and installed toolchain as the successful canonical-path controls. Test target is Nano S Plus/mainnet. Distinct logical roots:

- /workspace/shared/prl-build-repro/remap-a
- /workspace/shared/prl-build-repro/different-prefix/remap-b-longer

The initial pilot began with empty target directories. All builds ran offline inside the read-only outer-filesystem sandbox. These are experimental firmware images and are not runtime-qualified releases.

## Configurations tested

1. Explicit Rust and C remapping (remap-pilot.sh):
   RUSTFLAGS="--remap-path-prefix=$ROOT=/usr/src/pearl-ledger --remap-path-prefix=/tmp/pearl-cargo=/usr/local/cargo"
   CFLAGS="-ffile-prefix-map=$ROOT=/usr/src/pearl-ledger -fdebug-prefix-map=$ROOT=/usr/src/pearl-ledger"

2. Identical flag values in both builds (remap-fixedflags-pilot.sh): include both source-root prefix mappings in RUSTFLAGS and CFLAGS, with exactly the same strings for A and B. This controls for differences in the literal configured flag strings. It produced the same per-root outputs as pilot 1, with different outputs across roots.

3. Cargo root-directory normalization plus pilot 1 (remap-rootdir-pilot.sh):
   CARGO_UNSTABLE_ROOT_DIR=true
   CARGO_BUILD_ROOT_DIR=../..
   The installed nightly Cargo recognizes this configuration. It changed the outputs but still did not make the two roots byte-identical.

The C SDK build uses the cc crate and its target cflags include -g0. The tests used -ffile-prefix-map (covering C file/debug path rewriting) plus explicit -fdebug-prefix-map. No stripping or ELF post-processing was used. Rust runtime source-path strings in allocated .rodata were normalized, yet Rust crate disambiguators and code/layout bytes still differed. The test proves these configurations are insufficient; it does not prove every possible Rust/Cargo remapping approach is impossible.

## Results

- Pilot 1 A ELF: 1370e922ca8bf8f7e8934eb004712b3b5ece5964b1d26dcdebe833a6e37cfe72
- Pilot 1 B ELF: e26222919afb5f1ab3ae9758eaf4b0f7f1fde6024db61e2aa2cb0d981175a5a6
- Pilot 1 A app hash: c714b3a0baacd65432b0617796a838b2435a07e78923d69886b4b0cf3b1a5aa3
- Pilot 1 B app hash: c781ef06c4dbd1754243633d6ca393d1227984514dbb3f8d5a58dbeef3ec3e72
- Pilot 2: same A/B ELF and application hashes as pilot 1; still unequal across roots.
- Pilot 3 A ELF: 43a6f88070c23c7fd102384b2480e2f5f454295d93c5474f7d9435d9c5ccf2e6
- Pilot 3 B ELF: 5df43a3d62b251b5b50cd969f020ea9ac077c03e71cdf869682716f12ae9e7e6
- Pilot 3 also fails load-image/application-hash equality.

See evidence/remap-pilot-comparison.json, evidence/remap-fixedflags-comparison.json and evidence/remap-rootdir-comparison.json for load-image hashes, application hashes, embedded paths and changed sections. Experimental images, their manifests, original pilot scripts and complete compiler logs are retained in the external archive identified by external-artifacts.json; they are deliberately not included in this compact folder. The exact flag configurations are retained above.

## Release implication

Changing path policy changes firmware bytes. A future normalization design needs a new reviewed build/provenance policy, reproducibility across paths and cache roots, and full runtime requalification. Current build-manifest.py records RUSTFLAGS and CFLAGS but does not record the additional Cargo root-dir/profile configuration tested here; accepting such controls would also require capturing them in provenance or enforcing a clean allowlisted build environment. This experiment stops here because the canonical-path approach already preserves the qualified bytes and is substantially smaller in scope.
