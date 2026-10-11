# Independent real-browser wallet-flow verification

Date: 2026-10-09, 22:35–22:41 UTC. Reviewer: Astra.

## Build and method

- Target: `http://127.0.0.1:5173/`, Pearl Ledger companion development website.
- Actual dot cloud Chrome tabs 20 and 21, operated exclusively through the documented CUA browser API. No direct Playwright/CDP process, browser-profile read, storage injection, or mocked browser was used.
- Final-case bundle URL independently read from the live DOM after reload and again at completion: `/assets/index-B9WJtHC4.js`.
- SHA-256 independently calculated from the corresponding local build artifact: `4062ec6b173da7cb05dbc27a91928225571530a88171b47d2fbde8f1b4b671e0`.
- Source checkout HEAD was `3080142d6f6baf0084413925aba49ff82070108e` with uncommitted changes. The bundle identifier/hash, rather than HEAD alone, identifies the tested build.
- Evidence below is actual UI accessibility state and read-only DOM observation, not simulated app state or a claim of hardware validation.

## Preconditions and preserved state

Only the bundled public synthetic regtest example was used. The browser already contained one synthetic unsigned draft reserving a 5 PRL example output, with a saved receive index of 1. Those records were retained throughout. No new valid payment was prepared, signed, broadcast, discarded, or archived.

## Observed passes and reproduction

1. **Initial privacy state.** Open or reload the website. Overview shows `Data unavailable` and dash values, with no account public key or balance silently restored.
2. **Honest example state.** Click `Explore public example`. The banner explicitly says the outputs are synthetic, are not real funds, and cannot pass a real node check. Overview shows `Chain metadata unverified` and imported-estimate warnings. Observed totals: 6.25 PRL, 5 PRL reserved, 1.25 PRL eligible. Network and account selectors are disabled while loaded.
3. **Receive gate.** Navigate to Receive. `Not device verified` is visible. Both `Verify on Ledger` and `Copy verified address` are disabled without a connected Ledger. This was rechecked on the confirmed latest bundle and after restore/cache clear.
4. **Signing gate.** Activity shows exactly one existing draft. Open its `Review` screen: exact recipient, amount 1 PRL, fee 0.00001000 PRL, change 3.99999000 PRL, and one reserved input are displayed. `Review & sign on Ledger` is disabled. Leaving the review does not discard it.
5. **Malformed/attack-shaped input rejection.** In Send, select the unreserved synthetic input; enter `<img src=x onerror=alert("QA")>` as recipient, `0.10000000` as amount, and `0.00002000` as fee. The text remains literal in the form; the UI reports `String must be lowercase or uppercase`. Clicking Prepare repeats the validation failure, stays on the form, and does not create another activity record. No JavaScript dialog was present after the check. This is a bounded ordinary-form escaping/validation check, not a comprehensive XSS proof.
6. **Explicit optional saving.** Click `Save watch data locally`. The app confirms public watch data was saved in this browser profile, with no signing keys. The nearby disclosure warns about address/balance privacy and payment recovery records.
7. **Close clears account presentation.** With the malformed form populated and an input selected, navigate to Overview and click `Close account`. The account details and balances disappear, Overview returns to `Data unavailable`, and Send asks to load watch data rather than showing the old form.
8. **Close clears ephemeral form contents.** In the same responsive tab, explicitly Restore after Close, then open Send. Recipient and amount are blank, fee is back to `0.00001000`, selection is zero, and Prepare is disabled. The prior 5 PRL reservation remains locked. This full sequence was repeated in tab 21 after an isolated tab-20 tool timeout.
9. **Reload requires explicit restoration.** Reload while public watch data is saved. Overview is empty until `Restore saved data` is clicked. Restore returns the account and says device verification and node freshness have been cleared. Chain metadata remains unverified.
10. **Clear removes only optional snapshot.** With the account loaded, click `Clear saved watch copy`. The app says the snapshot was removed and the current account/payment recovery records are unchanged. The loaded account remains visible; Activity still has one existing draft, signing remains disabled, and Receive still says saved index 1.
11. **Durable state survives clear and reload.** Reload after clearing, then click Restore: `No locally saved watch data` is shown and balances remain unavailable. Load the bundled example again: the same 5 PRL reservation, one existing draft, and saved receive index 1 reappear. This verifies durable preservation through the UI without reading raw storage.
12. **Navigation interruption.** After Close, navigate the test tab to `about:blank`, then browser Back. The PRL account stays closed with `Data unavailable`. Forward returns to blank; another Back again retains the closed state. In-app Overview/Receive/Send/Activity and review/back transitions also worked.

## Observations and limits

- The Prepare button can become enabled once basic fields/input selection are present even when the inline recipient validator already reports an error. The handler still rejects this invalid recipient without reserving an input. This is a possible minor UX improvement, not an observed funds-safety bypass.
- Tab 20 produced `DOM.getContentQuads`, `Page.getFrameTree`, and `DOMSnapshot.captureSnapshot` protocol timeouts after the first Close/Restore sequence. Tab inventory remained available. A fresh tab 21 successfully repeated the sequence and completed the remaining cases. The cause was not established; this was not reproduced as an application defect.
- The final bounded console sample contained only browser-extension metadata-delivery errors. The sample is not a comprehensive clean-console assertion.
- No physical Ledger, real device approval, signature verification end-to-end, live authenticated node, broadcast, mainnet/testnet funds, hardware fault handling, or emulator/native execution was tested in this lane.
- File-import testing was not attempted because the prior file-upload approval remained pending. No upload alternative was used. No extension installation or external deployment occurred.
- No recovery words, private keys, actual funds, raw browser-profile dump, or private account was accessed. No journal or unrelated saved data was removed.

## Final state

Optional synthetic watch snapshot removed as part of its explicit test. Durable existing payment/range records retained. Responsive tab 21 ends on the closed-account Overview. No application source was changed by this review.
