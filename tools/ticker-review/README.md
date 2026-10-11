# Gen5 ticker compatibility fix — Pearl 0.1.3

The owner’s diagnostic showed `STOP 0C M1 P01 T0E H2 N8 L4`: the USB review received a coherent ticker event with four payload bytes, and Pearl rejected its length. `S00000000` is the unused status field, **not** the ticker payload. Actual ticker bytes were not recorded.

The production change accepts ticker payload lengths **0 or 4** and leaves display-processed events at **0**. Every other packet, length, PIN, deadline, transport and approval check is unchanged. The pinned SDK’s `lib_standard_app/io.c` forwards one ticker callback; `lib_ux_nbgl/ux_nbgl.h:105` ignores the packet argument, and `ux.c:111` advances the usual 100-ms ticker. The four bytes are not decoded as time or approval. Normal SDK gesture/ticker processing remains intact.

The event-shape audit found no basis to widen another event:

| Event | Retained validation / SDK contract |
| --- | --- |
| Button | One byte; valid shifted button mask |
| Finger | State plus X/Y, five bytes; touch/release only. Optional hardware-swipe extension is disabled in these builds |
| Display processed | Empty payload; no alternate format established |
| Status | Four bytes; existing transport handling retained |
| ITC | Existing exact redisplay and active-BLE pairing-success forms only |
| Unknown/nested APDU | Existing rejection retained |

`before.json` reproduces the captured framing against 0.1.2 and fails as expected. New tests use synthetic zero/high/mixed payloads, check one forwarded tick and an unset approval latch, then separate later approval/rejection gestures. They also reject ticker lengths1–3/5–16 and display length4, and cover deadline boundaries and tick wrap. These are syscall/UI-boundary stubs, supported by the SDK source trace, not a complete physical UX replay.

The existing shared harness at `tools/ble-exit-review/review-heartbeat.{c,py}` was extended; no duplicate test script is shipped here. Historical results remain unchanged. Final passing counts: **85,804 BLE**, **85,795 USB**, **85,804 legacy**. See the [independent source review](independent-review.md).

All five mainnet builds passed, with actual ELF metadata and installer hash/size checks. All five Speculos account/Receive/two-input-signature replays passed, along with75 hostile requests and five review lifecycle cases. `results.json` records compact per-model metadata, hashes and replay evidence fingerprints; full deterministic fixture outputs remain in the isolated test workspace. No new binaries are published here.

The source set is `0fcf78a0f97be7c3a63e2c1040c974d12b899c62b830d44e9356fac637c34e75`; `release.json` binds the model-specific images. This agent performed no physical installation or funded broadcast. Corrected physical approval and BLE behavior remain for the owner’s retest; software/emulator success does not establish them.
