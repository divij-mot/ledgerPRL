# Pearl companion: bounded cloud-browser rendering review

Reviewed on 2026-10-09 using dot's existing cloud browser (`cdp`), in a separate new tab at `http://127.0.0.1:5173/`. This was a read-only empty-state review. No repository files were changed.

## Summary

The desktop empty state renders with its intended styling and functional section navigation. A measured readability issue in the safety footer was fixed by the main task and verified in the rebuilt preview. No application-origin console error or CSP/style refusal appeared during the reviewed flow.

## Verified

- Viewport measured 1180 × 757 CSS pixels. Overview document width was also 1180 pixels, with no horizontal overflow. Its longer layout scrolls vertically.
- CSS is visibly active: green sidebar, cream page background, rounded cards, styled navigation highlights and buttons, and a two-column overview. The strict CSP permits the observed external built stylesheet; fresh Vite development-mode style injection was not tested.
- Subsequent read-only DOM inspection found no inline style elements and one external stylesheet link, `/assets/index-B45wSC2x.css`, without a nonce. The meta policy includes `style-src 'self'`. This observed built-asset presentation explains styling under that policy. After the main task rebuilt, reloading the same tab picked up `/assets/index-DK-3_Qur.css` and `/assets/index-CGCUOjSX.js`, and showed the new computed footer styles. This verifies that the browser sees the rebuilt current source, rather than merely an older cached page.
- Overview displays `Data unavailable`, rather than a fabricated zero balance. Immature mining, reserved, and unconfirmed amounts use unavailable dashes.
- Overview → Receive → Send → Activity → Overview navigation worked. Receive → Go to account returned to Account overview.
- Receive is guarded with “Connect a public account first” and the explanation that addresses must come from the device-approved account.
- Send is guarded with “Load watch data to prepare a payment” and asks for known public UTXOs plus local-node status verification.
- Activity shows 0 records and “No prepared payments yet”; backup and archive controls are disabled.
- Activity explains browser-local reservation coordination, signed/interrupted payments not auto-expiring, backup needs, six-confirmation archival, and retention of outpoint locks through reorganizations.
- The development warning is visible at the top of every reviewed section: not audited, not Ledger-approved, not verified on physical hardware, disposable test funds only, classical Taproot custody, and no post-quantum claim.
- Overview distinguishes signing from separate explicit broadcast, asks users to verify their full receive address on Ledger, and says keys stay on the device.
- The bottom-of-overview browser-support card renders and states that desktop Chrome/Edge on localhost or HTTPS are intended targets; mobile, Safari, and Firefox are not qualified. It reports WebHID available in this browser.
- Public-data-only, no-recovery-phrase, and never-import-a-seed/private-key wording is present.

## Fixed and rechecked: low-contrast safety footer

The footer text “Public data only. Never enter recovery words or private keys.” is visually faint and small. Read-only DOM computed-style inspection reported 11px text in `rgb(137,145,128)` (`#899180`) over the page's `rgb(244,246,239)` (`#f4f6ef`) background. This computes to approximately 3.00:1 contrast, below the usual 4.5:1 benchmark for small normal text. The main task changed it to `#66705e` and 12px. After rebuilding and reloading, computed styles matched exactly: `rgb(102,112,94)` and 12px. The new contrast against the same background computes to approximately 4.77:1. A settled post-fix Receive screenshot confirms the darker, larger safety text renders properly.

## Browser logs and limits

- The captured warning/error log contained repeated `Error sending browser metadata to extension: Object` entries from a `chrome-extension://.../content-script.bundle.js` source. These are browser-extension-origin entries; no Pearl application-origin error or stylesheet/CSP error was observed.
- A full-page screenshot request timed out once. Standard viewport screenshot capture worked and produced the attached evidence.
- The exposed cloud-tab API advertised no viewport resize or device-emulation capability. Narrow-screen behavior was not tested; desktop results must not be treated as a mobile pass.
- A dedicated network request inspector was not exposed. The app loaded and styled, and there were no visible failed-resource messages in the inspected console output, but this was not a complete network audit.
- Loaded watch data, import/upload, wallet connection, hardware behavior, signing, and broadcast were outside this review. The pre-existing upload workflow was left untouched.

## Retained screenshots

- `receive-footer-fixed.jpg`: final post-fix Receive view and improved safety footer
- `overview-final.jpg`: upper overview at normal viewport scale
- `activity-desktop.jpg`: Activity empty state and disabled controls

These selected original viewport captures retain the reviewed layout without duplicating every navigation screenshot. Only the Receive image is post-footer-fix; earlier captures preserve their original observation.

## Separate development stylesheet regression

The additional cloud-browser attempt at port 5174 returned `ERR_CONNECTION_REFUSED`, so development-mode visual rendering remains unverified. Separately, inspecting the installed Vite transformation confirmed that the earlier JavaScript CSS import called `updateStyle`, which creates an inline style element without a configured nonce. That is incompatible with the existing `style-src 'self'` policy even though the production build emits an external stylesheet.

The page now uses an external stylesheet link and the JavaScript entry no longer imports CSS. Three serving-policy regressions pass: unchanged loopback/anti-framing/proxy settings, real same-process development HTTP delivery as `text/css` without inline injection, and an in-memory production build with one linked CSS asset. The CSP is unchanged. These source/HTTP/build checks are distinct from the built-preview visual observations and screenshots above.
