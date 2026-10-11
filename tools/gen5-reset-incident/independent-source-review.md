# Independent incident source review

Read-only review of the incident firmware, not the in-progress power-event candidate. No build, reproduction, hardware access or production edit was performed by this reviewer. This review does not establish the cause of the reported freeze or state loss.

## Source boundary

- Pearl 0.1.4 source: `328bae042af6c91a42647d8ad34953280ba6a7a2`; preserved Gen5 ELF SHA-256 `2737ecae15f14727ea0b1c5dcd3044da249eb04df3280294087ba9950e86f707`.
- Upstream comparison: [Ledger Bitcoin 2.5.1, commit 44ecd041](https://github.com/LedgerHQ/app-bitcoin/tree/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a). Those deployment tags used SDK 26.6.2; Pearl retargeted SDK 27.1.2/API 27. Upstream qualification does not cover that retarget or Pearl's changes.
- Inspected SDK: [commit 6709cd2b](https://github.com/LedgerHQ/ledger-secure-sdk/tree/6709cd2bdfebb224ee070f7c1211b54254262579), also recorded in `UPSTREAM.json`.

Selected SHA-256 bindings:

| File | SHA-256 |
| --- | --- |
| Pearl `src/boilerplate/prl_review_io.c` at 328bae0 | `aaee596683296b4c4b19c6a0c240929c79e137008d4a02a0d9e72e25be8b518d` |
| Pearl `src/boilerplate/dispatcher.c` at 328bae0 | `82d0b0cb3ab3b5de2fccb2d6dffdf84d16628eb036d03b98244265b60006329e` |
| SDK `lib_nbgl/src/nbgl_use_case.c` | `8a2e6fd04099cdc9642b8c6fa65422b04744102318239422e40f95fbd1b27757` |
| SDK `lib_nbgl/src/nbgl_layout.c` | `5e63baf233a68da0cd73eb2b93e5b273ac897daa18c6b73a341602d62577eb78` |
| SDK `lib_standard_app/main.c` | `d203009d677cd80a472359078b6c103c4b626eae376ff2e8bb52862c545bc9ec` |

## Established differences and limits

**Review event handling differs from upstream.** Bitcoin's `src/ui/display.c:io_ui_process` calls the SDK heartbeat. Pearl substitutes its own bounded event loop, checks PIN validity, exits after 1,200 review ticks, and adds a 3,000-tick whole-command budget. The SDK heartbeat (`io_legacy/src/os_io_legacy.c:130`) rejects nested APDUs with a status response while continuing UI processing; Pearl exits the application instead. These are intentional behavior changes, not upstream-equivalent cleanup.

**Power-event rejection is established; reset causation is not.** Incident 0.1.4 omitted the SDK's power-button event from its allowlist. The retained [baseline simulator result](baseline-simulator.json) reports native exit after an empty synthetic power event during QR review. This supports the handling defect already under separate review. It does not show the owner's actual event bytes, reproduce state erasure, or establish Protection mode.

**QR construction remains the SDK implementation.** Pearl still calls `nbgl_useCaseAddressReview`; its Receive differences are the Pearl title and added Network/Path pairs. A 63-character PRL address selects the SDK's V10 branch (`nbgl_layout.c:1957`), rather than the V4 branch used for an ordinary 62-character Bitcoin address. QR Close (`nbgl_use_case.c:1660`) releases the modal and redraws the underlying page; it neither approves the address nor restarts Pearl's review timer. No additional QR functional defect was established by this source comparison. The current simple emulator V10 open/Close check restored the prior pixels successfully, including separate synthetic waiter-timeout and TCP-close cases. This reviewer inspected those results but did not rerun them; they do not qualify retail OS rendering, BLE or the reported sequence.

**Exit is not an identified erase operation.** Pearl's abort clears public I/O buffers and calls SDK `app_exit`. Under API 27 `USE_OS_IO_STACK`, that helper skips `os_io_stop` and calls `os_sched_exit(-1)` (`lib_standard_app/main.c:40`). No direct device seed-erasure, factory-reset or OS-settings write was identified in the reviewed Receive/QR/abort chain. Inherited application-settings/MuSig NVM helpers and SDK reset/pairing helpers exist elsewhere; their presence does not prove execution here. Source inspection cannot exclude indirect effects in the closed OS or privileged SDK/OS calls.

**Flags are broad permissions.** The recorded `0x240` combines GLOBAL_PIN and BOLOS_SETTINGS. SDK `Makefile.standard_app:23` re-enables BOLOS_SETTINGS for supported BLE models despite Pearl's explicit zero assignment. `include/appflags.h` describes settings-changing permission, not a narrowly scoped Bluetooth capability. Upstream Bitcoin also requests BOLOS_SETTINGS; this flag alone is neither a newly proven defect nor evidence of a reset call.

## Remaining focused simulation boundary

The missing combined coverage is actual QR-modal state at review expiry: Close/approval immediately around ticks 1,199/1,200, and pending host cancellation before or after that boundary. The whole-command deadline can similarly end an active UI flow. The existing lifecycle tests exercised deadlines during transaction review, and the new UX-event cases exercised public-key review; neither substitutes for QR-modal expiry coverage. Near-expiry tests are being handled separately. Their results must distinguish normal app exit from SDK/OS faults and must not be described as retail factory-reset equivalence.

The [incident record](record.json) correctly treats “Disconnected” as observed app wording with unknown link-loss/causal ordering, and Protection mode as not observed. Earlier owner-confirmed address comparison/approval and a separate normal-exit check do not establish QR Close, timeout, side-button or reset safety. No additional reset-causing defect was established in this bounded review; the release remains blocked by the unresolved incident.
