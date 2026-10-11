# Real-browser smoke after async-boundary fixes

Date: 2026-10-09, 23:20–23:21 UTC. Reviewer: Astra.

This is a narrow actual-browser smoke pass. It neither replaces earlier browser reports nor establishes timing-race coverage.

## Exact tested build

- Target: `http://127.0.0.1:5173/`, dot cloud Chrome tab 25, using only the documented CUA API for browser actions.
- Bundle URL independently observed in the live DOM on entry and after final reload: `/assets/index-DSuyUU3g.js`.
- Corresponding local bundle SHA-256 independently checked: `8b4ae77bb1b5156daec9cb8460f13832126b0e071d9d1e9c03198fc43b60d8a5`.
- Unchanged notices asset SHA-256: `ccea80c549383223e6cf762fa9fabb3648379b61763ab2222570e90e670a3808`.
- Checkout HEAD on entry was `03112c09890fb08c48a83e743d842fdbd791c29c`, with active worktree changes. The served bundle hash identifies the tested code; this report makes no claim about later source edits or builds.

## Actual observations

1. Initial app load shows `Data unavailable`; saved public account data is not silently displayed.
2. Explicit `Restore saved data` succeeds using the existing synthetic snapshot. The app says device verification and node freshness have been cleared, and displays `Chain metadata unverified`.
3. Restored Receive remains `Not device verified`; both `Verify on Ledger` and `Copy verified address` are disabled. Existing saved receive index 1 is still visible.
4. Close removes the account presentation and returns Overview to `Data unavailable`. Navigating the same tab to `about:blank` and using browser Back retains the closed state.
5. `Explore public example` still loads the synthetic regtest fixture with its explicit no-real-funds warning and unverified imported metadata. It still shows 1.25 PRL eligible and the prior 5 PRL reservation.
6. The footer link opens a new tab at exact URL `http://127.0.0.1:5173/third-party-notices.txt`. Browser DOM reports `text/plain`, UTF-8, and MIT/Apache license text. Its heading punctuation renders correctly.
7. Final Close and reload leave the account closed and still serve the expected bundle.
8. A bounded warning/error log read (limit 100, 25 entries returned) showed only browser-extension metadata-delivery errors. No app-origin console failure was observed in that sample, and no app failure or browser protocol timeout occurred in the exercised flows. This is not an unlimited clean-console or full error-telemetry assertion.

## Explicit limits

- Import cancellation, account-ownership races, preparation races, consent changes immediately before broadcast, and emergency-copy staging were not driven through actual timing-sensitive UI paths. Their modeled/host-boundary tests remain separate evidence.
- No real verified Ledger session was established; only the visible disconnected/unverified gates were checked.
- No file upload, physical Ledger interaction, signature, native/emulator action, live node/indexer call, broadcast, journal deletion, new account, private key, recovery phrase, installation, or deployment occurred.
- Existing synthetic snapshot and durable recovery/payment state were retained. The browser finished at closed-account Overview. No application source was changed by this reviewer.
