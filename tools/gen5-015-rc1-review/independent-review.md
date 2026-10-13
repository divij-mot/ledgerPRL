# Independent review: Pearl 0.1.5-rc1 preparation

Reviewed 2026-10-12. No additional preparation blocker was found in the version delta, compiled identity or retained simulator results. This supports presenting the exact candidate for the owner's installation decision; it does not authorize a loader operation, promote a release or establish that the [reported device incident](../gen5-reset-incident/README.md) is resolved. The owner has separately authorized limited testing, including owner-controlled payments. Historical hold records remain unchanged; public-release qualification remains open.

## Candidate and provenance

Relative to `b0ad28c4db61096b72dbad18fd0b45847e62667f`, the firmware delta changes only Makefile version metadata from `0.1.4` to `0.1.5-rc1`. Name, C code, permissions, transport logic and dependencies are unchanged. The nine-character version plus NUL fits the pinned SDK's 16-byte field. The review guard remains the previously reviewed `3616650f…` candidate.

I independently checked all 167 build-manifest source entries against the private build tree and checkout, compared regular source files against the base commit, and separately matched the glyph symlink's resolved content. Only Makefile differs. Source-before/source-after snapshots are identical. ELF, HEX and manifest digests match the preparation metadata. Read-only ELF parsing confirms **Pearl 0.1.5-rc1**, Gen5 `apex_p`, target `0x33400004`, API27, SDK `6709cd2b…` and flags `0x240`. Metadata reports 512 bytes of application data and 110 bytes of install parameters. `release.json` remains the historical 0.1.4 manifest; it has not been promoted to this prerelease.

## Simulator evidence reviewed

The normal pilot passes SDK B001 name/version identification, public-account export, Receive verification and two independently verified transaction signatures. Its private test-only delta adds the identity assertion; existing pilot assertions are retained. Six focused cases pass: account nested keypath, replacement transaction approve, replacement transaction deny, Receive cancel then a new index, QR nested busy, and QR unfiltered busy then explicit cancellation. All seven retained tested ELF snapshots independently hash to the exact candidate below. Focused harness/helper/emulator/injector bytes match the checkout.

Busy-demultiplexing cases deliberately filter a response to keep the original test waiter alive; they establish original-command binding, not production host recovery. The unfiltered case requires explicit denial before a fresh Receive. Same-process fresh review survives the old status timer and requires approval. This campaign executes Speculos with the public test fixture; it does not execute a phone BLE stack, retail OS recovery or a physical reset. Prior broader campaigns are historical evidence, not newly rerun RC1 coverage.

This reviewer performed source/artifact/result inspection only: no builds, test execution, hardware commands, signing or broadcasting. Native preparation reports install full hash `993dd5edc4dc8eeb0f89797909b3521b55933d2fa1b12dee7dab488966d87576`; the ELF/HEX bytes and compiled identity were independently verified here, while that loader-format hash calculation remains attributed to native preparation.

## Seven-day test-wallet acceptance criteria

Use one frozen build and record model, OS, host app/version, date, action and observed result. Keep addresses, balances, recipients and transaction identifiers out of public reports. The owner chooses all payment amounts/destinations and manually approves signing and broadcast. A successful retry does not erase an earlier failure.

| Stage | Evidence required |
| --- | --- |
| Day 1: identity and USB | Exact installed identity/hash readback; version metadata; public-account rejection and approval; normal return to app home. No payment is needed for this checkpoint. |
| Day 2: non-QR Receive | On-device address matches the app, rejection cannot count as verification, and a subsequent explicit verification succeeds. Restored account and next-address behavior remain consistent. |
| Day 3: owner-chosen payment | Reject first and verify the appropriate unsigned reservation is released; then explicitly approve a chosen test payment. Device destination/amount/fee match intent; saved bytes, broadcast status and recipient-confirmed receipt reconcile. Unknown or complete signed outcomes remain recoverable, never silently discarded. |
| Day 4: ordinary reconnect | Disconnect only while idle, reconnect and restart the app normally. No automatic signature/broadcast; no stale result or cleanup changes a new session. Known unresolved-cleanup errors follow the documented reopen procedure. |
| Day 5: phone and background recovery | Normal BLE connection, Receive and background/foreground transitions preserve account identity and transaction records. Resuming requires fresh user action where appropriate and does not repeat a payment. |
| Day 6: QR checkpoint | After initial checks and a separate go/no-go review of the unresolved incident path, open QR and use ordinary Close; textual review remains responsive and still requires explicit approval/rejection. Do not combine this with induced disconnect, forced power-hold or reset reproduction. |
| Day 7: reconciliation | Repeat representative normal flows on the same frozen image. Every payment/reservation has an explained state; balances/history reconcile with chain evidence and independently observed destination receipt. No unexplained anomalies remain. |

Any freeze, unexpected app exit/reset, wrong account/address/payment detail, unintended approval/broadcast or unexplained persistent reservation is a stop-and-record failure. Do not force a power-hold experiment to continue the plan. Missed or failed checkpoints extend testing; seven elapsed days are not a pass criterion. Passing documents reliability only for the tested setup and schedules. **Independent professional application/security review and native-OS incident review remain gates before recommending general wallet use or public release.** Testing does not prove reset risk absent or transfer upstream Bitcoin's qualification to Pearl.

## Reviewed hashes

Raw evidence is retained under `/private/tmp/pearl-015-rc1-urie0i2m`.

| File | SHA-256 |
| --- | --- |
| `Makefile` | `7ed3fb66f0e39c938de04cf579c10585e00f55c5d840ad718da3d58b9a772175` |
| `prl_review_io.c` | `3616650ffa71a92e6131c20e2e192ebbefb6b1fb4d027bcdf3210f2cf5317aad` |
| `app.elf` | `e86e753785ae9575185b070c35ecc8c42ce43086557af2cd43daf967b1e62b79` |
| `app.hex` | `cd280d8f757331f8a5d74a6611500c021d23fd926b2cbaea8611db4a925f1d50` |
| `build manifest` | `94cccd1e4f048fedde0f32fce2414c0d3ef130175706a1dff39cc6e2e70ffa14` |
| `metadata.json` | `fc509e3684bf49abb93978cdfa3e24d9fca1ad774bf100439a823900ba4d9fd4` |
| `normal/result.json` | `554d4dc395a80409c24a512f8f77201aeda2ccc87ad3fde4a37e913509bef7de` |
| `parity/result.json` | `1c6629f03eac1c1344922f6e2606aecfe31dbd3d9c0b28efaa778254e4830a41` |
| `private normal pilot` | `133d5026b79fa5f2476ede0eb6b7aa383c58eeb1da2c13720f8c8df2d8b3c5ac` |

Final native aggregate: `qualification.json`, SHA-256 `4d02747ee9dfab91bd6a23106429bebdc2364d452c36ee21cfbecbccc774dc25`. Its test-source graph, private/tracked pilot distinction and normal/identity/parity result bindings were independently checked against retained files.
