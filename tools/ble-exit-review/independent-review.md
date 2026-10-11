# Independent review of the 0.1.2 native candidate

2026-10-10. Scope: the frozen review-heartbeat change, its exit path and the dedicated C/Python regression harness. This reviewer made no production edits and performed no physical-device operation. Source inspection found no new app-level approval path in this delta. This is bounded review, not a general security guarantee or confirmation that the reported Gen5 freeze is fixed.

## Contract checked

The reference is Ledger secure SDK v27.1.2, commit `6709cd2bdfebb224ee070f7c1211b54254262579` (verified clean checkout).

- **Exit:** Pearl wipes its APDU/receive buffers then calls SDK `app_exit`. The SDK's `lib_standard_app/main.c:40` skips `os_io_stop` with `USE_OS_IO_STACK`; legacy builds still stop their own transport. This removes the confirmed 0.1.1 divergence from the OS-owned I/O exit contract without resuming a rejected review.
- **Status:** active BLE accepts only the existing exact four-byte status envelope, forwards it to ordinary SDK UX handling and does not treat the legacy BLE-on bit as link proof. USB/non-BLE reviews retain the USB-power requirement. Status itself has no Pearl approval callback.
- **Pairing completion:** the sole added ITC case requires active BLE, exactly two payload bytes, `ITC_UX_BLE_PAIRING_STATUS`, and `BOLOS_UX_ASYNCHMODAL_PAIRING_STATUS_SUCCESS`. SDK `include/os_ux.h` defines success as 4; `io/src/os_io_seph_cmd.c:405` produces the two-byte notification; `lib_blewbxx/src/ble_ledger.c:767` emits success following pairing completion.
- **Approval separation:** that case calls the actual `io_process_itc_ux_event`, whose pairing-status branch only constructs the OS pairing UX request and calls `os_ux`. It does not dispatch NBGL touch/buttons/tickers or call Pearl's `set_ux_flow_response`. The app's approved result remains set by its explicit review callbacks. Unexpected handler return aborts.
- **Retained checks:** nested APDUs and unsupported packet types, malformed envelope sizes, new pairing requests, non-success pairing results, non-BLE pairing success and receive errors still abort. PIN and command/review deadline checks remain before/after receive and after either SDK handler. Buffer accesses in the added branch follow exact-length validation.

## Regression strength and results

The harness compiles the actual production heartbeat, extracts the unchanged dispatcher deadline, and uses verbatim SDK exit/pairing-handler functions and Pearl's result setter. It checks OS-owned versus legacy shutdown, all enumerated media/status-byte combinations, malformed lengths, nested packets, PIN/deadline boundaries, and the exact success-notification route. The pairing callback asserts its SDK UX ID/status; the app result remains unset until a later explicit simulated approve/reject gesture. The success-handler return path also tests post-handler PIN loss and both review/whole-command deadline boundaries.

The native reviewer retained **85,759 BLE**, **85,750 USB**, and **85,759 legacy-stack** passing cases under ASan/UBSan in [after-ble.json](after-ble.json), [after-usb.json](after-usb.json), and [after-legacy.json](after-legacy.json). This reviewer inspected those records and independently matched their production/dispatcher hashes. [before-exit.txt](before-exit.txt) detects the old shutdown mismatch; [before-events.json](before-events.json) detects an unexpected old-code exit for a well-formed BLE status with zero flags. [before-pairing.json](before-pairing.json) separately detects the old-code exit on the exact success notification; [after-pairing.json](after-pairing.json) confirms acceptance without setting the approval result. These are constructed compatibility regressions, not captures of the incident’s actual device event.

An independent direct macOS attempt failed at compilation because its system headers do not declare `explicit_bzero`. This reviewer then independently reran the final BLE/OS-stack suite in the cached Linux ARM64 builder image `ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools@sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2`: **85,759 cases passed under ASan/UBSan**. The container had no network/device access, read-only repository/SDK mounts and root filesystem, dropped capabilities and a temporary scratch filesystem. [independent-ble.json](independent-ble.json) records this run; the USB/legacy results above remain the native reviewer’s executions.

The harness stubs OS syscalls and generic UI dispatch. Its explicit gesture invokes the extracted setter through that stub, so it is not a real Gen5 touch/navigation or full SDK UI replay. It does not exercise the whole dispatcher, real pairing/radio service or the closed OS. Case counts do not establish physical coverage.

## Remaining limits

BLE status is neither radio nor connection liveness proof. The change does not guarantee cancellation on link loss, and no incident event trace establishes which 0.1.1 condition caused the early exit. Source and regression corrections do not establish the cause or resolution of the later dashboard/PIN freeze. Physical recovery, disconnect/reconnect, pairing and review qualification are separate; none were performed by this reviewer.

The earlier [0.1.1 source review](../mobile-transport-review/native-review.md) remains a historical snapshot. Its BLE-on guard and unconditional transport-stop description do not describe this candidate.

## SHA-256 snapshot

| Reviewed source/evidence | SHA-256 |
| --- | --- |
| `apps/ledger-bitcoin-prl/Makefile` | `d095596444ece582fa72f8ffaabf1797a80c75b5aa2e8cd237d66ef3c224d6fa` |
| `apps/ledger-bitcoin-prl/src/boilerplate/prl_review_io.c` | `b847a1ddc730dc64474391533286481df84c50679b53841fe6e74a87b80788ba` |
| `apps/ledger-bitcoin-prl/src/boilerplate/dispatcher.c` | `82d0b0cb3ab3b5de2fccb2d6dffdf84d16628eb036d03b98244265b60006329e` |
| `apps/ledger-bitcoin-prl/src/ui/display.c` | `d34126a4363530370800eeb45d3817e423c03a2253cccf1459edeff469796766` |
| `apps/ledger-bitcoin-prl/src/ui/display_nbgl.c` | `1572dfed5ed372455bc45830ac5ca393c25c87b9d5f0d4bc4a9d3c3cd07cdc0d` |
| `tools/ble-exit-review/review-heartbeat.c` | `3c77a3f0709ef67919a7d7814c9fa305f977aee4e18725eea7361436fcef9922` |
| `tools/ble-exit-review/review-heartbeat.py` | `9244a7b5c03951af933d33382714e41aaefab6cb1a2c6d0188f6f593c5951ed6` |
| `tools/ble-exit-review/after-ble.json` | `3de4098db3e7df7cd50278f2cad26ee7656695649cbe21364479788318d83388` |
| `tools/ble-exit-review/after-usb.json` | `b66d47610cd7e486e4b1bb666ef1474003db5dd1d36e0d3702e678d2347fc4d2` |
| `tools/ble-exit-review/after-legacy.json` | `5ba61858c210a878cbe31308b5404c6d86d743c04f24b4b045f0aef0b396832b` |
| `tools/ble-exit-review/before-pairing.json` | `ce803b29f3942ce759344e0e4d82704dc7ee84e26ca47b257244075e4e086434` |
| `tools/ble-exit-review/after-pairing.json` | `99fc506f4626bbe77a3daa515efe9fcfb786b3bb14f300401538f39284ab0f01` |
| `tools/ble-exit-review/independent-ble.json` | `3de4098db3e7df7cd50278f2cad26ee7656695649cbe21364479788318d83388` |
