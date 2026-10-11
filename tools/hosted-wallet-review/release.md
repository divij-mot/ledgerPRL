# Production release — 10 October 2026

- [Desktop WebHID wallet](https://pearl-ledger-wallet.vercel.app/)
- [Ledger Discover entry](https://pearl-ledger-wallet.vercel.app/live.html)
- Source: [`fca78a828362ea2d65cfe10872ca57626c52b866`](https://github.com/divij-mot/ledgerPRL/commit/fca78a828362ea2d65cfe10872ca57626c52b866)
- Vercel production: `dpl_FDmzyLPoeqC3DyQYyucY1bs72fUp`, confirmed live on the canonical Hobby-project origin.
- CI is tracked separately in [run 38093601532](https://github.com/divij-mot/ledgerPRL/actions/runs/38093601532); this document does not assert its completion state.

## What shipped

The same wallet runs locally through `python3 scripts/run-local.py` with native Pearl SPV, or hosted through the stateless public-indexer adapter. The launcher opens `/` for desktop WebHID; Discover uses `/live.html` and needs no running Mac.

The update ships total-unspent **Balance** in Portfolio, separate stricter Send availability, one hosted **Sync** action, fresh manual payment-status discovery and a bounded visible/idle pending-transaction monitor. No optimistic balance subtraction was added. A current initial signing attempt clears only before adapter signing is invoked or after engine unwind without a complete verified app result, with atomic ownership checks. Complete signed results, historical/recovery uncertainty and concurrent changes remain protected. The older interrupted user record was not automatically changed.

## Verification

- Final local `npm run check`: **587/587 passed**, with typechecks and production builds, as reported by the parent.
- Live deployment: **17/17 boundary checks passed**. These cover the Discover page, CSP/cache/security headers, actual anonymous public status, rejected origins/unsupported requests, body bounds and 404s for native/private/local-only paths. A consent-false broadcast request was rejected before submission; no valid broadcast payload or personal account data was used. [Results](preview-results.json), [deployment review](deployment.md).
- All **15 public files**, totaling **2,227,051 bytes**, matched the reviewed prebuilt SHA-256 values. Private function identity is bound through the reviewed prebuilt artifacts and parent-owned prebuilt deployment, not a public function-code download. [Byte comparison](deployed-byte-comparison.json), [prebuilt validation](prebuilt-validation.json).
- The parent reloaded the production Chrome page and observed the corrected Balance headline, single Sync action and available network services. The sender wallet's freshly synced view showed the outgoing payment as confirmed. This is a sender/public-source observation, **not independent observation in the recipient wallet**. No amount, address, recipient or transaction ID is retained here.
- Independent result-policy UI: **24/24 cases passed**, including total-versus-available balance, initial cleanup, recovery/concurrency retention, complete-result preservation and the pre-adapter gap. The **15/15** composed payment histories passed with production source unchanged. The two adapted legacy wrappers passed all **18 and 19** underlying probes. [Review](explicit-rejection-review.md).
- Adapter result classification and pending-state refresh have separate [adapter](signing-result-adapter-review.md) and [pending monitor](../pending-status-review/README.md) reviews. Earlier **16/16** C-firmware → real Pearl regtest cases retain their exact source/node/firmware identities in [simulator evidence](simulator/README.md); they are not historical Rust results.

## Discover, hardware and limits

The [hosted manifest](../../apps/companion/ledger-live.hosted.manifest.json) passed Ledger Wallet 4.23.0 schema checks and was imported with owner approval into desktop Ledger Wallet. Its exact production page opened at Add account. Deployment does not create a public Discover listing. [Loading instructions](../../docs/live-app.md).

Pearl 0.1.0 was installed with owner approval on the recorded Nano S Plus OS 1.7.0, and account/Receive verification passed. At the owner's request, Pearl Dev was later removed; Pearl's installed-app hash remained `22c0f2fd025c73c9713ea39b3ecf525b4e617d0ff74a9213d51800543ecbbda7`. These observations do not qualify all hardware models or failure/recovery conditions.

Native Android SDK testing was declined. Android evidence remains source, simulated Wallet API and responsive-browser checks; stock Android WebView, permissions and device transport are not qualified. Hosted indexer trust remains distinct from local native SPV. There is no application server database/account profile, but infrastructure metadata, provider availability, request budgets and costs still apply. The [Wallet API core attribution gap](../dependency-supply-review/core-attribution-recheck.json) remains unresolved; no blanket licensing/security audit or Ledger approval is implied.

## Previous baseline

The earlier `e6b0ff154faf2dc177457400baeb38005b0e12a7` deployment was `dpl_7YzB4AnkdoW77CRSNNoXfiFBUDw2`. It had 568 passing local checks, 17 passing live checks and 15 matching public files totaling 2,222,424 bytes. Its [CI run 38090567445](https://github.com/divij-mot/ledgerPRL/actions/runs/38090567445) passed all four jobs. Those are historical baseline results, not the counts or CI status of this update.

This final documentation pass changes no production code or notices and contains no personal wallet values, transaction identifiers or wallet files.
