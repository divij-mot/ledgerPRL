# Pearl 0.1.2: SDK exit and BLE review compatibility

The user reported that Gen5 / Pearl 0.1.1 briefly showed public-key review and exited before any touch, followed by a device UI hang that cleared after a power cycle. No physical event trace was captured. This review establishes concrete SDK-contract differences and fixes them; it does not claim the exact observed event or persistent-OS-hang cause was proven.

## Corrections

1. **Use the SDK's application exit.** Pearl previously called `os_io_stop()` unconditionally before `os_sched_exit()`. The pinned SDK's `app_exit()` deliberately skips that transport stop under `USE_OS_IO_STACK`, where the OS owns the transport service. Pearl now wipes its public APDU buffers and calls `app_exit()`. The old implementation fails the OS-stack regression; the corrected code passes for both OS-owned and legacy stacks.
2. **Do not require a BLE radio bit in UX status snapshots.** The normal SDK heartbeat forwards status events without using `BLE_ON` as a liveness test. Pearl 0.1.1 incorrectly terminated a BLE review on a well-formed four-byte status containing zero flags. The corrected guard forwards such snapshots for the SDK-recorded BLE medium. The existing USB power requirement remains for every non-BLE medium.
3. **Process an already completed pairing notification through the real SDK handler.** The SDK emits `ITC_UX_BLE_PAIRING_STATUS` with a two-byte payload; its named success value is `BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS` (4). Only that exact success notification during an active BLE review is accepted. It is routed directly to `io_process_itc_ux_event`, with PIN/deadline checks afterward. New pairing requests, failures, cancellation, reset, unknown values and malformed lengths still abort.

No signing policy, key derivation, recipient/change validation, permissions or APDU protocol was changed. Version 0.1.2 distinguishes the candidate from 0.1.1. All five mainnet images remain API 27: Nano S Plus flags `0x40`, BLE-capable models `0x240`.

## Why the notification is not approval

The test compiles the actual guard with the verbatim pinned SDK `app_exit` and `io_process_itc_ux_event`, and the actual Pearl `set_ux_flow_response` body. Only syscall/UX boundaries are stubbed. The SDK pairing handler sets the pairing UX ID/status and calls `os_ux`; it never calls Pearl's approval callback. Tests confirm that a legal status/pairing sequence leaves the app review latch unset, followed by separate simulated approval and rejection gestures. PIN invalidation and both deadline boundaries after the SDK notification still terminate the review.

The guard continues rejecting every complete nested APDU packet type before the UX handler, regardless of transport. Approval remains an explicit device interaction; phone cancellation is not a device rejection.

## SDK medium contract

In SDK `6709cd2bdfebb224ee070f7c1211b54254262579`:

- `lib_blewbxx/src/ble_ledger_profile_apdu.c:222` initializes the framing protocol with `OS_IO_PACKET_TYPE_BLE_APDU`.
- `protocol/src/ledger_protocol.c:89` prefixes the completed APDU with that type.
- `io_legacy/src/os_io_legacy.c:413,465` records it and maps it to `IO_APDU_MEDIA_BLE`.
- `io/src/os_io.c:323` reserves `RAW_APDU` for a distinct raw CAPDU path.

There is no inspected SDK evidence that normal BLE traffic should be treated as RAW, so RAW/non-BLE behavior was not relaxed. Closed device-OS behavior still requires physical confirmation.

## Verification

| Check | Result |
| --- | --- |
| Old 0.1.1 exit contract | Expected failure captured in `before-exit.txt` |
| Old legal BLE status snapshot | Expected failure captured in `before-events.json` |
| Old completed-pairing notification | Expected failure captured in `before-pairing.json` |
| Final BLE / OS-stack C guard | 85,759 ASan/UBSan cases passed |
| Final USB-only / OS-stack C guard | 85,750 cases passed |
| Final BLE / legacy-stack C guard | 85,759 cases passed |
| All five 0.1.2 mainnet builds | Passed; exact metadata and hashes recorded |
| All five Speculos account/Receive/two-input signing pilots | Passed; signatures independently verified |
| Native hostile requests | All 75 rejected on the regtest fixture |
| Native review lifecycle | Nested capability/sign/default/malformed APDUs plus explicit deny/restart passed |
| Actual Gen5 installer build-only run | Passed exact image/metadata/linker-size checks; no USB loader run |
| Physical install, BLE radio, iPhone replay | **Not performed** |

The C harness runs in the pinned Linux builder because macOS does not expose its `explicit_bzero` declaration under the same feature macro. `after-exit-only.json` records an intermediate exit-only stage; the final source is bound by `after-ble.json`, `after-usb.json` and `after-legacy.json`. The before-failures are intentional comparisons with preserved 0.1.1 source, not failures of the final candidate.

Speculos 0.27.1 uses HID here and does not simulate BLE radio pairing. All emulation uses the published public test seed, with no real account, hardware access or broadcast. Existing 0.1.0/0.1.1 artifacts remain unchanged. No firmware binaries are included in this report.

The final firmware source set is `5870a589b33a2f6cb2ffb6004dbf53775cc6d1623da7c6e0594982439cab218e`. [release.json](../../apps/ledger-bitcoin-prl/release.json) binds the model-specific installation hashes and sizes. `result.json` and `reviewed-source.json` retain scope and source/evidence fingerprints. The [current installation guide](../../docs/install-pearl.md) is maintained separately from this evidence.

BLE status still does not prove a live phone connection. Reject any old review on the device before reconnecting; do not treat this fix as an immediate link-loss cancellation guarantee.
