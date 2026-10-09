# Independent device-session cleanup review

Scope: actual companion `main.ts`, PSBT adapter session state and DMK transport teardown. Host-only synthetic verification with frozen public fixtures. The test bundle substitutes DOM/storage/transport boundaries explicitly; it executes the actual signing, receive-verification, reservation, recovery and rendering code. This is not browser, native firmware, emulator or physical-device qualification.

## Why this failure is real

`LedgerBitcoinPrlClient.run()` terminally fails the client and closes its transport on a protocol/transport/cancellation error. `signPrepared()` deliberately returns complete independently verified signed bytes with `completionWarning` if the final ACK is missing/rejected after signatures exist. The companion must retain those exact bytes and reservations. Because this is a fulfilled promise, a cleanup confined to a catch block cannot invalidate session-scoped receive verification.

DMK logical transport cleanup does not itself call the physical-disconnect callback, so the companion can retain a failed client object. Existing ready-state checks correctly show Watch only and disable new signing/verification, but the receive label and Copy button depended on the separate `verifiedReceive` value.

## Independently found cleanup edge cases

1. Moving failed-session invalidation to `run()` finally fixes completed warning outcomes, while preserving valid verification on normal ready-session success.
2. Signed-storage failure can render a recovery warning before finally. A centralized failed-session guard in `render()` prevents that intermediate frame from claiming Verified on device.
3. Lost final ACK can reach finally without any new render. If the following journal refresh stalls, clearing only the in-memory value leaves the preceding verified label visible. The finalizer must render the failed-session cleanup before awaiting storage, with controls still busy.

The third case is captured in `stalled-ack-refresh-regression.log`. Exact signed bytes remain retained and Copy remains disabled even in that characterized failure; the residual concern is a misleading device-verification label.

## Test coverage

- Successful signing keeps valid same-session receive verification and saves the exact public-fixture transaction.
- Missing ACK, rejected ACK, unexpected completion payload and cancellation after final signatures terminally fail the session; exact signed bytes, txid and both reservations remain intact.
- Review rejection before signatures keeps the ambiguous signing record and locks, without inventing signed bytes.
- Durable signed-storage failure preserves the exact emergency recovery backup and original reservations.
- A stalled journal refresh after storage failure cannot retain a device-verified label.
- A stalled journal refresh after final ACK failure cannot retain a device-verified label.
- An unrelated host exception leaves a genuinely ready, verified session valid.
- Failed clients reject subsequent verify/sign requests without sending APDUs; completed failed UI shows Watch only / Connect Ledger, with Copy and Verify disabled.
- No broadcast endpoint is allowed by the fake fetch boundary.

## Commands

`node --import tsx --test tools/device-session-review/session-cleanup.test.ts`

`node node_modules/typescript/bin/tsc --noEmit -p apps/companion/tsconfig.json`

Final result and hashes are recorded below. No production source is edited by this independent reviewer. No install, live HTTP, browser, native build/execution, emulator, hardware, private-key operation or real transaction was performed.

## Final result

PASS: 10/10 independent host tests and companion TypeScript `--noEmit` check against the owner’s final source. The final change centralizes failed-session invalidation at render entry and triggers a render in `run()` finally before storage awaits, while controls remain busy. Successful ready sessions retain legitimate device verification. No additional production edits are recommended for this scoped issue.

Main source SHA-256: `ce0b26e6520f210bf57f633469da5ab1821f18e423926422ffc5c4568cce3292`

See `source-sha256.txt` for the inspected adapter, transport and test hashes; `session-cleanup.log` for final 10/10 results; `companion-typecheck.log` is empty with successful exit.

### Impact and limits

The observed bug concerned a stale historical device-address-verification label and, at the original completed warning boundary, the stale Copy gate. It did not demonstrate a wrong derived address, a wrong signature or loss of key custody. The extra intermediate/stalled cases kept Copy disabled while busy. Exact signed bytes, emergency backup bytes, transaction ID, both reserved inputs and saved receive recovery ranges were preserved in the tests. No automatic broadcast or repeat APDU was observed.

Mocks do not establish actual IndexedDB durability, real-browser scheduling/paint, physical disconnect behavior or device approval UX. Adapter and transport code semantics were inspected, but no real transport/device was exercised. The review does not claim a full security audit or native implementation qualification.
