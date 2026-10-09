# Combined final-build real-browser smoke

Date: 2026-10-09, 23:56 UTC. Reviewer: Astra.

This fresh bounded check followed an interrupted review session. Its results come from direct browser observations; earlier progress summaries are not used as evidence. This supersedes the qualification status in `astra-real-browser-combined-smoke-interrupted-2026-10-09.md`.

## Identity

- Cloud Chrome test browser, `http://127.0.0.1:5173/`.
- Live DOM script: `/assets/index-d0S-5XX6.js`.
- Independently checked local bundle SHA-256: `4202b471db46fbd8b8f0d58136ea54994775d34eb7e5a2bded55c606267e7ea1`.
- Independently checked `apps/companion/src/main.ts` SHA-256: `ce0b26e6520f210bf57f633469da5ab1821f18e423926422ffc5c4568cce3292`.
- Independently checked `packages/wallet/src/discovery.ts` SHA-256: `4f003ef5792ef1088f5fcd60f895d0ae7c787e80e9276a1787dc194ba07df8a2`.
- All three hashes match the frozen combined build supplied for review. Prior CpBl0wyO results are separate evidence and were not substituted for these checks.

## Directly observed passes

1. Initial page is closed-account Overview with `Data unavailable`.
2. Explicit Restore loads the existing synthetic fixture and reports cleared device verification/node freshness. Chain metadata remains unverified; 1.25 PRL is eligible and the prior 5 PRL reservation remains visible.
3. Navigation through Overview, Receive, Send, and Activity renders each expected view. Receive says `Not device verified`, with Verify and Copy disabled and saved receive index 1. Send shows zero selected inputs and the reserved output disabled. No payment was prepared.
4. Activity displays exactly one pre-existing draft. It was not reviewed, altered, discarded, or archived during this bounded pass.
5. Close returns to `Data unavailable`. A subsequent reload retains the closed-account presentation.
6. Warning/error sample: limit 100, 14 entries returned. All 14 originate from a browser-extension content script and report browser-metadata delivery errors. No app-origin error or visible render failure was observed in this sample. No browser protocol failure or denied tool call occurred.

## Limits and preserved state

This is a normal-flow smoke, not a test of failed physical-device sessions, live discovery consistency, cancellation/storage races, signing, emergency recovery, or remote indexers. No hardware or verified device session was used. No upload, native build/harness, transaction, live node/indexer call, journal deletion, new account, installation, or bypass/reroute occurred. The original synthetic snapshot, saved range, and existing journal remain intact. Finished at closed-account Overview; no application source was modified by this reviewer.
