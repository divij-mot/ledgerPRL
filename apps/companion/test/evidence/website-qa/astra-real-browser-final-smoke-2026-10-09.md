# Final-bundle real-browser smoke

Date: 2026-10-09, 23:28–23:29 UTC. Reviewer: Astra.

## Provenance

- Real dot cloud Chrome tab 25 at `http://127.0.0.1:5173/`, controlled exclusively through the documented CUA browser API.
- After reload, the live DOM referenced `/assets/index-CpBl0wyO.js`.
- Independently checked local build SHA-256: `84e04058b1565b0fa73d84360ada84868c32b2e7e5637e6b2dcca4a8131236d3`.
- Independently checked `src/main.ts` SHA-256 at the start: `a1bfd6960626b1d397ffa4db5366da7633af6a47f656392319da650823bf12b7`.
- Notices SHA-256: `ccea80c549383223e6cf762fa9fabb3648379b61763ab2222570e90e670a3808`.
- Checkout HEAD at the start: `b908b15be8ca95a850c551d138ce646475517621`, with worktree changes. The exact bundle and source hashes above bind this scoped observation.
- Earlier `index-DSuyUU3g.js` evidence remains an intermediate smoke result, not evidence for this final bundle.

## Narrow checks passed

1. **Reload:** app remains at closed-account Overview with `Data unavailable`; it does not silently reveal the saved synthetic account.
2. **Explicit Restore:** the saved public fixture restores with the message that device verification and node freshness have been cleared. Chain metadata remains unverified. The existing 5 PRL reservation remains visible.
3. **Receive and record preservation:** Receive shows `Not device verified`, disabled Verify/Copy buttons, and saved receive index 1. Activity still shows the one pre-existing synthetic draft. No journal mutation was performed.
4. **Close and browser Back:** Close removes account details and returns to `Data unavailable`. Navigating to `about:blank` and using Back retains the closed state.
5. **Notices:** clicking the footer opens exact URL `http://127.0.0.1:5173/third-party-notices.txt` in a new tab. The browser reports UTF-8 `text/plain`; MIT and Apache license text is present, and the title punctuation renders correctly.
6. **Bounded runtime-health observation:** the warning/error sample returned 49 total entries, with 23 timestamped during this final smoke. Those 23 entries were browser-extension metadata-delivery errors; no app-origin failure was observed. The tested UI flows completed without a browser protocol timeout. This is not an exhaustive error-telemetry assertion.

## Limits and final state

This short smoke does not re-run the earlier twelve-case matrix and does not exercise the signed-write/read-back failure, emergency-copy path, timing races, cancellation races, broadcast consent boundary, or prior hardware-verified sessions. Modeled/storage tests must be cited separately for those behaviors.

No upload, signing, physical wallet interaction, real funds, live node/indexer call, broadcast, blocked native-harness retry, journal deletion, new account, or installation occurred. Existing synthetic snapshot and durable fixture records were retained. The final browser state is closed-account Overview. No application source was changed by this reviewer.
