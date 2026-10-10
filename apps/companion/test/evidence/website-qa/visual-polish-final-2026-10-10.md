# Final wallet visual polish and browser evidence

Observed 2026-10-10 02:47–02:48 UTC in dot cloud Chrome, tab 40, at `http://127.0.0.1:5173/`. These are actual website observations and captured pixels using public synthetic regtest data, with the Ledger disconnected.

## Exact final build

- Live script before capture, after draft review and after final reload: `/assets/index-e9deRFQv.js`.
- Bundle SHA-256: `5497c2f43cd65ea5b39756d8e7c8cfc78939bf573aca19a85c159d3e848b79aa`.
- `src/main.ts`: `454f6aa2fcd11adfaa9590bd840723f6962ffac74cfd25bbbe836e32e6fe91b7`.
- `src/presentation.ts`: `f1a9217dd5201cd628b9188004fd9e60c3a34752b5dd06283382a7710fb61698`.

The patch replaces font-dependent navigation glyphs with decorative inline SVG, fixes singular payment counts, and labels the recipient field “Recipient address (P2TR or P2MR)”. No CSS, disclosures, event handlers, control gates or transaction/storage logic changed.

## Host checks

- `npm run typecheck --workspace @pearl-ledger/companion`: pass.
- `npm run build --workspace @pearl-ledger/companion`: pass.
- Installed Prettier check on the four changed source/test files and `git diff --check`: pass.
- `node --import tsx --test --test-concurrency=1 --test-reporter=tap apps/companion/test/*.test.ts`: **139/139 pass**, 68.3 seconds.
- `node --import tsx --test --test-reporter=tap apps/companion/test/serving-policy.test.ts apps/companion/test/fee-policy.test.ts`: **4/4 pass**.

**Default-parallel aggregate remains qualified:** the initial run found a now-corrected old plural-text expectation. Subsequent full default-concurrency runs produced **138/139 passes**, with `serving-policy.test.ts` terminated during its production-build case. The exact TAP diagnostic is `failureType: 'testCodeFailure'`, `exitCode: ~`, `signal: 'SIGKILL'`, `code: 'ERR_TEST_FAILURE'`. The kill's underlying cause was not established. Isolation and the complete serial suite pass; this suggests a resource interaction but does not prove it. Package scripts and test concurrency defaults were not changed. Complete raw logs were retained with the local QA artifacts.

## Final browser checks

- All four views and existing-draft review rendered legibly. SVG arrows display correctly; the recipient label fits; the UI reads “1 record”, “1 input” and “1 reserved output”.
- Explicit Restore cleared device verification/node freshness; chain metadata stayed unverified. Existing fixture state remained 1.25 PRL eligible, 5 PRL reserved, one unsigned draft and saved receive index 1.
- Receive verification/copy and draft signing remained disabled. Send had zero selected inputs, the reserved output disabled, and Prepare disabled. No transaction was prepared.
- Review → Back to activity preserved the draft. Close → about:blank → Back → reload retained `Data unavailable` and hid account details on the final bundle.
- A bounded warning/error sample showed only browser-extension metadata errors; no app-origin error was observed. This is not an exhaustive clean-console assertion.

Earlier CUA capture attempts had protocol timeouts and disappearing stale tabs. These were not established as application defects. After host checks settled, tab 40 completed this whole capture/navigation pass without such failures.

## Captured image hashes

All six full-page PNGs below were recaptured from the exact final bundle, then supplied for the user-delivered contact sheet. No generated mockups were used. The large raw PNGs are separate artifacts rather than embedded in this report.

- `01-closed-account.png` (1165×1467): `97c5b3a4555a94fc7f2a75bbc55adc211744c125e2a9ef93c6dd415e97077a4f`
- `02-overview.png` (1165×1697): `ac4520a3695f70453f59a3308516bfa012c4db4e52337ef169649ccaf0842348`
- `03-receive.png` (1165×919): `1a2dec35efe4db9a3c6adaebda48dc59707f2ba9e8a2d1f89773a7eda6089d60`
- `04-send.png` (1165×1123): `c4127289390c1a5bd4cc26ab2cdc3b058aa55b1c36aaeeac28e131c579b1cc02`
- `05-activity.png` (1180×757): `ed98f634926d22b102558aefbf253058538ac7d8482d353a85d2dc30ce0a7dde`
- `06-review-existing-draft.png` (1165×944): `457124fb3940fb48cf4e77918ca810fb6fa2aedfa4ff11c06b334ed85941c206`

## Limits and preserved state

No physical Ledger, native firmware/emulator/build, live node/indexer call, real wallet/funds, new payment, signing, broadcast, journal deletion, upload or installation occurred. Existing synthetic snapshot, reservation, draft and range records were preserved; the final browser state is closed-account Overview. Host tests use existing installed tools and explicit mock/public-fixture boundaries.

This evidence does not qualify mobile support, physical-device UX, real WebHID or IndexedDB failure durability, live source freshness, or real transaction execution. Separate Ledger images retain their own build/provenance limitations; they must not be represented as physical-device validation of this website pass.
