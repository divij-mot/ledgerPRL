# Pearl Live App

Pearl has a separate desktop Live App entry at `/live.html`. It uses Ledger Wallet's connection dialog and Wallet API transport with the existing Pearl wallet and Bitcoin-derived PRL protocol. The ordinary browser entry retains its explicit WebHID connection. Opening the Live App in a browser does not silently switch to WebHID.

This is a developer-loaded app, not native Pearl Accounts support, a public Discover listing, or Ledger endorsement. Mobile is not enabled in the manifest: a responsive page alone does not establish mobile host or device compatibility.

## Local setup

Use the repository's Node requirement, then run from the repository root:

```sh
npm ci --ignore-scripts
npm run setup:light
npm start
```

`setup:light` requires Python 3, Go (selected version 1.26.6), Cargo/Rust 1.90.0, a C compiler and make. It downloads the checksum-pinned official Pearl source, builds its native XMSS/ZK libraries, tests and builds the watch-only helper, and records its executable/source identity under `.tools/light-client`. Repeat it after helper source changes. It does not install anything on Ledger.

`npm start` builds the frontend, then serves the app and native sync middleware at `http://127.0.0.1:5188/live.html`. Keep that terminal running. The process starts the helper only when an account needs local synchronization. No full-node credentials, separate wallet window or cloud service are required. `npm run dev` and `npm run preview` are development alternatives with the same local middleware; a static file server alone is insufficient. Stop the existing server before starting another on port 5188.

Keep the exact hostname and port: `localhost` is a different origin with different browser storage. The local manifest is [apps/companion/ledger-live.manifest.json](../apps/companion/ledger-live.manifest.json). The supported default is mainnet account 0. Approved/imported public account data can be remembered locally; reopening resumes sync but never restores device approval. Receive still requires a freshly checked Ledger address, and sending requires fresh device review and a separate broadcast action.

Browser checks can exercise layout, recovery and the unavailable-host state before the hardware is needed. A mock Wallet API host exercises transport failures and protocol boundaries; it does not qualify Ledger Wallet or the physical signer.

When explicitly proceeding with local host integration:

1. In Ledger Wallet, open Settings → About and click the version ten times to expose Developer settings.
2. Enable **Allow debug apps**, then use **Add a local app** to import the manifest. Platform dev tools are optional for diagnosis. Keep the normal catalog provider.
3. Open Pearl from Discover while the local server is running. The page must load and remain usable without connecting hardware.
4. Only after the exact device app is qualified and its installation separately approved, manually open that PRL app on the signer and click Connect in Pearl.

