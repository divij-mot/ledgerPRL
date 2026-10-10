# Hosted release checkpoint — 10 October 2026

Production is live on Vercel Hobby:

- [Desktop WebHID wallet](https://pearl-ledger-wallet.vercel.app/)
- [Ledger Discover entry](https://pearl-ledger-wallet.vercel.app/live.html)
- Source commit: [`e6b0ff154faf2dc177457400baeb38005b0e12a7`](https://github.com/divij-mot/ledgerPRL/commit/e6b0ff154faf2dc177457400baeb38005b0e12a7)
- Deployment: `dpl_7YzB4AnkdoW77CRSNNoXfiFBUDw2`, production READY, as confirmed by the parent.

## Verified release evidence

The final local `npm run check` passed **568/568** checks, typechecks and production builds. Release `e6b0ff1` [CI run 38090567445](https://github.com/divij-mot/ledgerPRL/actions/runs/38090567445) passed all four jobs: host, Pearl oracle, Rust core and native local-light-client; the parent’s completed watch returned exit 0. Later source changes require separate CI.

The independent deployment reviewer ran **17/17 passing live checks** against this production origin: Discover page, security/cache headers, real anonymous status request, fixed-route/origin/consent validation, oversized/compressed-body rejection, and 404 responses for native/private/local-only paths. A consent-false broadcast request was rejected before submission; no valid broadcast payload, wallet address or private account data was used. [Results](preview-results.json), [review](deployment.md).

All **15 public files**, totaling **2,222,424 bytes**, matched the reviewed prebuilt SHA-256 values. Two immediately preceding responses were reused; 13 additional reads completed the comparison. Private server-function identity is bound through the reviewed prebuilt artifacts and parent-owned prebuilt deployment, not by downloading function code from the public site. [Byte comparison](deployed-byte-comparison.json), [prebuilt validation](prebuilt-validation.json).

The parent’s error-level log query for this exact deployment over the preceding hour returned zero records; this is a bounded log observation, not an uptime guarantee.

The parent separately observed Chrome loading the production wallet with its network-service indicator available. That is a browser/UI observation, not a physical Ledger signing test.

The [current C-signer/regtest roundtrip](simulator/README.md) passed **16/16** cases, including real node acceptance and mined confirmation for P2TR/P2MR recipients using only the public fixture seed. The [final fee/QR/cache review](README.md) passed 46 focused cases. These retain their own source/artifact identities and scopes.

## Discover loading and remaining limits

Use [apps/companion/ledger-live.hosted.manifest.json](../../apps/companion/ledger-live.hosted.manifest.json), which names the exact production `/live.html` origin, desktop/Android platforms and four Wallet API permissions. It passed the installed Ledger Wallet 4.23.0 schema checks. **Owner-approved desktop import subsequently succeeded**, and the exact production page opened at Add account. The schema record predates that import. No Android import or hosted outgoing-payment qualification is claimed. Deployment does not create a public Discover listing. The localhost developer manifest remains separate. [Manifest validation](manifest-validation.json), [loading instructions](../../docs/live-app.md).

Native Android testing was explicitly declined; no stock Android WebView, phone camera/permissions, USB/BLE or hardware-flow qualification is claimed. The separately recorded owner-approved Pearl 0.1.0 Nano S Plus installation and account/Receive checks do not establish independently observed destination confirmation. The owner later reported submission shown accepted with pending own change; that bounded observation is recorded below.

Hosted functions retain no application account database/server wallet profiles; the client stores its display cache and recovery journal. Hosted indexer trust differs from local native SPV. Infrastructure metadata, request budgets, provider availability and cost limits remain as described in the [deployment review](deployment.md). The [Wallet API core attribution gap](../dependency-supply-review/core-attribution-recheck.json) remains unresolved; no blanket licensing/security audit or Ledger approval is implied.

This documentation update changes no production code or shipped notices. No personal addresses, balances, transaction IDs or wallet files are retained in this release record.

## Later owner-approved observations and source follow-up

The parent imported the hosted manifest into desktop Ledger Wallet and opened the exact production `/live.html` URL at its Add account screen. This is an actual desktop manifest/load observation; no hosted outgoing transaction or native Android check is implied. At the owner’s explicit request, Pearl Dev was removed from the device. App enumeration confirmed its removal while Pearl retained installed-app hash `22c0f2fd025c73c9713ea39b3ecf525b4e617d0ff74a9213d51800543ecbbda7`.

The latest source follow-up simplifies hosted discovery to one **Sync** action and adopts the reviewed current-initial-attempt no-result cleanup policy. Those source changes require their own subsequent release/deployment record; they are not retroactively attributed to the `e6b0ff1` deployment above. The older interrupted user record was preserved, with no automated migration or deletion. Outgoing mainnet payment qualification remains open.

The owner subsequently reported an outgoing mainnet submission, and UI/public-source evidence showed acceptance with pending own change. Recipient confirmation is not independently established. No wallet amount, address, recipient or transaction ID is retained in this report. A later deployment for the balance/result-policy/pending-monitor source changes will be recorded only after confirmation; it is not implied by the earlier release above.
