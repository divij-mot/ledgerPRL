# Real-browser notices delta verification

Date: 2026-10-09, 22:49–22:52 UTC. Reviewer: Astra.

This narrowly scoped follow-up supplements `astra-real-browser-2026-10-09.md`. It does not replace or rerun that report's twelve-case matrix.

## Build identity and method

- Waited for the final host-boundary log to contain the completed Vite production build before opening the website.
- Target: `http://127.0.0.1:5173/`, actual dot cloud Chrome tab 22, using only the documented CUA browser API for UI interactions.
- Live DOM script URL: `/assets/index-BPR0Pkw2.js`.
- Main-bundle SHA-256, independently calculated from the corresponding local build artifact: `ce60e968b9f4ade7e04b5b929481f3522ef44b01ae8afa93d1250af5e67da1ba`.
- Final notice asset: 186206 bytes, SHA-256 `ccea80c549383223e6cf762fa9fabb3648379b61763ab2222570e90e670a3808`, independently checked locally after the encoding fix.
- Source checkout HEAD at the start was `bef09f0550eda47956e5862a984a8d584a86fd30`; the tested worktree contained later changes. Bundle and asset hashes identify this evidence.

## Actual browser observations

1. **Footer link passes.** The app footer exposes a `Third-party notices` link with exact DOM href `/third-party-notices.txt`. Clicking opens a new tab at exactly `http://127.0.0.1:5173/third-party-notices.txt`; the original wallet tab remains unchanged.
2. **Plain-text content passes.** Browser DOM inspection reports `document.contentType === "text/plain"` and a single PRE body element. The rendered document includes MIT and Apache license text. This is a check of delivery/rendering, not a legal completeness opinion.
3. **Encoding issue found and corrected.** The first preview response decoded as Windows-1252 and rendered UTF-8 punctuation incorrectly. The parent added a UTF-8 BOM to the notice asset. Reopening through the same footer in tab 24 then reported `document.characterSet === "UTF-8"`; the heading correctly rendered `PEARL WALLET WEBSITE — THIRD-PARTY LICENSES AND NOTICES`. The main bundle hash did not change. The initial asset was 186203 bytes with SHA-256 `7560d692cf139aa8eab59ca7b99cfd80fa3d10eeea4068cbc5c9bdd2c3027b42`; only the final hash above is the qualified asset.
4. **Close and Back pass.** Load the public synthetic example, save its optional watch snapshot, and click Close. Overview returns to `Data unavailable`, with account details removed. Navigate the same test tab to `about:blank`, then browser Back: the account stays closed.
5. **Explicit Restore passes.** Clicking Restore after Close/Back restores the synthetic account and states that device verification and node freshness have been cleared. Overview still says `Chain metadata unverified`. The existing 5 PRL synthetic reservation is retained.
6. **No stale verified UI observed.** After Restore, Receive says `Not device verified`; Verify and Copy buttons remain disabled; saved receive index 1 remains. Activity still contains one existing draft. Opening Review leaves `Review & sign on Ledger` disabled. No draft was changed, discarded, or archived.

## Scope and final state

- The xpub/wrong-network address-path parser change was not exercised through a live indexer or hidden app state in this browser lane. Its before-fetch rejection requires the separate host-boundary test evidence.
- No hardware-verified session was created; this confirms the observed unverified/disconnected UI remains fail-closed, not that a prior physical-device verification session was invalidated.
- No wallet file uploads, signatures, live node/indexer calls, broadcasts, new accounts, private keys, recovery phrases, journal deletion, extension installation, or external deployment occurred.
- Old ephemeral QA tab 21 had already been cleaned up (`Unknown CDP tab 21`); a fresh cloud tab was used. No new protocol timeouts occurred during this delta pass.
- Finished on the closed-account Overview. The synthetic optional snapshot saved for this regression remains available; durable prior draft and receive-range records remain unchanged. No application source was changed by this reviewer.
