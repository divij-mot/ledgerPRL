# Independent native BLE source review

Read-only review, 2026-10-10. Scope: Pearl 0.1.1 Bluetooth enablement and the media-aware review heartbeat. This reviewer performed source inspection, not a firmware build, radio test, installation or device interaction. Native build/test evidence is separate; these observations do not establish physical iPhone or BLE qualification.

## Identity and permissions

The comparison uses official [Bitcoin 2.5.1 source](https://github.com/LedgerHQ/app-bitcoin/blob/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a/Makefile) and [SDK v27.1.2](https://github.com/LedgerHQ/ledger-secure-sdk/tree/6709cd2bdfebb224ee070f7c1211b54254262579). The SDK checkout was verified at that commit with no local changes. Reviewed Pearl bytes are identified below, independently of any later build or release.

`ENABLE_BLUETOOTH=1` follows official Bitcoin. SDK `Makefile.standard_app:23–28` enables `HAVE_BLE`, `HAVE_BLE_APDU` and settings permission only for Nano X, Stax, Flex and Nano Gen5. Expected default load flags change from `0x40` to `0x240` on those targets; Nano S Plus remains `0x40`. SDK `include/appflags.h` defines `0x200` as general settings-change permission, not a BLE-only capability. No master-seed or application-library permission is added. Actual artifact/load parameters must be checked against build evidence; this review does not attest installed flags.

## Guards inspected

- SDK `io_legacy/src/os_io_legacy.c:465` records media when accepting an APDU. The Pearl review heartbeat does not accept another APDU or reassign that media: complete nested APDU packets, including another transport, abort before UI event dispatch.
- A BLE-origin review accepts battery-powered operation while the BLE-on bit remains set. A USB-origin review still aborts on missing USB power even if BLE is enabled. Malformed status/envelope lengths, negative receive errors and unrecognized forwarded events abort.
- Only benign redisplay ITC is accepted during review. Pairing/other ITC events, if exposed to the heartbeat, abort. SDK/OS-internal event processing is a separate boundary.
- PIN and command/review deadlines are checked before and after event receive and after the UI callback. `display.c` still waits for explicit UI approval. Abort wipes APDU/receive buffers and exits the app instead of allowing a stale approval callback to resume it.

## Remaining link-loss limitation

**BLE-on is not proof of an active BLE connection.** SDK `lib_blewbxx/src/ble_ledger.c:1112` consumes HCI disconnect, clears the connection/encryption state, restarts advertising and returns zero. The heartbeat permits a zero-length receive. Therefore this source does not prove immediate cancellation when a BLE link drops while the radio stays enabled: the existing review may remain until timeout, lock or a separately surfaced fault. Production uses the SDK's OS I/O stack; its physical link-loss notification behavior was not tested here, and no suitable public per-connection identity API was established in this review.

This is a disconnect-detection/qualification limitation, not demonstrated transaction substitution or signing without device approval. Do not describe the change as guaranteeing cancellation on every BLE disconnect. Physical disconnect/reconnect and final-approval races remain qualification work.

## Reviewed SHA-256 snapshot

| Source | SHA-256 |
| --- | --- |
| Pearl: `apps/ledger-bitcoin-prl/Makefile` | `8510417419c71a2847d0eb8eb1c2a23cb4d6cd7a8de7522a0f961eba95c7b5e7` |
| Pearl: `apps/ledger-bitcoin-prl/src/boilerplate/prl_review_io.c` | `d47489cb0aab657e1291c71728c2c734792c82a4b7ac758af8f6416e87c197b2` |
| Pearl: `apps/ledger-bitcoin-prl/src/ui/display.c` | `d34126a4363530370800eeb45d3817e423c03a2253cccf1459edeff469796766` |
| SDK: `Makefile.standard_app` | `a5840599d363612e41f66f66b00dc66190d0e0056d373fd65f834777baa88cd3` |
| SDK: `include/appflags.h` | `aef6fb0ae4a0e9652017e5f558b8ec8620d1276c1ced3e18e2e60a4cb8053220` |
| SDK: `include/seproxyhal_protocol.h` | `6cb2bbeb22d3b55b2ef0a61b6061701981fdcc79e03117d1d9e8774dd40824a3` |
| SDK: `io_legacy/src/os_io_legacy.c` | `77493d18d5e391b27a75503b03776fc8ac40234290e5166c9f61a3852c58e973` |
| SDK: `io/src/os_io.c` | `2e0667ebf0c0cb10bf9f4e7ca6f27ac1e0b2c3383e9edbffe3e83fc9d6fe79f0` |
| SDK: `lib_blewbxx/src/ble_ledger.c` | `a8b5f2205806b89a7f6c89bc5e3e56e8386d6a18bcf3a8edd1fbdfe028bdb22b` |
| Bitcoin: `Makefile` | `c28d37a810bdb303b01dd9baa7ed527302284e333665547620e7f24859136724` |
