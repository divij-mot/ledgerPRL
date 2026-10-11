# Host integrity/privacy checkpoint

## Later host boundary replay

`boundaries-check.log` records the subsequent aggregate on 2026-10-09 at
approximately 22:50 UTC: all typechecks, 420 tests (companion increased to 134),
production build and tracked-file secret scan passed. This includes strict
network/address validation before public indexer requests, empty-scriptSig relay
validation and the bounded third-party-notices route. The emitted main asset is
`index-BPR0Pkw2.js`; the backup worker is unchanged. The dependency graph and
distributed notices were independently regenerated and checked. This later
checkpoint does not extend any native, physical-device or live-network claim.

## Earlier storage/privacy replay

The aggregate `npm run check` completed successfully on 2026-10-09 at
approximately 22:42 UTC. The included log records all workspace typechecks,
415 passing tests, production builds and the tracked-file secret-pattern scan.
Counts: adapter 27, optional Snap 64, SDK 103, wallet 86, CLI 6, companion 129.

This run includes the stored-journal validation, atomic recovery merge,
snapshot-only cache deletion, payment form reset, and their regressions.
The initial replay found only a stale test-harness count (19 instead of 21
after adding two cache-deletion cases); the assertion was updated and the
entire aggregate was rerun successfully. No failing case was removed.

The production main bundle is `index-B9WJtHC4.js`, SHA-256
`4062ec6b173da7cb05dbc27a91928225571530a88171b47d2fbde8f1b4b671e0`.
The independent real-browser report is
[here](../../apps/companion/test/evidence/website-qa/astra-real-browser-2026-10-09.md).

These are host/mocked-transport and public-fixture UI results. They do not
qualify a physical Ledger, the latest native ELF, a public TLS deployment,
live indexer availability, real-network transaction acceptance, or security
against every attack. Historical native evidence retains its own source and
artifact identity. The scan does not replace manual secret review.
