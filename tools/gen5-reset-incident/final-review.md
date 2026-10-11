# Final offline investigation review — release remains held

Reviewed 2026-10-11. This reviewer inspected the exact production delta, SDK contracts, test controls and retained results, and independently matched source/SDK hashes, all five candidate ELF hashes, four raw guard records and both candidate QR-result sets. The reviewer did not execute these simulations or access hardware. Only this report was written.

## Finding

The one-line `POWER_BUTTON_EVENT` addition follows pinned SDK `6709cd2bdfebb224ee070f7c1211b54254262579`: its standard heartbeat delegates OS events to `io_event`, and the SDK treats the power tag as OS UX without an app-side payload parser. The candidate retains envelope/copy bounds, gesture minimums, exact ITC policy, nested-APDU rejection, PIN/deadline checks and explicit approval. It does not broadly forward unknown tags. No blocker was found for this narrowly scoped **offline candidate**; this is not physical-use approval.

The preserved baseline exits on the synthetic empty-body power tag. The candidate keeps review pending, permits QR Close to restore the preceding pixels and returns device denial `6985` after explicit Cancel. This establishes an event-dispatch compatibility correction, not a cause or fix for the owner's reported freeze/reset.

## Evidence assessed

- The [baseline](baseline-simulator.json) uses preserved ELF `2737ecae15f14727ea0b1c5dcd3044da249eb04df3280294087ba9950e86f707`. The first harness's incorrect cancellation-text assertion remains preserved and identified in [provenance](baseline-provenance.json).
- [Candidate evidence](candidate-evidence.json) binds Gen5 ELF `3580dfbd6871b77d3d5dacbb162ccd7c885503affd835b0176bdf708922b346c`, five model builds/public-fixture pilots and four sanitizer configurations. QR scenarios request no signing; separate model pilots sign fabricated public-fixture transactions only.
- Eight primary QR cases cover Close/Cancel, synthetic host timeout, TCP close, synthetic power, natural expiry, two approximately 105-second actions, and a fresh emulator. Close is checked through modal disappearance and exact screenshot restoration; normal exit is distinguished from emulator failure through SDK exit logs and exit/signal metadata.
- The initial host-timeout assertions could miss a late raw success after the JavaScript promise had rejected. The reviewed correction starts its reply checkpoint only after QR is visible and the request remains pending, excluding legitimate preflight successes. Two targeted reruns enforce the new check: connected Cancel received only `6985`; near-expiry host timeout received no subsequent reply before logged app exit at 124.928 seconds. Do not attribute this stronger assertion to all eight original runs.

The immutable image/public-fixture controls, network isolation, absent physical-device/host-port mounts, bounded test process, first-failure retention and owned-child cleanup were reviewed. No device reset, recovery secret, real account or broadcast is part of these tests. The root agent separately exercised the installer's existing source check, which rejected this candidate against unchanged `release.json`; no new installer logic was added.

## Limits and disposition

`RAW!` plus an empty `0x1B` body is synthetic; the owner's actual power event was not captured. TCP closure is not retail BLE loss, and replies after that socket closes are unobservable. Approximately 105-second actions are not final-tick approval-race coverage. A fresh emulator is a new process, not recovery of the same process or physical device. Speculos and syscall stubs do not qualify retail rendering, protection behavior or state erasure.

The [incident account](README.md) correctly records that Protection mode was not observed and that the app's “Disconnected” wording does not establish causal ordering. Neither a freeze nor a reset was reproduced here. Their cause remains unknown; passing offline tests does not exclude an indirect app/SDK/OS failure. Hardware use/installation and release promotion remain paused. The unchanged `0.1.4` version label identifies neither a qualified new release nor the candidate's bytes; use the hashes.

## Reviewed bindings

| Source/evidence | SHA-256 |
| --- | --- |
| `apps/ledger-bitcoin-prl/src/boilerplate/prl_review_io.c` | `d66940dbbc97dfd90ef63417756968620fbb5df01e16ce814f560c0b58ba10db` |
| `apps/ledger-bitcoin-prl/release.json` | `f3cc4ad53db1e2d3eee7be321bf260d00a391edd1aa2c91a40c4fd576633a603` |
| `tools/ble-exit-review/review-heartbeat.c` | `be86439631e405699da4057819943e2b16824893fc1a4c23bc6fc511762a8255` |
| `tools/ble-exit-review/review-heartbeat.py` | `41b4b7360fafd19f71781f07ff8b3ea92b46da1039fef43bc4c3ba9963929bbe` |
| `tools/gen5-reset-incident/qr-modal.ts` | `9627a3b3a4e6d6416c75a5f2e02965dedc9960d43f082808b454b51e71763e47` |
| `tools/gen5-reset-incident/candidate-evidence.json` | `ff9078d4cf1452aee0dbc7f1f296d907733e30d38851dcce228dc2a6ecb6fa46` |
| `tools/gen5-reset-incident/baseline-provenance.json` | `8e3a285209c78ea151d8bab14b3d72150d8549e904cba7318f47acaa83eb34c4` |
| `apps/ledger/tests/speculos-driver.ts` | `ab3d5d8a1638b9ee2841a2467f21f0cef33eab0d1ec0e6df4a5d67cfbf0f8fdf` |
| `apps/ledger/tests/speculos-injector.py` | `31d7a36137bb83d21ae2d756168814ef7229cb36e8a11a4bcfab3c5d09fcb0f8` |

Primary-eight raw result SHA-256: `606a23b0b8e00fbd0d787b58ab6304098c6f67d122dc9c0c17df47fc75e9a821`. Strengthened two-case raw result SHA-256: `9af7ba1bbd44c91bd02a68dc2146b670db57afa5f66285bca3c3b41b1498b3ae`. The two harness identities and their separate assertion scopes are retained in `candidate-evidence.json`.
