# Independent host lifecycle review

The desktop USB correction closes three demonstrated software gaps: repeated close callers returned early; unrelated HID events terminated the selected session; and reconnect could overlap prior physical cleanup. The Gen5 reset incident remains unresolved. This review did not use hardware or send real transactions.

## Source scope and distinctions

Pinned production packages are `@ledgerhq/device-management-kit` 1.11.0 and `@ledgerhq/device-transport-kit-web-hid` 1.2.4. Their installed source maps contain the source reviewed; [host-results.json](host-results.json) binds the maps, public declaration and final application sources.

- WebHidTransport's public constructor accepts a state-machine factory. `connect` calls that factory before `deviceApduSender.setupConnection` (embedded source lines 371–419). The callback exposes the exact HID handle through public `getDependencies`.
- The pinned sender's `closeConnection` starts `device.close()` without returning its promise. Transport `disconnect` returns after calling the state machine. Pearl now observes normal close via the public sender lifecycle hook, once per ownership generation. It retains the official APDU framing and state machine.
- WebHidTransport `handleDeviceDisconnectionEvent` awaits `event.device.close()` before looking up its connection (lines 511–537), including unrelated devices. This bypasses the sender hook. Pearl therefore quarantines that exact handle; it does **not** claim an acknowledgement of this close. A different handle remains usable.
- The public setup hook checks ownership before and after the asynchronous open. It also rejects SDK automatic reconnection on a terminated generation. Normal reopening waits for prior cleanup; picker invocation does not wait. Failed/timed-out owned close and teardown failure remain terminal until reload.
- No browser HID methods, private SDK fields, dependency versions, Discover transport, signing admission rules, or broadcast policy changed.

`HIDDevice.opened` becomes false while the close algorithm is still in progress; it cannot prove OS cleanup completed. See the [primary WebHID close algorithm](https://wicg.github.io/webhid/index.html#dom-hiddevice-close). The pinned sender also treats `InvalidStateError` from open as already-opened, so relying on that rejection alone would not establish a barrier.

The alternative official `@ledgerhq/hw-transport-webhid` 6.36.0 and its declared base `@ledgerhq/hw-transport` 6.35.5 were downloaded into an isolated temporary directory. WebHID `close` waits for `exchangeBusyPromise` (source lines 212–215); the read promise resolves only on input and disconnect emits without rejecting it. Base `exchangeAtomicImpl` emits `unresponsive` rather than rejecting its job (lines 356–376). A synthetic-device replay reproduced a pending close after selected disconnect and timeout; a subsequent synthetic response released it. This alternative was not adopted. No shared dependencies were installed or changed.

Native Bitcoin Send and Discover's raw transport are different integration paths. Pinned Ledger Live `abed962b08ca4b746f20192b28ce5b6c06a6c6a4` Bitcoin `signOperation.ts` emits a completed signed operation; Send hooks register a pending operation after broadcast. Observable unsubscription alone is not proof that a hardware signature was impossible. Pearl's existing explicit durable signed/unknown-broadcast records and historical recovery reservations remain distinct policy; this patch does not loosen them.

## Verification

[host-tests.log](host-tests.log): 21/21 focused cases. These include actual pinned DMK/WebHID implementations with synthetic HID objects, delayed raw close, same-handle generation reuse, unrelated and selected disconnects, immediate/late reconnect events, disconnect during open, rejected/timed-out cleanup, failed open and throwing teardown. Existing exact APDU/status and final PSBT response winning a disconnect race assertions remain.

[host-disconnect-regression.log](host-disconnect-regression.log): all five existing end-to-end disconnect scenarios passed, including actual client/state-machine/main code, exact signed bytes across storage interruption, retained recovery reservations and explicit-only mock broadcast. Its fixture now supplies the same exact synthetic handle in the constructor and disconnect event. Assertions were retained.

[host-refresher.log](host-refresher.log): the existing real DMK DeviceSession/refresher/queue harness passed all five disabled-model cases, two enabled controls, historical capture checks and queue-boundary assertion. Its synthetic WebHID boundary now invokes the public state-machine factory and supplies the exact fake handle, preserving the original assertions and adding once-only raw close checks. No production check was relaxed to fit the fixture.

Companion typecheck passed. Reproduce with Node 24:

```sh
node --import tsx --test apps/companion/test/ledger.test.ts
node --import tsx apps/companion/test/disconnect-regression.mjs
node --import tsx apps/companion/test/dmk-refresher.mjs
npm run typecheck --workspace @pearl-ledger/companion
```

These tests establish JavaScript ownership, ordering and quarantine under the modeled schedules. They do not qualify physical USB/BLE cleanup, dismiss device QR review, explain the reset, or demonstrate that a host cancellation cancels device approval. Full repository checks and hardware/release decisions remain separate.
