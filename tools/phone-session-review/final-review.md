# Independent phone-session review — held candidate

Reviewed 2026-10-11. No additional blocker found in this bounded source and test review. The [physical incident and hardware hold](../gen5-reset-incident/README.md) remain unchanged. This reviewer inspected source, assertions and retained logs; no test execution, hardware action or production edit was performed by this reviewer.

## Finding and correction

The pinned official RPC client throws for a response ID absent from its current request table. Its message transport does not await the asynchronous handler, so a late old-session response can produce an unhandled rejection even though it cannot settle a new request. The new regression exposed this at the real official client / synthetic native-message boundary.

The correction tracks outgoing request IDs per connection through the public transport `send` method and admits each corresponding response once. Unknown/duplicate response IDs are discarded before SDK dispatch. IDs are registered before send, removed after a synchronous send failure, and cleared during disconnect. Existing origin/source checks remain; method-bearing host requests and notifications retain SDK dispatch. Current-ID results and errors still reach the official client. This adds no dependency or APDU implementation and does not alter signing, cleanup deadlines or the shared-session gate. It is an ownership filter, not general validation of malformed host responses.

## Assertions reviewed

The expanded **33-case transport suite** covers close-first and exchange-first settlement, late success/error, failed close and listener teardown, and a repeated old close after a new generation opens. Reconnect stays blocked until both old exchange and RPC close settle; uncertain cleanup remains quarantined. The actual official iOS-style message bridge test checks duplicate replies within a session, old-session success/error during a fresh request, and a valid current-ID error. These tests also assert no automatic retry or continuation.

The **six actual-PSBT-client schedules** use the existing frozen public endpoint. After one independently verified partial signature, cancellation, timeout or a modeled native error cannot admit the late final yield, persist a transaction, send an ACK or continue APDUs. Timeout quarantine survives late settlement. For complete verified transactions, deferred storage success, failure and timeout retain the exact transaction bytes/ID while a separate fresh session remains usable. Re-closing the old client does not close or send commands through that fresh session, which sends no signing command. These assertions establish no automatic APDU/signing continuation; they do not claim all old application callbacks are suppressed.

Final formatted sources ran successfully for these focused cases in `/private/tmp/pearl-phone-session-full-check-final.log`. That broader run had a separate payment-sequence wrapper timeout; a second run with an experimental concurrency limit reported hosted-UI and local-session-UI wrapper timeouts. The unchanged sequence script then passed 15/15 in isolation, and the two UI wrappers passed 2/2. The parent correlated host sleep with both failed runs: 18:47:02–18:53:00 within the 18:46:14–18:53:02 run, and 20:53:21–20:56:17 within the 20:52:09–20:56:59 run (local time). This is evidence of suspended execution during the timeout windows, not a blanket dismissal of timeout failures. The experimental test-concurrency flag was reverted; `package.json` has no current change. The final run used temporary sleep prevention with the original test scheduling; the parent confirmed exit status 0. Its log records **624 tests passed, zero failed**, completed typechecks/builds and a passed secret-pattern scan. Temporary sleep prevention ended afterward. These results preserve, rather than erase, the earlier failed runs and their sleep overlap. The earlier static fixture-import type error was corrected to the existing dynamic-URL import pattern without changing the endpoint.

## Limits and bindings

Tests execute the real host PSBT engine, Wallet API adapter and, where stated, official RPC client against synthetic endpoints/messages. No phone, BLE stack, native Ledger Wallet process or retail device firmware is executed. RPC close acknowledgement and exchange settlement do not prove physical link closure or cancellation of on-device review. Fixtures contain public data; no broadcast or owner wallet material is used. This campaign neither explains nor reproduces the reported reset and does not qualify hardware use or release promotion.

| Reviewed file | SHA-256 |
| --- | --- |
| `apps/companion/src/wallet-api.ts` | `b3b87f957deeefb713643d15c1b323939c4de9fe32719f555624f8547df7c250` |
| `apps/companion/test/wallet-api.test.ts` | `f42798321e4e7c503b93c60da1cdfae5054f5c1ebf157f6823dcc108076b059d` |
| `apps/companion/test/wallet-api-signing-faults.test.ts` | `a32016e54e4550fd63836dcad33c1b45ae8910638626d586641e73a175da7228` |
| `apps/companion/test/psbt-endpoint.mjs` | `2ccc78495302a4ae14c6699fdaec14e0892afa783363ff892b3f47ad66c5094b` |
| `node_modules/@ledgerhq/wallet-api-core/lib/JSONRPC/RpcNode.js` | `343e4086a5f49cef5250d3fd851592fd41882593d69fbbe64e9af0a10d8c6b6c` |
| `node_modules/@ledgerhq/wallet-api-core/lib/transports/WindowMessageTransport.js` | `776e35bacfbaf840f4742ecc6e0b5a88140e2ce33a7eba89665eb8331c1289bb` |

Final full-check log: `/private/tmp/pearl-phone-session-check-awake.log`, SHA-256 `078dc0de115ef36cd8d2ca369a626cc424bbe71e9755911cb681338d6584f1c7`. Exit status 0 was confirmed by the parent; this reviewer independently inspected the retained log and counts.
