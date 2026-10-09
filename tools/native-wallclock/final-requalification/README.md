# Definitive final-source wall-clock qualification

PASS: all five simnet development models, source `crypto.rs` SHA256 `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

The unchanged hardened harness completed the entire matrix in one coordinated quiet run. This requalifies the existing five-model × three-pending-state matrix and five idle/recovery controls for the final lexical source; retries do not add unique coverage. Original compiled-wipe review is a separate prerequisite supplied by the root, not a claim derived from these runtime tests.

Harness SHA256: `320a5a038ff623167e6cefc284101481508b7882d794726ef210570e8c26c7d9`.

## Measured real elapsed seconds

| Model | Incomplete Receiving | Unapproved final review | Approved, partly exported | Idle seconds / ticks |
|---|---:|---:|---:|---:|
| nanosp | 120.214 | 120.590 | 120.183 | 125.005 / 1248 |
| nanox | 120.105 | 120.611 | 120.157 | 125.009 / 1248 |
| stax | 120.099 | 120.609 | 120.127 | 125.059 / 1249 |
| flex | 120.194 | 120.682 | 120.201 | 125.063 / 1249 |
| apex_p | 120.265 | 120.998 | 120.132 | 125.022 / 1248 |

All 15 pending states exited after exactly 1,200 normal Speculos ticker packets. No ticker API, injected/accelerated ticks, native rebuild or relaxed bound was used. This is distinct from the earlier native-faults test that paused and single-stepped tick delivery.

Receiving time starts at the last APPEND response (20/289 bytes), review time immediately before host REVIEW send, and partial-export time at FETCH index 0 response after independently verifying that signature. Review includes navigation to final approval without approving; partial export leaves signature 1 unexported. All timings end at host monotonic observation of native `exit called (1)`. Review returned `6986`; the other states emitted no later APDU response or signature.

All 60 stale-state probes rejected both fetch indices, old REVIEW and old APPEND with `6986`. Fresh transactions required new explicit button/hold approval and produced two independently verified BIP340 signatures. All five 125-second idle controls retained identical home text and working INFO after more than 1,200 ticks.

## Identity, cleanup and independent checks

Exact nonempty source-map equality, copied ELF SHA and copied manifest bytes were checked under per-device build locks. All five runtime copies match the lead's immutable, compiled-wipe-reviewed pilots. At completion, all 25 source/fixture inputs and runtime tool bytes were unchanged. The retained independent validator reconciled raw packet-log ticks against structured tick arrays, APDU transcripts, native exits, state-reuse probes and idle screens.

The owning execution session exited 0 after every emulator's terminate/wait cleanup. Expiry connection-refusal assertions ran inside the owning emulator context. Separate-exec socket/ps probes are not used as cleanup proof because their process/network visibility can differ.

## Earlier attempts, kept separate

- Rejected source 7245 attempt was canceled before any completed case and remains incomplete.
- First source 502 attempt observed correct 1,200-tick/6986/native-exit behavior, but synchronized multi-second delivery gaps caused review wall times 145.235–145.656s, failing the unchanged 145s bound. Exact external cause remains unestablished. No later stages ran.
- First quiet attempt passed Receiving, then its execution context disappeared during review around 19:10:53 UTC. It is environment-interrupted/incomplete.
- This second quiet attempt completed successfully. No failures were reclassified or bounds relaxed. `prior-attempts.json` retains the compact timing evidence and original evidence digests.

## Retained files and rerun

`results.json` has all final measurements and raw-evidence digests. `provenance.json`, `source-bindings.json`, `new-source-delta.json` and `end-integrity.json` bind sources, tools and binaries. `quiet-window.json` records the coordinated replay, and `SHA256SUMS` checks all retained files. No binaries, source copies or bulky traces are duplicated here.

Use the already-retained `tools/native-wallclock/native-wallclock.py` and `validate-replay.py`. Invoke the harness from the installed official Speculos 0.27.1 Python with `--repo REPO --output NEW_RUN --qemu-dir EXISTING_QEMU_DIR --base-port FREE_40_PORT_BLOCK`. The independent validator needs the original unsanitized run directory, matching harness and a fresh output JSON. Compact provenance intentionally stores portable filenames.

Only the public BIP32 vector-one seed and worthless simnet fixtures were used. No production edits, commits, hardware, user keys, funds, mainnet broadcast or vendor actions occurred. This establishes emulator timing and protocol recovery for the specified ELF hashes, not physical Ledger/OS timing, RAM-clearing behavior, or coverage of every scheduler/transport race.
