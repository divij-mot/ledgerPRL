# Final presentation fixes and live wallet screenshots

Final browser pass: 2026-10-10 02:47–02:48 UTC in cloud Chrome, http://127.0.0.1:5173/.

## Exact final build

- Live DOM script before screenshots, after draft review, and after final reload: /assets/index-e9deRFQv.js.
- Bundle SHA-256: 5497c2f43cd65ea5b39756d8e7c8cfc78939bf573aca19a85c159d3e848b79aa.
- main.ts SHA-256: 454f6aa2fcd11adfaa9590bd840723f6962ffac74cfd25bbbe836e32e6fe91b7.
- presentation.ts SHA-256: f1a9217dd5201cd628b9188004fd9e60c3a34752b5dd06283382a7710fb61698.
- Actual live screenshots from the running browser, not generated mockups. Every root-directory 01–06 PNG was recaptured from this same final bundle; image hashes and sizes are in capture-manifest.json.
- Data: explicitly restored existing public synthetic regtest fixture; disconnected Ledger; 1.25 PRL eligible, 5 PRL reserved, one existing unsigned synthetic draft, saved receive index 1.

## Minimal source changes

- Replaced font-dependent navigation symbols with decorative 17px inline SVG icons in the existing span/container. Existing CSS and layout remain unchanged.
- Corrected singular/plural display for records, inputs and outputs, including the fee hint.
- Changed recipient label to “Recipient address (P2TR or P2MR)”.
- No security disclosures, control gates, handlers, signing/broadcast/storage logic, or CSS changed.
- Added presentation regressions and updated the fee-policy test's old grammatically incorrect expected label.

Changed repository files: apps/companion/src/main.ts; new apps/companion/src/presentation.ts; apps/companion/test/fee-policy.mjs; new apps/companion/test/presentation.test.ts. Publication is handled by the aggregate checkpoint.

## Host verification

- Companion typecheck: PASS (companion-typecheck.log).
- Companion Vite production build: PASS (companion-build.log).
- Prettier on all four changed files and git diff --check: PASS.
- Complete companion suite with --test-concurrency=1: PASS, 139/139 in 68.3 seconds (companion-tests-serial.log).
- Default-parallel aggregate is NOT a pass. After updating the text expectation, it returned 138/139; serving-policy.test.ts was terminated by SIGKILL during its production-build case. Exact signal and full result are preserved in companion-tests-final-tap.log. Original and default-parallel rerun logs remain in companion-tests.log and companion-tests-final.log.
- The fee-policy and all serving-policy cases pass in a focused run (focused-final-tests.log). SIGKILL may be resource-related because isolation and the full serial run pass, but the kill's underlying cause was not established. No package/test concurrency setting was modified.
- All executed tests were host-side with existing installed tools and public/mock boundaries; no installation, native firmware, emulator or real device execution occurred.

## Screenshot files

- 01-closed-account.png — account closed/connect landing; 1165×1467.
- 02-overview.png — restored synthetic account; 1165×1697.
- 03-receive.png — unverified public address; 1165×919.
- 04-send.png — empty send form and reserved input; 1165×1123.
- 05-activity.png — one existing unsigned draft; 1180×757.
- 06-review-existing-draft.png — exact draft review and disabled Ledger-sign control; 1165×944.
- 01–05 also have -viewport.png variants, each 1180×757.

Recommended combined-image label: “Public synthetic regtest data; Ledger disconnected.” Any separate Ledger screenshot evidence must retain its own exact-build/native-versus-physical qualification.

## Final real-browser observations

1. All four main views and existing-draft review render readably at the tested desktop size. SVG arrows now render correctly; the longer recipient label fits on one line. Activity says “1 record” and “1 input”; review says “1 reserved output”.
2. Restore explicitly clears device verification/node freshness and displays unverified chain metadata. Network/account controls remain disabled while loaded.
3. Receive says Not device verified; Verify on Ledger and Copy verified address remain disabled.
4. Send has zero selected inputs, a disabled reserved output and disabled Prepare control. No form was submitted.
5. Existing draft review shows amount 1 PRL, fee 0.00001000 PRL and change 3.99999000 PRL. Review & sign on Ledger is disabled. Back to activity preserves the single draft.
6. Close removes account presentation and returns Data unavailable. Navigation to about:blank, Back, and reload retain the closed state on the final bundle.
7. Bounded final warning/error log sample contains only browser-extension metadata-delivery errors; no app-origin failure was observed. This is not an exhaustive telemetry assertion.

Earlier capture attempts had browser-control protocol timeouts and disappearing stale tabs. These are retained as tool interruptions, not established application defects. After host checks settled, fresh tab 40 completed all captures and navigation checks without such a failure.

## Scope and final state

No new payment was prepared, signed or broadcast. No existing draft was discarded or archived. No live node/indexer refresh, wallet connection, physical-device action, native build/harness, emulator, installation, browser-profile access, browser-control workaround, upload, commit or push occurred. Existing synthetic snapshot, reservations, draft and range records were preserved. Final browser state is closed-account Overview.

This is desktop website visual/navigation QA plus host tests. It does not qualify mobile support, physical Ledger UX, native firmware, actual WebHID/IndexedDB failure durability, live source freshness, real transaction execution, or changes outside the identified build. Prior pre-patch 02–06 images/report were retained separately in previous-index-d0S-5XX6 and must not be substituted for final-build evidence.

## Artifact availability

The PNG originals and prior-build images are retained in the review workspace rather than duplicated in this source tree. The owner received a full-resolution combined PNG containing all six final wallet views plus explicitly historical device captures. This directory retains their hash manifest and textual evidence, not the PNG files.
