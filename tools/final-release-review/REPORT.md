# Independent release-claims and evidence crosscheck

2026-10-09. Reviewed local `d1fd0d3` / private GitHub checkpoint `8db0cf0` and the subsequent targeted documentation/backup-export corrections. Native crypto SHA256: `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

## Outcome

No new uncorrected blocker was established in this bounded review. Three documentation inconsistencies were corrected by the parent and verified. No live secret, unsafe installation command, host private-key signer, or unwanted test/audit import into production was identified. This reviewer did not change production files, commit, push, install software on a Ledger, broadcast, or access user private keys.

This is an AI-assisted source/evidence review, not a human audit, physical-device qualification, or production-security guarantee.

## Corrections verified

Locations refer to the original `d1fd0d3` lines.

1. `docs/firmware.md:124` described the old void RNG wrapper. Corrected to checked `cx_get_random_bytes` before private-key construction, fail-closed returned errors, and separate nonreturning OS/EC-randomization limits. Matches `crypto.rs:195–200`.
2. `docs/firmware.md:11`, `apps/ledger/tests/evidence/README.md:9,18`, and `docs/e2e-evidence.md:19,33,44,81,83` called older source-bound artifacts “final/current/latest”. Those sections now identify historical checkpoints and link final-source requalification. Old artifact hashes and results are preserved.
3. `tools/compiled-cleanup-review/REPORT.md:90` still said the portable replay was pending. It now distinguishes initial packaging from the subsequent 25-artifact replay. Regenerated package checksums pass.

These are corrected release-documentation inconsistencies, not newly demonstrated runtime vulnerabilities.

## Independent underlying-output verification

`validate.py` checked the raw files rather than trusting the lead qualification summary:

- 25 distinct model/network ELF and manifest pairs. Exact bytes, SDK pins, complete 24-file native source map, and retained compiled-cleanup identities agree.
- 25 network smoke outputs: matching executed snapshots, account/network identity, source hashes, two public addresses and four recorded checks each. These are capability/account/address checks; they do not claim signing on every network.
- All 25 package inventories and their file hashes agree with the actual files. The pinned existing independent standard-library ELF/APDU verifier was freshly executed on each reference and canonical rebuilt package, 50 decodes total.
- All 25 canonical control ELFs, manifests, HEX/APDU/application-hash files and package reports are byte-equal to the reference outputs. Load-image hashes and sizes also agree with the separate rebuild report. This reviewer compared outputs and reran the decoder; it did not repeat compilation.
- 30 distinct simnet runtime suites, six per model: canonical smoke, warnings, faults, 16-input Pearl-node roundtrip, four-key parity node roundtrip, and release stability.
- 102 actual runtime ELF snapshots match the expected final502 simnet hashes. Every suite's before/after 39-file test/source inventory matches the pre-export-fix source snapshot.
- 77 passing fault cases and 220 passing node cases. The ten final node transactions contain 100 signatures in total; additional partial-export probes are not added to that total. All five four-input runs record all four internal/output-key parity combinations.
- 100 passing release stability records, 20 per model, with 230 recorded verified signatures. Counts were recalculated from individual records; these are not the older 500-session results. No instrumented-memory result is inferred from release stability.
- The underlying packaging-test log has 11 passing tests, no skip, and matches its report hash.

The retained result binds the exact lead and rebuild report hashes. Native runtime and cryptographic verification were not rerun here; recorded signatures are counted, not independently reverified by this script. A separate worker is performing the offline native-signature/Pearl check.

Six isolated validator controls passed: a complete replay with spaces in paths, changed crypto rejection, duplicate matrix rejection, underlying failed-case rejection even when its summary hash was rebound, incomplete-but-matching test-inventory rejection, and changed canonical APDU-byte rejection. Inputs were untouched.

## Provenance and secret boundaries

GitHub metadata independently confirmed `divij-mot/ledgerPRL` is private. The actual remote Git tree for `8db0cf0ee252616306d30660d5220f54b2c8d7c0` equals local `d1fd0d38069c09b871b836377812e2fc4bef8b3d`: `45bda743086d879d12e56aa0d7c014c9cbf7e4dd`. This used Git tree metadata, not only a message claim. Earlier local checkpoint tree values also matched; this review did not re-fetch all historical remote pairs.

The tracked-file scanner and a broader credential-pattern/manual review found no live credential. Public BIP32 vector-one seeds, synthetic fixture keys, stub/negative-test RPC credentials and compiled-function hashes were correctly classified as public test material. No candidate values are included in this portable package. Pattern scanning is not proof of absence; all Git history and every screenshot's pixels were not exhaustively reviewed.

Default build/test scripts do not load hardware. Offline packaging uses a file-only sink, rejects expanded permissions and dangerous manager commands, and does not import hardware transport. Development app loading, OS updates/reset risk, retail Nano X restrictions, actual device/API checks, effective settings permission, owner approval, licensing, vendor distribution and external audit remain clearly separated. No blanket reproducibility or Bitcoin-app parity claim is justified.

Tests and audit tools are outside production entry points. No concrete unnecessary production feature was identified that warranted removing useful code merely to reduce size.

## Subsequent host-only export fix

After runtime verification finished, the parent changed only full-backup serialization in `packages/wallet/src/recovery.ts`: compact JSON and omission of `lastError`, alongside the pre-existing omission of local `signingAttempt` authority. No recovery state, reservations, exact transaction/bundle/txid, path indexes or archive fields are discarded. No production code reads `lastError` as authorization or recovery policy.

The conservative 2,000-record canonical envelope is 16,588,384 bytes, leaving 188,832 bytes below the unchanged 16 MiB cap. The bounds account for fixed-ASCII field alphabets, maximum IDs/timestamps/height/path fields, 1,507-byte bundles, 16 inputs, exact single-64-byte witnesses and 3,620-character signed transaction hex. The synthetic envelope is explicitly not a valid spendable journal; separate real-fixture tests cover field preservation and old-format import. The import validator, signature/byte checks, uncertain reservations and archive requalification are unchanged.

Independent focused execution passed the new two capacity tests plus 18 existing recovery tests, 20/20. This does not establish a loaded browser's storage behavior or independently repeat the full 2,000-record cryptographic import campaign.

The runtime evidence remains bound to the previous host source. `validate.py` intentionally rejects the newer `recovery.ts`; use the recorded pre-fix source snapshot for replay. Native final502 artifacts are unchanged. The separate final full host check must cover the later export edit.

## Limits still required for release

- Canonical-path byte reproduction does not establish arbitrary-prefix/toolchain reproducibility. Preserve the separate path-dependence finding and builder constraints.
- Final-source instrumented resource results were ongoing during this crosscheck and are not covered here.
- Physical devices/screens/OS/installation, real USB/HID/disconnect behavior, physical app/OS memory erasure and side-channel behavior remain unverified.
- Loaded-account browser imports, real IndexedDB cross-tab/crash/reload behavior, supported browser/OS combinations, independent human audit, Ledger functional/distribution approval and licensing remain gates.
- Software success does not authorize funds use, installation, security changes, submission or private-source sharing.