On 10 October 2026, the owner approved enabling debug apps and importing this exact local manifest. Both actions completed in installed Ledger Wallet 4.23.0, and Pearl rendered in Discover. Its Connect action reached the native Nano S Plus locked-device dialog. No app was installed on the device and no seed, firmware or device security setting was changed. Ledger documents the developer-mode and local-import controls in its [developer guide](https://developers.ledger.com/docs/ledger-live/discover/references/developer-mode).

## Host and transport boundary

The installed macOS Ledger Wallet **4.23.0** was inspected read-only on 10 October 2026. The version came from `/Applications/Ledger Wallet.app/Contents/Info.plist`; executable code came from `Contents/Resources/app.asar`. No private Ledger user data or physical device was read during that inspection.

| Installed artifact                               | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `app.asar`                                       | `be3bb14a235087969f285e29d44ac2d32d127c48bd6aa29fb705bd0c8802bd19` |
| `.webpack/renderer.bundle.js` inside the archive | `936ae9c4eaf9c38bbb58bd1337cab3cffbbd5bf658769938b371a49124f6ff02` |

The installed host's manifest validator requires plural `platforms`, plus `visibility`, localized descriptions and nonempty domains/categories. Its `currencies` field accepts `"*"`; this does not identify Pearl as a supported Ledger currency. The manifest requests exactly four method permissions. It omits account access, transaction signing APIs, user identification, storage APIs and the EVM `dapp` section. The current [manifest reference](https://developers.ledger.com/docs/ledger-live/discover/references/manifest) contains older singular-`platform` examples; the installed validator is the compatibility reference here.

`wallet.capabilities` lists installed handlers, independently of the manifest's permission checks. All three device methods must be supported and explicitly permitted. The [Device module](https://developers.ledger.com/docs/ledger-live/discover/integration/wallet-api/core/modules/device) returns a Ledger transport; the Pearl adapter uses raw `exchange`, retaining status words such as continuation `0xe000`.

The connection request uses an exact network-specific app name, currently `device.transport({appName: "Pearl"})` for mainnet. The earlier physical evidence used **Pearl Dev**; it does not qualify the renamed **Pearl 0.1.0** binary, which must be installed only with the owner’s separate approval. A physical test showed that omitting the name defaults to BOLOS and sends the device back to its dashboard. Manually opening the matching installed PRL app allows the host to match its name without depending on catalog metadata for an unpublished app. The Live App defaults to mainnet; standalone development defaults are unchanged. Pearl's own protocol capability and network checks reject an incompatible response before deriving accounts or signing. These checks are not firmware attestation. Do not add `appVersionRange` to this host without rechecking: 4.23.0's handler rejects when its supplied semver range _matches_ the returned version.

The host maintains one transport and returns ID `"1"`; its close handler operates on that shared transport. Teardown must finish before reconnecting. An unresolved open, exchange or close requires reopening the Live App rather than allowing stale cleanup to close another session. Cancelling the host request cannot promise to dismiss a physical review. A winning valid signature response still needs independent verification and durable recovery before any final protocol acknowledgement.

Desktop uses an Electron `webview`, whose preload exposes `ElectronWebview.postMessage`. The host responds through `contentWindow.postMessage` targeted to the app origin. Keep `frame-ancestors 'none'` and `X-Frame-Options: DENY`: this desktop integration does not require allowing arbitrary iframes. The Live entry requires the native bridge and must not fall back to cross-origin iframe messaging. See Ledger's [WalletAPIWebview](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/ledger-live-desktop/src/renderer/components/Web3AppWebview/WalletAPIWebview.tsx) and [device host implementation](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/wallet-api/react.ts).

Ledger adds `theme` and `lang` query parameters when launching the app. The production server must accept bounded launch parameters for `/live.html` while retaining strict routing elsewhere. Same-origin indexer requests retain their origin, host and request-header checks; no public CORS API is needed.

The stable `cacheBustingId: 1` selects persistent host storage `persist:pearllocal-1`. Changing the manifest ID, cache-busting ID or origin changes the storage location and can hide existing reservations and signed-payment recovery. Preserve these values during upgrades and export the recovery backup before intentional migration. Host URL handling and storage partitioning are implemented in Ledger's [webview helpers](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/ledger-live-desktop/src/renderer/components/Web3AppWebview/helpers.ts).

## Qualification boundary

Read-only host inspection confirms code paths, not a successful end-to-end run. Record browser, actual host, cancellation/reconnect, storage recovery and physical-device results separately. Current-source Nano S Plus mainnet/regtest builds and limited public-seed signing/rejection replays now pass in Speculos; exact evidence and remaining device gates are in [firmware status](firmware.md) and the [native checkpoint](../tools/live-app-native-review/README.md). Those direct emulator tests do not establish the Ledger Wallet bridge or physical-device behavior. Historical binaries and Rust tests remain separate evidence. Device installation, firmware/security changes, seed reset and real-fund tests are not part of loading this local web app.

## Dependency notices

The native helper adds official Pearl wallet/node, Neutrino, XMSS and ZK-proof libraries. Their upstream source notices must be preserved alongside npm/UI notices before distributing a binary. The [local light-client design](../tools/light-client-review/design.md) records the source pin and ISC/MIT/Plonky2 license boundaries; the browser-only notice inventory does not cover the linked native dependency graph. The project still has no license grant for newly authored code.

The developer app serves [third-party notices](../apps/companion/public/third-party-notices.txt) for the measured browser entries, shared code, CSS and worker. Lumen's exact release-tag Apache-2.0 license and the separate Wallet API client's Apache license are retained. The CSS inventory includes the Lumen design-core preset even though it runs during the build.

`@ledgerhq/wallet-api-core@2.1.0` declares MIT but omits its license/copyright body in both the published package and exact source tag. The inventory preserves that declaration and explicitly records the unresolved attribution gap; it does not assign the client's Apache license to core. Obtain the applicable missing notices from upstream before public distribution. The pinned Ledger transport/logging packages also omit license files; their exact Apache declarations and standard ASF license terms are retained without inventing copyright holders. See [supplemental provenance](../tools/dependency-supply-review/upstream-notices/README.md). These records are attribution evidence, not legal review or security qualification.


## Bitcoin UI source and verification

Send and Receive adapt the pinned Ledger Wallet 4.23.0 Bitcoin flow views: Recipient → Amount → Summary → Device → Confirmation, and Account → Device → Receive. The [retained upstream originals and reproducible patch](../apps/companion/vendor/ledger-live-4.23.0/README.md) document the exact changes. Host Redux/Electron/analytics dependencies become PRL display props and existing handler IDs; the PRL wallet engine still owns signing, recovery and explicit broadcasting. The account surface uses the installed Ledger fonts and colors; these are adapted views, not an unmodified native Accounts integration.

Final local checks on 10 October 2026:

- `npm run check`: 489 tests passed across six workspaces; TypeScript, production builds and tracked-source secret-pattern scan passed. A supplementary run of the same patterns over tracked and untracked files passed for 1,860 files.
- Dependency/source inventory: 755 checks and four notice tests passed, including reconstruction of all copied UI adaptations and exact emitted font bytes. The locked dependency audit reported no advisories.
- Chrome exercised the real Recipient → Amount → Summary flow with synthetic public data: 1 PRL plus 0.00001000 PRL fee displayed exactly as 1.00001000 PRL. Escape closed the modal without dropping its unsigned reservation; explicit discard removed the test drafts. Receive progressed to the device step and exposed no usable Copy control without verification.
- A 390 × 844 viewport fit the summary without horizontal overflow. Exact Inter 400/600 fonts loaded. Routine graphics, duplicate branding and the companion sidebar were removed; account/recovery settings remain behind Settings.
- The ordinary browser rejected `/live.html` connection without silently switching to WebHID. Installed Ledger Wallet accepted the manifest and reached its native connection dialog. Hardware signing and cancellation/reconnect with an unlocked physical signer remain untested.
- Live Testnet2 status/genesis validation succeeded once in an earlier check. The latest [read-only public-source recheck](../tools/live-app-public-review/README.md) used the real `BlockbookSource` and existing port-5188 same-origin proxy: both mainnet and Testnet2 status/genesis calls timed out before any address query. Independent normal-TLS curl requests also timed out before TCP/TLS connection. Results remain unavailable rather than a substituted zero balance; live-chain balance discovery, broadcasting and confirmation are **not established**.
- Current-source Nano S Plus mainnet/regtest emulator runs cover both P2TR and P2MR recipients, exact amount/fee/address review and independently checked signatures. See [native evidence](../tools/live-app-native-review/README.md), including 75 malformed-request rejections and explicit rejection/fresh approval.

The dev server uses port 5188 to avoid an unrelated service worker found at the usual port 5173. No other app's storage or service worker was removed. These are local changes; no public deployment, repository push or vendor submission was performed.

## Entry isolation

The web and Discover entries register their transport once before loading the common wallet. The browser graph excludes Wallet API, and the Discover graph excludes DMK/WebHID. A missing or mismatched registration fails closed. WebHID discovery starts synchronously within the connect gesture. Production graph tests traverse imports from both HTML entries, including the common wallet and external backup validator worker.

## Physical checkpoint

The [recorded Nano S Plus test](../tools/live-app-physical-review/README.md) now covers the actual Wallet API public-account and verified Receive flows. The synthetic signing checkpoint used direct HID; Wallet API signing, cancellation and reconnect remain separate qualification work. No live transaction was broadcast.
