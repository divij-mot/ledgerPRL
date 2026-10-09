# Real-time timeout qualification and portable replay

PASS. The final hardened portable harness was fully replayed once across all five simnet development models. Every pending-state timeout occurred after exactly **1,200 normal Speculos ticker packets**, with native explicit exit. No native defect found.

Tested harness SHA256: `320a5a038ff623167e6cefc284101481508b7882d794726ef210570e8c26c7d9`.

## Separate final portability replay: elapsed seconds

| Model | Incomplete Receiving | Unapproved final review | Approved, partly exported | Idle seconds / ticks |
|---|---:|---:|---:|---:|
| nanosp | 120.194 | 120.613 | 120.180 | 125.007 / 1247 |
| nanox | 120.196 | 120.649 | 120.185 | 125.006 / 1248 |
| stax | 120.142 | 120.747 | 120.165 | 125.062 / 1249 |
| flex | 120.127 | 120.673 | 120.157 | 125.064 / 1249 |
| apex_p | 120.237 | 120.958 | 120.168 | 125.035 / 1247 |

These are genuine elapsed-time waits in untouched official Speculos 0.27.1. No ticker API, timer acceleration or injected ticks were used. This differs from `native-faults.ts`, which pauses and single-steps its timeout test. The original qualification and this full portability replay are recorded separately; they exercise the same five-model × three-pending-state matrix and five idle/recovery controls, rather than expanding unique coverage.

Timing starts at the last APPEND response (20/289 bytes), the host timestamp immediately before sending REVIEW, or FETCH index 0 response. Each ends at host observation of native `exit called (1)`. Review includes UI navigation without final approval. Partial export leaves signature 1 unexported after verifying signature 0. Review expiry returns `6986`; the other pending states release no later response.

All 60 stale-state probes in this replay rejected both fetch indices, old REVIEW and old APPEND with `6986`. Fresh transactions required new explicit emulated button/hold approval and returned two independently verified BIP340 signatures. Five ordinary-idle controls survived 125 seconds and more than 1,200 ticks, retained identical home text, and answered INFO successfully.

## Hardened preflight and controls

The harness uses `scripts/ledger-build-manifest.py snapshot` to require exact, nonempty source-map equality, including missing/extra/hash-changed entries. It holds each existing per-device build lock while copying, requires the copied ELF SHA256 to match `elfSha256`, compares copied manifest bytes with the captured source manifest, and rechecks the source manifest and exact source snapshot after copy. Output/snapshots are fresh and never overwritten.

Twelve negative/positive preflight controls passed. They cover empty/missing/extra/changed source maps, an empty snapshot, source ELF and target/network mismatches, successful exact-copy verification, empty-source rejection before copying, and simulated copied-ELF/copied-manifest corruption. Controls invoke the exact tested functions against isolated fixtures; no emulator or production mutation occurs. Per-case/model port allocation avoids TCP TIME_WAIT reuse.

## Retained files

- `native-wallclock.py`: fully replayed final harness, exact hash above.
- `replay-results.json` / `replay-provenance.json`: replay measurements, source/ELF/tool identities, exact-copy checks and underlying bounded-evidence digests.
- `original-results.json` / `original-provenance.json`: earlier qualification, preserved separately with its original driver history and earlier portability limitation. That earlier limitation is resolved by this replay.
- `test-preflight.py`, `preflight-controls.json`, `preflight-controls.log`: reusable controls and all 12 passed outcomes.
- `validate-replay.py`: independent reconciliation of original log ticker lines, ticker arrays, APDU transcripts, native exits, copied identities, all stale-state probes and idle screens.
- `tested-hashes.json`, `final-integrity.json`, `SHA256SUMS`: tested artifacts and unchanged source/tool/ELF evidence; all used listeners closed.

Run with the Python from the installed official Speculos 0.27.1 environment:

`python native-wallclock.py --repo /path/to/ledgerPRL --output /path/to/NEW_RUN --qemu-dir /path/to/existing/qemu/bin --base-port 5401`

Use a free 40-port block; omit `--qemu-dir` if `qemu-arm-static` is already on PATH. Optional `--models nanosp` narrows the matrix. Controls: `python test-preflight.py --repo /path/to/ledgerPRL --output /path/to/NEW_CONTROLS`. Validation: `python validate-replay.py --run /path/to/RUN --harness native-wallclock.py --output /path/to/NEW_SUMMARY.json`.

Earlier setup issues were exclusively test-driver errors: wrong-endian BEGIN correctly rejected before a session, a response-boundary assertion including the successful progress response, and bind preflight encountering TIME_WAIT. Original raw evidence was independently revalidated; no native failure was inferred from these mistakes. The final complete replay has no failed cases.

This bundle excludes binaries, large traces, source copies and credentials. Tests used only the public BIP32 vector-one seed and worthless fixture transactions. There were no production edits, native rebuilds, hardware, user keys, funds, mainnet broadcasts or vendor actions. Emulator timing/teardown does not establish physical Ledger/OS timing or RAM-clearing behavior; cold idle before any command and every scheduling race remain outside this matrix.
