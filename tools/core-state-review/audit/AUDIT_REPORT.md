# Core-state harness audit

Reviewed hardened source: `c91d2246ce829a32e5507b052273f4465e34cf8ec77dc460d89306697e872e18`.

## Conclusion

The independent parser/state oracle provides substantive finite testing. Targeted mutation testing exposed five missed original cases, now detected by hardened v2: rejection status changed to success, incorrect recipient and change review accessors, incorrect public account confirmation data, and an incorrect address-confirmation path. No production defect was demonstrated; only isolated copies were intentionally broken.

Across 15 separate mutations, the original harness detected 8 and missed 7. Hardened v2 detects all 13 selected in-scope mutations. Both harness baselines independently reproduce the exact 3,256,677-command directed/small-walk campaign. These repeated executions are separate observations, not additional unique cases or numbers to add to the original campaign.

The positive controls exercise missing approval, ignored signing failure, live state after errors, bypassed input/change ownership, invalid signature-fetch order, wrong signature slot, and skipped commitment checking. Hardened assertions also independently check all callback error statuses and the actual review/confirmation accessor values.

## Explicit limits

The constant-sighash and omitted-zeroization controls survive this state harness, as expected. The signature tokens are public mock values; its digest comparison forwards to the same underlying production function. Separately rerun existing Rust BIP341 differential/fixture tests pass four tests normally and fail three with a constant digest. Physical UI, native SDK behavior, hardware isolation, real signing, and physical erasure are not established by this audit.

## Coverage and provenance

Original loop counts reconcile: 327,680 BEGIN-length cases; 30,720 opcode/state/body combinations; 19,230 upload boundaries; 6,370 callback fault cases; 78,000 individual bit mutations. The five archived included logs total 85,599,171 APDU commands. The original source hashes match the snapshot, recorded Git commit, and checked live core; locked dependency checksums also match. This audit independently replayed the directed/small-walk campaign, not all four large walk seeds.

Portable negative controls refuse modified/extra source, redirected dependency manifests, changed lockfiles, unexpected build scripts, and source symlinks. The runner captures hash-verified live bytes before copying, applies mutations only in a temporary workspace, and checks Cargo resolves the isolated core. This is source provenance within a trusted build environment, not a supply-chain attestation.

## Evidence and reproduction

Use [README.md](README.md) for portable commands. [Original results](results/original/mutations-summary.json), [hardened results](results/hardened-v2/mutations-summary.json), [source/count reconciliation](results/provenance-and-counts.json), and [separate digest controls](results/digest-control-summary.json) remain distinct. Exact patches are in `patches/`; fresh run logs are never written over archived results.
