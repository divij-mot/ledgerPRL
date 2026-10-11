# Pearl Discover listing preparation

Checked against official Ledger documentation on 2026-10-10. This is a local preparation packet, not a submission, partnership, audit certificate, or public catalog approval. The repository remains private. No email, form, PR, repository invitation, license acceptance, or permission change was performed.

## Current position

The public hosted app is available at [pearl-ledger-wallet.vercel.app/live.html](https://pearl-ledger-wallet.vercel.app/live.html). Its developer manifest is [ledger-live.hosted.manifest.json](../apps/companion/ledger-live.hosted.manifest.json). Loading that manifest in a user's Developer-mode Discover list does not add Pearl to everyone else's Discover catalog.

Ledger's current [Discover getting-started guide](https://developers.ledger.com/docs/ledger-live/discover/getting-started) says listings require an invitation. It directs applicants to its [partner intake form](https://docs.google.com/forms/d/e/1FAIpQLSd2e4BAfuZJOUYKhqcxMvMGNY12ShZ-UG5Lu0Se8AIVdlu2lA/viewform) and `discover@ledger.fr`. The linked form returned HTTP 401 to an unauthenticated read during this review. This does not establish whether applications are closed; its current questions and any account-access requirement could not be verified. There is no verified self-service public-catalog publishing API in the inspected documentation.

Pearl uses Wallet API device transport, not the EVM-only dApp Browser. Its custom non-EVM signing flow and requested low-level transport permissions need Ledger's acceptance. A Discover listing would still not make Pearl a native Ledger Wallet Accounts currency or distribute the required device app.

## Private repository boundary

The inspected Discover documentation does not state that a hosted Live App's entire source repository must be public. It also does not promise acceptance of private source. Ask Ledger what review access and contractual terms they require before sharing anything. Do not interpret the manifest's `private` or `branch` fields as GitHub repository visibility controls, and do not flip them to claim approval.

The separate **device-app** [publication terms](https://developers.ledger.com/docs/device-app/submission-process/deliverables/legal) say: “The App you submit must be distributed under an open source license.” The [device release process](https://developers.ledger.com/docs/device-app/submission-process/process) also describes Ledger forking the app repository. This is a real gate for firmware distribution, not evidence that the whole Pearl wallet monorepo must become public. A possible firmware-only publication/review arrangement needs Ledger's confirmation and a separate owner decision. The existing Apache-2.0 upstream file in `apps/ledger-bitcoin-prl/LICENSE` alone does not resolve ownership, distribution terms, or publication authorization for every local addition.

## Prepared Discover facts

These facts can be reviewed locally before any outreach:

| Field | Prepared value or outstanding decision |
| --- | --- |
| Proposed display name | Pearl |
| Current developer app ID | `pearl-hosted`; retain stable identity unless Ledger requests a migration |
| HTTPS entry | `https://pearl-ledger-wallet.vercel.app/live.html` |
| Allowed origin | `https://pearl-ledger-wallet.vercel.app` |
| Intended platforms | Desktop and Android through Ledger Wallet Discover |
| Wallet API permissions | `wallet.capabilities`, `device.transport`, `device.exchange`, `device.close` |
| Current manifest versions | `apiVersion: ^2.0.0`, `manifestVersion: 2` |
| Current developer metadata | `private: true`, `branch: debug`, `categories: [wallet]`, `currencies: "*"`; catalog values remain subject to Ledger review |
| Suggested short description | View, receive, and send Pearl with your Ledger. |
| Product description | Pearl keeps signing on the Ledger device. The hosted wallet reads public chain data through a bounded proxy and keeps its watch view and payment journal in browser storage. It requires the Pearl device app. |
| Organization, legal entity, owner contact | Owner to provide; do not invent these |
| Organization homepage and support URL | Owner-approved public destinations still needed; the current manifest homepage is the app itself |
| Catalog icon and artwork | Owner-approved branding and a stable public icon URL needed; do not substitute Ledger branding |
| Currency/category catalog entry | Ask Ledger how this custom Pearl chain should be represented; `"*"` is current developer metadata, not a claim of supporting every currency |

Ledger's [manifest reference](https://developers.ledger.com/docs/ledger-live/discover/integration/wallet-api/appendix/manifest) identifies app identity, URL, platform, API/schema versions, category/currency selection, descriptive content, permissions, and optional author/homepage/support/icon fields. The installed 4.23.0 schema was independently tested with the existing manifest; use `platforms`, not singular `platform`. A schema-valid developer manifest is not a catalog acceptance decision. No exact Discover screenshot dimensions or final partner-portal field list could be verified from the accessible official pages, so none are invented here.

## Device-app approval gate

The current Pearl firmware is a modified Bitcoin-derived C app at `apps/ledger-bitcoin-prl`, with mainnet name `Pearl` and version `0.1.4`; see the [current installation and physical scope](install-pearl.md). Ledger's current [device getting-started policy](https://developers.ledger.com/docs/device-app/getting-started) requires Rust for new device-app projects, retaining C for existing-app maintenance. Its [Bitcoin clone guide](https://developers.ledger.com/docs/device-app/integration/how-to/clone) describes the Bitcoin Layer-2 extension route; it does not explicitly authorize this separate-chain C fork. Ask Ledger to classify the proposed implementation before a port or further publication work. Existing Bitcoin approval does not transfer automatically.

The [required audit process](https://developers.ledger.com/docs/device-app/submission-process/deliverables/security-audit) requires Ledger functional validation and an approved-partner audit. The page names Nano S Plus, Nano X, Stax and Flex as prerequisites; the newer [Gen5 porting guide](https://developers.ledger.com/docs/device-app/explanation/gen5-porting) also covers Nano Gen5. Confirm the exact current target matrix with Ledger. Our source reviews, CI and Speculos results are supporting evidence, not that vendor validation or an approved human auditor's sign-off. The official audit rules explicitly say AI review supplements rather than replaces human review.

For the subsequent device submission, the official [form checklist](https://developers.ledger.com/docs/device-app/submission-process/submission-form) asks for identity/contact details, app/token name, supported devices, upstream fork and proposed source/PR links, feature or change description, compliance/test declarations, passing official workflows, icons, real-device demo, companion link, tutorial, support channels, and acceptance of publication terms. Unverified declarations must remain unselected. The public HTML and Markdown representations currently link different final device forms; follow the official landing page and obtain the correct route from Ledger rather than assuming an old direct form remains current.

Device icon specifications are separate from a Discover icon: Ledger's [icon guide](https://developers.ledger.com/docs/device-app/submission-process/deliverables/icons) describes Manager artwork and Nano/touch-device icons, including RGB/white-pictogram requirements for Manager artwork and PNG/GIF device assets. Existing local Pearl icon files are preparation assets, not verified approval of the full submission set. Keep them unchanged pending the accepted device route.

## Owner-ready introduction outline — not sent

The publicly readable [foundations contact form linked by Ledger](https://docs.google.com/forms/d/e/1FAIpQLScc_luftAe3Y9f7Y89aGjCa-z3XPOf1cVfIEeOZzhgx71MYbQ/viewform) currently requires first name, last name, project name, contact information, project description, and the requested help from Ledger. It is an introduction route, not proof of Discover acceptance. Supply personal/business details only after the owner chooses to contact Ledger.

Proposed project description:

> Pearl is a hosted wallet for the Pearl chain, with desktop and Android Ledger Wallet Discover integration through Wallet API device transport. The app is live at https://pearl-ledger-wallet.vercel.app/live.html. Keys and signing remain on the Ledger device; the server has no wallet database or account history store. Our repository is private. We seek guidance on a public Discover listing and on distribution of the required Pearl device app.

Proposed questions for Ledger:

1. Is Pearl eligible for a Discover invitation, and what is the current intake route and asset checklist?
2. Can the hosted source remain private, and what narrowly scoped review access is required?
3. Are these four device-transport permissions and the custom Pearl clear-signing flow acceptable for desktop and Android?
4. Does this Bitcoin-derived C fork qualify for an existing/clone route, or must the device implementation move to Rust?
5. What firmware-source disclosure, supported-device matrix, functional-validation and approved-auditor steps are required before distribution?

Available evidence includes [live deployment checks](../tools/hosted-wallet-review/deployment.md), [manifest validation](../tools/hosted-wallet-review/manifest-validation.json), [signing-denial emulator evidence](../tools/signing-denial-review/README.md), and [pending-status verification](../tools/pending-status-review/README.md). Share only an owner-reviewed subset if Ledger requests it. Physical Android Discover qualification, complete retail-device coverage, vendor approval and public device-app distribution remain distinct from these software checks.
