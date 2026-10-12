# Phone / Discover session failure tests

The [hardware incident hold](../gen5-reset-incident/README.md) remains in effect. This follow-up tests the actual host Wallet API adapter, official RPC client and PSBT engine against synthetic messages and a frozen public endpoint. No phone BLE stack, native Ledger Wallet process or physical device is used.

## Defect found and fixed

A duplicate or late native RPC response with an old request ID caused the pinned SDK to throw an unhandled rejection. It did not settle the new request, but the error escaped the message boundary. The actual official-client iOS-style test reproduced it.

The page now tracks its own outgoing request IDs per connection and accepts each response once. Stale/unknown response IDs are ignored before SDK dispatch; current results and errors still reach the SDK. Existing origin checks, host requests/notifications, signing rules and cleanup gates remain unchanged. No dependency or device firmware changed.

## Added coverage

Nine additional transport cases exercise close and exchange settlement in both orders, late replies/errors, failed cleanup, duplicate/old RPC IDs during a fresh request, and repeated old close calls. The expanded transport suite passes 33 cases.

Six additional PSBT schedules combine the actual client and Wallet API adapter. They verify that cancellation, timeout or a reported disconnect after a partial signature cannot admit a late final yield or send more APDUs. Complete verified transaction bytes remain available through storage success, failure or timeout, while a distinct fresh session cannot be closed or used for signing by the old operation. These use public frozen signatures and a modeled storage callback, not real device signing or IndexedDB durability.

The full `npm run check` passes **624 tests**, type checking, workspace production builds and the secret-pattern scan. Earlier broad runs overlapped host sleep and timed out; isolated unchanged tests and the final awake run passed. Those outcomes remain recorded in [results.json](results.json). Test timeouts, assertions and normal concurrency settings were not relaxed.

Reproduce with Node 24 and the existing locked dependencies:

```sh
node --import tsx --test apps/companion/test/wallet-api.test.ts apps/companion/test/wallet-api-signing-faults.test.ts
npm run check
```

[Independent review](final-review.md) binds the source and final run and records the limits. The work is kept on the draft investigation branch; nothing was installed or deployed.

## Remaining boundaries

Discover exposes no live idle-disconnect notification to this page. Account/page persistence is separate from signer connectivity. An exchange failure or timeout ends the web session; native RPC close is not proof that the physical link closed or the Ledger's review was cancelled. This change fixes stale RPC-response handling, not the unexplained physical freeze/reset.
