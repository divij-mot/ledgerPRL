# Bitcoin interruption and cleanup comparison

This extends the held candidate at `ddbd551`. The [Gen5 freeze/reset incident](../gen5-reset-incident/README.md) remains unresolved. This work uses public fixtures, simulated devices and source review; it does not resume hardware use or release promotion.

## Device behavior

The comparison uses official Bitcoin commit `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`, its SDK 26.6.2 sources, and Pearl's pinned SDK 27.1.2/API 27. Bitcoin and Pearl retain the same `app_main` body. The two SDK heartbeat implementations also match: a second APDU receives `6901` while the original review remains active.

Pearl now follows that busy-response path for the SDK's seven APDU packet types. It does not dispatch the second command, replace the saved original command/media state or reset the review deadline. A reported negative transmit result terminates the session. Some legacy SDK send paths return zero without exposing lower-level send errors; that is not proof of delivery. A busy response is **not** cancellation of the original review; a host that ends its request must still treat the device review separately.

| Condition | Bitcoin / SDK | Pearl candidate |
| --- | --- | --- |
| Explicit user rejection | Rejects the operation | Retains rejection and fresh-approval requirements |
| Second APDU during review | Rejects new APDU; retains original review | Same busy response and retained command ownership |
| Browser cancellation or lost connection | Not necessarily an app-visible cancellation | Does not infer device rejection from host cleanup |
| Known OS UX events | SDK UI handling | Uses SDK handlers after bounded envelope checks |
| Invalid PIN, review/command deadline or negative receive/transmit result | SDK behavior varies by path | Terminates the app; deliberately stricter |
| Unknown UX tags / non-allowlisted pairing events | SDK default handling | Remains stricter and terminates |

The tested change aligns the second-command behavior. It does not make every Pearl policy identical to Bitcoin or transfer upstream audit coverage to this fork.

## Desktop USB behavior

Review of the pinned DMK/WebHID implementation found three separate application lifecycle concerns: repeated close callers could return before cleanup finished, the application reacted to unrelated HID disconnects, and device discovery could lead to a new open before old cleanup completed. The SDK also starts some physical closes without exposing their completion.

The correction keeps Ledger's APDU framing and state machine. It uses public transport lifecycle hooks to track normal raw close promises once per connection, filters disconnects by the exact selected handle, and waits for prior cleanup before a new physical open. The picker still starts within the user's click gesture.

An unobservable SDK physical close quarantines that exact browser device handle for the rest of the page. A failed or timed-out owned close blocks reconnect until reload. An unrelated HID event does not terminate the selected session or block a different handle. This is a deliberate recovery limit, not a claim that a JavaScript timeout cancels device review.

`HIDDevice.opened === false` is not proof that closure finished: the [WebHID specification](https://wicg.github.io/webhid/index.html#dom-hiddevice-close) changes the internal state to closing before OS cleanup. The implementation does not use that shortcut or replace browser HID methods.

The alternate official LedgerJS WebHID package was also inspected. Its close waits for an outstanding exchange, while its response timeout reports unresponsiveness without rejecting that read. An isolated synthetic-device characterization reproduced a pending close after disconnect. It was not adopted as an unqualified drop-in fix. No dependencies were added or changed.

These desktop findings do not explain the owner's iPhone/Gen5 reset. Discover continues to use its separate Wallet API transport.

## Validation and review

- [Native comparison](native-comparison.md) and [bound evidence](evidence.json): 18 focused cases passed on Gen5 and Nano S Plus; Flex, Stax and Nano X passed build-only checks for this change. Four ASan/UBSan guard configurations passed. These do not imply new runtime testing on all five models.
- [Host review](host-review.md) and [results](host-results.json): 21 focused lifecycle cases, five existing disconnect/payment scenarios, and the retained DMK refresher timing/control checks passed using synthetic devices and public fixtures.
- [Full host check](full-host-check.json): `npm run check` passed with 609 tests, type checking, workspace production builds and the tracked secret-pattern scan. An old synthetic refresher fixture was updated to supply the required lifecycle hook and exact device identity; its existing safety assertions remain.
- [Independent final review](final-review.md) records source and result hashes, model/test boundaries and remaining differences from Bitcoin.

No dependencies, device version or release manifest changed. No hardware was accessed, no real payment was signed or broadcast, and no deployment was performed. This update remains on the held draft branch; the physical reset investigation is still open.

The subsequent [phone-session campaign](../phone-session-review/README.md) adds RPC-response ownership checks and signing/storage interruption tests for Discover. It has separate source bindings and does not change the device firmware assessed here.
