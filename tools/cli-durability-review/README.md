# Independent CLI durable-recovery review

Reviewed 2026-10-10, host-only. This review changes no production code.

## Finding and correction

The original `writeReserved` truncated the sole durable `pearl-cli-signing-uncertain` file before writing a verified signed result. ENOSPC or interruption immediately after truncation could erase both intent and signed bytes; stderr recovery does not survive SIGKILL or prove durable storage. The separate original reproduction is in `../host-gap-triage/`.

The reviewed correction reserves `<output>.intent.json` with `wx` and mode `0600`, syncs the new directory entry, writes and syncs the complete canonical intent before the first APDU, and never truncates, replaces, or removes that sidecar. The existing output descriptor is retained for the signed JSON. The adapter awaits that descriptor's complete write and fsync before the final continuation ACK. Signed-output failure leaves the independently parseable intent in place and emits exact signed recovery bytes through `VerifiedSigningResultError` handling.

**Review result:** The immutable-sidecar correction closes the reproduced sole-intent destruction gap without weakening descriptor-only updates or exclusive final-component creation. No new blocking defect was found in the reviewed scope.

## Why this minimal design

- **Immutable adjacent sidecar:** Preserves the existing CLI output format and exclusively created descriptor. Requires reserving, flushing, retaining, documenting and closing a second file. A collision aborts before signing; neither file is automatically cleaned up.
- **Plain atomic rename over output:** A rename would protect readers from partial JSON, but it could replace an unrelated file installed at the output pathname after reservation. Checking the inode before rename does not remove that race. Ordinary portable Node filesystem APIs do not supply an atomic compare-and-replace of the reserved inode. This would weaken the current no-overwrite guarantee.
- **New staged signed file with no-clobber publication or append-only record format:** Potential future designs, but both change the output lifecycle or recovery format and need broader review. They are unnecessary to close this narrow defect.

## Independent verification

`durability.test.ts` compiles the actual CLI to memory with installed esbuild, uses the actual PSBT adapter and independent signature verifier, supplies frozen public signatures through a synthetic in-memory APDU transport, and exercises real FileHandles in isolated private temporary directories. It neither generates signatures nor creates a network endpoint. Write/fsync fault injection observes the boundary around real filesystem operations.

The 26 tests passed on Linux, Node 24.19.0:

- Complete pre-sign immutable sidecar, mode `0600`, both new directory entries synced before the first APDU
- Sidecar initial write failure, sidecar initial fsync failure, first and second directory-fsync failures: no APDU
- Initial output marker write/fsync failure after the sidecar: no APDU
- Signed output ENOSPC before any bytes, positive partial write followed by ENOSPC, zero-progress write, and fsync failure: original intent unchanged, exact recovery bytes exposed, no final ACK or success report
- Repeated short positive writes: complete exact signed transaction and successful fsync before ACK
- Cancellation before signing: intent retained, no signatures or continuation ACK
- Cancellation upon final signature or during output persistence: persistence completes, no final ACK, acknowledgement warning
- Rejected and lost final ACK: exact signed output and immutable intent survive; acknowledgement warning
- Output pathname replacement after reservation: unrelated replacement preserved, signed bytes written only to this invocation's already-open inode
- Existing regular files, symlinks, dangling symlinks and directories at either output or sidecar: fail before APDUs and preserve unrelated contents
- SIGINT handlers do not leak from any exercised command

The separate owner's child-process SIGKILL regression supplements this matrix; it is not counted as an independent test here. See `../host-gap-triage/` for actual interrupted-child evidence.

## Exact source and commands

Reviewed `apps/cli/src/index.ts` SHA-256:

`556ed61699371f1696c265f00356ac30447e95f84ff181ab1206765bae26893c`

The implementation was an uncommitted diff over repository HEAD `75a1c6026bd3c8e485c1ac6588d9d78eb656bcb2` when tested. Root/owner controls integration and broader regression runs.

```sh
node --import tsx --test --test-reporter=tap tools/cli-durability-review/durability.test.ts
./node_modules/.bin/tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --allowImportingTsExtensions tools/cli-durability-review/durability.test.ts
```

Evidence: `sidecar-fault-matrix.tap`, `typecheck.log`, and `source-sha256.txt`. The standalone harness typecheck passes. The earlier 19-case preliminary sidecar run is `initial-sidecar-run.log`.

## Limits and operational requirements

- The sidecar is conservative reconciliation evidence. It is neither proof that signing failed nor a wallet journal, enforced input lock, or authorization to prepare a replacement payment.
- Failed signed-output writes can still leave empty or partial output JSON. That output must not be treated as a complete signed record without parsing and independent verification. Keep the immutable sidecar and any emitted exact signed bytes.
- Both files must remain in a trusted private parent directory whose path and entries are not externally modified. Exclusive `wx` rejects an existing **final component**, including a dangling symlink; it does not forbid symlinked ancestor directories, inode unlinks, external edits, or directory replacement. The descriptor prevents overwriting a substituted unrelated file, but does not guarantee the requested pathname continues to name the signed inode. The replacement-path test confirms this distinction.
- Mode `0600` and successful file/directory fsync are observed here on Linux. Real power-loss behavior, remote/unusual filesystems, Windows (where directory fsync is skipped), malicious local actors and privileged storage access are not qualified by these tests.
- Storage callback timeout retains conservative intent and exact typed result under the existing adapter contract; it does not cancel an already-running OS file write. This review did not add another 30-second timeout test.
- No native build, emulator, physical-device session, browser, live service, funds, broadcast, installation or secret handling occurred.

## Integration checkpoint

The 26-case independent matrix is imported by `apps/cli/test/durability-matrix.test.ts` into normal CLI CI; the owner’s three real-filesystem/SIGKILL regressions are imported separately. Together with six existing cases, the standard CLI suite passes **35 tests**. `standard-cli.tap` records that run.

A combined `npm run check` passed all workspace typechecks, **464 tests** (27 adapter, 64 optional Snap, 103 SDK, 99 wallet, 35 CLI, 136 companion), host builds and the tracked-file secret-pattern scan. `integrated-source.sha256` remained unchanged across that run. The website bundle remains `index-d0S-5XX6.js`; this CLI-only change does not alter the previously checked browser artifact. `full-check.log` retains output; `staged-secret-scan.log` records the later scan including newly staged evidence. Pattern scanning does not prove the absence of every possible secret.

These checks use synthetic public fixtures. They do not reopen native execution, prove crash durability on other operating systems, qualify hardware or establish release readiness. Exact published-commit CI is checked separately after upload.
