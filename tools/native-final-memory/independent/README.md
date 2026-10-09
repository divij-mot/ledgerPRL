# Independent instrumented-memory evidence audit

## Result and scope

The actual retained packet, five separately instrumented ELFs, recorded source bindings, and original tested ELF snapshots were consistent in this review. Evidence-tooling defects were found and fixed: optimized Python previously skipped all assertions, and several declared metadata/inventory/count relationships were unchecked. The hardened packet passed all 30 portable controls.

This is a read-only evidence and checker audit, not a new runtime qualification. No firmware build, emulator replay, installation, network request, physical device, or real wallet was used. Negative mutations occurred only in disposable copies.

## Portable replay

Run with ordinary Python 3 and Bash. Supply the frozen repository checkout, retained evidence directory, and directory containing all five instrumented ELFs:

```sh
python3 tools/native-final-memory/independent/run-controls.py \
  --source "$SOURCE" \
  --evidence "$EVIDENCE" \
  --artifacts "$ARTIFACTS" \
  --results "$RESULTS"
```

The results destination's parent must already exist. Temporary controls are removed automatically. The runner does not apply patches or rebuild anything. All paths are arguments; reports replace machine-specific paths with placeholders. The source and actual ELF files are read, never altered.

## Checks and defect reproduction

`control-results.json` contains all 30 outcomes plus SHA256 bindings for the reviewed checker/replay code, compact evidence, final crypto source, and actual ELFs. `original-control-summary.json` records original behavior and binds it to the original verifier hash.

Before hardening, Python `-O` and `-OO` printed a passing verdict even for a failed report, missing model, and corrupted ELF. Ordinary Python also accepted changed declared SDK pins/features or aggregate signature counts and a removed crypto input-inventory entry. These were checker weaknesses, not evidence that the genuine retained measurements were wrong.

The fixes explicitly reject `-O`, `-OO`, and inherited `PYTHONOPTIMIZE` before reporting success or replay-preparation writes. They reconcile complete source inventories, exact declared pins/features, retained patch/build-script hashes, raw model/runtime/source declarations, and session/signature counts. Resolved output paths inside the source checkout are rejected, including symlink aliases.

The 30 controls cover the genuine five-ELF baseline; optimization flags/environment; failed or missing-model reports; altered pins/features/counts/inventories; changed retained script, raw memory/stability, build log, patch, and ELF bytes; rehashed but inconsistent raw counts/model/patch/harness/session data; optimized preparation/wrapper rejection; existing-output preservation; direct/symlink-aliased output containment; and Bash syntax.

## Independent retained-artifact checks

`independent-bindings.json` records checks made against the original retained run:

- All 60 copied inputs matched both final source and mirror. All 24 native source entries matched a fresh source snapshot. Crypto SHA256 is `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.
- Parent and mirror SDK pins and tracked bytes agreed: 201 Rust SDK files and 1,898 secure SDK files, without shared file inodes or symlinks. Parent before/after/current tracked diffs agreed.
- Exactly two tracked SDK files contained instrumentation changes. Applying the retained instrumentation patch to disposable release-file copies reproduced both exact instrumented hashes.
- Each retained instrumented ELF matched both actual memory/stability tested snapshots. Independent symbol inspection confirmed every reported `_estack - _stack` span.
- Raw model, public test seed, recorded Speculos/compiler/features/patches, and stability harness/driver/fixture/lock hashes agreed.
- Five 20-session stability reports reconcile to 230 verified complete/partial signature returns. The audited separate memory harness records three successful 16-input flows per model; the SDK checks every signature before successful completion. This supports 240 additional signatures in those existing runs, not a fresh signature replay in this audit.

The portable controls recheck the retained packet and supplied ELFs. They do not require the original full vendor mirrors or per-run snapshots; the deeper mirror/snapshot comparisons above are historical audit observations.

## Memory interpretation and limits

Stack paint measures changed bytes in the application-stack region since reset. Untouched reserved slots, coincidental paint bytes, pre-reset startup, OS/syscall stack, and interrupt contexts are not a formal worst-case bound. Instrumentation and measurement calls also affect code layout and stack use. Linker-symbol spans describe these instrumented ELFs, not physical-device available-memory guarantees.

Allocator instrumentation samples the existing allocator's aligned occupancy after allocations, under the SDK's single-context/no-concurrency assumption. This is not largest-free-block, worst-case fragmentation, total static RAM, or OS allocation. A stable idle baseline at three checkpoints over 20 sessions is bounded evidence, not proof of no possible leak.

The highest retained allocator observation is 1,836 / 8,192 B. The smallest observed app-stack remainder is Nano X's 6,836 B. Neither number is an established physical-device or worst-case safety margin. Human security review and physical latest-firmware validation remain separate gates.

Hash relationships establish retained consistency, not cryptographic authenticity of the reports or a derivation of ELF bytes from source. Installed runtime/dependency bytes were not independently rebuilt. This compact packet does not retain every signature byte for re-verification.

Actual SDK copies were isolated. Node dependencies are shared through a symlink and reused without writes by the runner; this is not an OS-enforced read-only sandbox.
