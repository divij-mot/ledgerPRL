# iOS account-approval failure: host-source narrowing

Read-only source investigation after a reported short-lived public-key approval followed by the device returning home. This report does not assert that the physical failure was reproduced or that its cause is known. It contains no account data, raw APDU trace, private key or real transaction.

## Findings

The pinned Ledger Wallet mobile 4.23.0 BLE adapter disables background session refresh in both fresh connection branches: `libs/live-dmk-mobile/src/transport/DeviceManagementKitBLETransport.ts:202–205,263–266`. The shared device-connect state machine also disables it (`libs/live-dmk-shared/src/connectDevice/ConnectDeviceStateMachine.ts:59–62`). Existing-session reuse exists, so runtime state/version still matters, but no recurring polling source was identified in these ordinary handoff paths.

Mobile pins DMK **1.10.0**, distinct from the companion's desktop-web DMK 1.11.0. The published 1.10.0 package was retrieved read-only and its npm SHA-512 integrity verified. Its source maps confirm that `DeviceSessionRefresher.startRefresher` returns immediately when disabled, including after restart. Session initialization makes one awaited app/version ping before connection completion. This is a normal setup command, not evidence of an additional request arriving during subsequent account approval.

The legacy `connectApp` path reads app/version before emitting opened; its action hook unsubscribes when the app is opened. The alternative DMK path executes a ConnectApp action. `DeviceConnect` returns the selected device to the raw Wallet API handler. `openTransportAsSubject` then holds one `withDevice` job and forwards only received APDU frames to raw transport exchange. A prior cancelled host action may cause the normal cleanup APDU before a new job, but that source does not show a recurring request during the new job's public-key review. The bridge preserves raw status bytes, and the Pearl client awaits each account command serially.

Pearl's host flow requests network capabilities, master fingerprint and displayed account xpub in sequence. It does not issue another account command while awaiting the public-key approval response. No browser-side retry or fallback app was identified. These source facts do not exclude a different installed mobile version, background native feature or transport/link failure at runtime.

A concrete diagnostic limitation explains the generic UI text: the official Wallet API RpcNode propagates UNKNOWN_ERROR's deserialized value verbatim, which can be a plain tagged DMK object. The companion's main error display chooses the generic message unless the value is an Error instance. A narrow host-side normalization of a bounded message/name/tag can expose the transport reason without serializing arbitrary data, APDUs or account material. This improves diagnosis; it does not itself repair the device-side failure.

## Minimal action boundary

Do not broadly allow nested APDUs or treat all extra packets as harmless based on a polling assumption; polling has not been established. The native review should distinguish SDK BLE lifecycle/event handling from a complete second application APDU. Preserve fail-closed handling of an actual duplicate signing/account command, disconnect, lock, timeout and malformed packets. If firmware diagnostics are needed, prefer a bounded reason/tag/media classification over full APDU/account logging. Root/native agent owns that investigation and any correction.

This source-only result narrows the host hypothesis; physical BLE event traces or a reproducible native test are still needed to name the cause. `approval-failure-source.json` binds the inspected upstream and adapter sources. No production code was changed by this review.
