# Pearl Live App

Pearl shares its wallet UI and signing/recovery engine between `/` (direct desktop WebHID) and `/live.html` (Ledger Wallet API inside Discover). The local launcher opens `/` and runs native SPV. The hosted `/live.html` entry supports independent desktop/iOS/Android clients through the fixed public-indexer API; it does not launch a native helper on the phone.

The production origin is **[pearl-ledger-wallet.vercel.app](https://pearl-ledger-wallet.vercel.app/)**, with [`/live.html`](https://pearl-ledger-wallet.vercel.app/live.html) for Discover and `/` for desktop WebHID. Release `3a4d1cc` is deployed and passed the [18 live boundary and 16 public-file checks](../tools/ble-exit-review/release.md). Desktop uses [ledger-live.hosted.manifest.json](../apps/companion/ledger-live.hosted.manifest.json); phones use [ledger-live.mobile.manifest.json](../apps/companion/ledger-live.mobile.manifest.json). Both share the same app identity, HTTPS origin and four permissions and pass the installed Ledger 4.23.0 schema validator. The mobile manifest omits cache busting; the desktop setting stays unchanged. **Owner-approved desktop manifest import succeeded**, and the exact hosted page opened with Add account. Successful physical mobile Bluetooth account approval remains under investigation; publication of the web page does not add it to the public catalog automatically. The separate localhost manifest remains a desktop development option.

This remains a developer-loaded app, not native Pearl Accounts support, a public Discover listing or Ledger endorsement. Pinned mobile source exposes raw Wallet API device transport; simulated bridge and responsive-browser checks do not qualify real iPhone/Android WebView, camera permissions or hardware transport. See the [Android assessment](../tools/hosted-wallet-review/android-assessment.md).

## Load the hosted entry in Discover

On desktop Ledger Wallet, enable Developer settings from Settings → About, enable Allow debug apps, then use Add a local app to import [ledger-live.hosted.manifest.json](../apps/companion/ledger-live.hosted.manifest.json). Open its Pearl entry in Discover; it loads the hosted `/live.html` URL and needs no local server. Do not substitute the localhost manifest or change its URL/domain independently.

### iPhone with Nano Gen5 or Flex over Bluetooth

1. Install **Pearl 0.1.2** for your exact device using the [installation guide](install-pearl.md). Version 0.1.0 is USB-only; update 0.1.1 before testing Gen5 Bluetooth.
2. Pair your Ledger in the iPhone **Ledger Wallet** app, then open Pearl on the device.
3. Open the [mobile manifest](https://pearl-ledger-wallet.vercel.app/ledger-live.mobile.manifest.json) and copy its complete JSON contents. Use this phone-specific file, not the desktop hosted manifest.
4. In Ledger Wallet, open **Settings → Developer**, enable **Allow debug apps**, then open **Load Platform Manifest** (the next screen is titled **Load Manifest**).
5. Tap **Paste**, then **Add**, and open **Pearl** under **Loaded Manifests**. It loads the hosted wallet; no Mac or local server is needed.
6. Tap **Add account**, select the paired Ledger, approve the public account, then use **Receive** to compare the complete address before sending.

If you previously imported the desktop hosted manifest on your phone, repeat steps 3–5 once with the mobile file. Add replaces the entry with the same `pearl-hosted` identity and origin; it does not require clearing wallet data. The mobile file avoids a [reproduced native cache-busting load race](../tools/mobile-transport-review/persistence-timeout-review.md) that can erase saved custom manifests. It does not fix the separate Bluetooth approval failure; actual restart persistence still needs a phone check. Continue using the existing hosted manifest on desktop.

These menu labels and the iOS device bridge are verified against the pinned Ledger mobile source. They may differ in another app version. The same custom-manifest screen exists on Android. Software bridge/emulator tests do not establish physical Bluetooth pairing; test that on your device. The older desktop localhost import is independent and is not needed on your phone.

Stock iPhone Safari cannot connect directly over Bluetooth. [Ledger Wallet Provider](https://developers.ledger.com/docs/ledger-wallet-provider/overview) also excludes mobile browsers. The iPhone route here uses Ledger Wallet's native Bluetooth connection; desktop Chrome/Edge continue to connect directly by USB without Ledger Wallet. Public Discover catalog listing still requires Ledger's separate approval.

## Local setup

Install the prerequisites once:

- [Node.js](https://nodejs.org/en/download): select a 24.x release at least 24.19, use its normal installer for your system, then open a new terminal. npm is included. The launcher uses the normal `node` and `npm` commands.
- [Go](https://go.dev/doc/install): the build selects its pinned Go 1.26.6 toolchain.
- [Rust/Cargo](https://rust-lang.org/tools/install/): after installing rustup, run `rustup toolchain install 1.90.0 --profile minimal`.
- Python 3 and C/C++ build tools. On macOS, install Command Line Tools with `xcode-select --install` if they are absent. On Linux, install your distribution’s compiler/make/archiver packages so `/usr/bin/gcc`, `/usr/bin/g++`, `cc`, `ar`, and `make` exist.

The launcher checks these requirements and stops with an explanation if something is missing; it does not silently install global software or accept installer terms.

Download and extract the source using the [ZIP instructions](../README.md#3-or-run-it-locally), or use a checkout. The repository is currently private, so GitHub download access requires a signed-in collaborator. Git and `.git` are not required for the local build. On macOS or Linux, run from the extracted repository root:

```sh
python3 scripts/run-local.py
```

The launcher requires Python 3, Node 24.19 or newer 24.x, and npm. It installs the locked dependencies with `npm ci --ignore-scripts --include=dev`. When the native helper is absent or stale, it checks for Go, Cargo, rustup with Rust 1.90.0 already installed, `cc`, `ar`, make and the C/C++ compiler paths `/usr/bin/gcc` and `/usr/bin/g++` required by upstream XMSS before calling the existing `setup:light` build (which selects Go 1.26.6). It downloads the checksum-pinned official Pearl source, builds its native XMSS/ZK libraries, tests and builds the watch-only helper, and records its executable/source identity under `.tools/light-client`. The launcher compares the complete Go/module source set, its SHA-256 hashes, upstream identity, private artifact paths and executable SHA-256; a matching helper is reused. Failed installation/build/verification stops startup. It does not install global toolchains, change shell profiles or install anything on Ledger. Direct `npm run setup:light` remains available for a deliberate rebuild. The first native build and initial chain synchronization can take substantial time. Later starts still run the locked npm install and frontend build. Keep the same folder to reuse `.tools/light-client` and local chain/watch state; moving it can invalidate the native manifest’s absolute executable path. The launcher never chooses another port when 5188 is occupied.

After preparation, the launcher replaces itself with the existing `npm start`, which builds the frontend, then serves the app and native sync middleware at `http://127.0.0.1:5188/live.html`. The one-command launcher opens `http://127.0.0.1:5188/` after successful listening for standalone WebHID use in Chrome/Edge. That browser entry is distinct from `/live.html`, the Ledger Discover entry. Ordinary `npm start` prints both addresses and does not open a browser. Keep the terminal running; Ctrl-C stops the foreground process. No background daemon is installed. The process starts the helper only when an account needs local synchronization. No full-node credentials, separate wallet window or cloud service are required. `npm run dev` and `npm run preview` are development alternatives with the same local middleware; a static file server alone is insufficient. Stop the existing server before starting another on port 5188.

Keep the exact hostname and port: `localhost` is a different origin with different browser storage. The local manifest is [apps/companion/ledger-live.manifest.json](../apps/companion/ledger-live.manifest.json). The supported default is mainnet account 0. Approved/imported public account data can be remembered locally; reopening resumes sync but never restores device approval. Receive still requires a freshly checked Ledger address, and sending requires fresh device review and a separate broadcast action.

Browser checks can exercise layout, recovery and the unavailable-host state before the hardware is needed. A mock Wallet API host exercises transport failures and protocol boundaries; it does not qualify Ledger Wallet or the physical signer.

When explicitly proceeding with local host integration:

1. In Ledger Wallet, open Settings → About and click the version ten times to expose Developer settings.
2. Enable **Allow debug apps**, then use **Add a local app** to import the manifest. Platform dev tools are optional for diagnosis. Keep the normal catalog provider.
3. Open Pearl from Discover while the local server is running. The page must load and remain usable without connecting hardware.
4. Only after the exact device app is qualified and its installation separately approved, manually open that PRL app on the signer and click Connect in Pearl.

On 10 October 2026, the owner approved enabling debug apps and importing this exact local manifest. Both actions completed in installed Ledger Wallet 4.23.0, and Pearl rendered in Discover. Its Connect action reached the native Nano S Plus locked-device dialog. At that earlier manifest-loading checkpoint, no app was installed on the device and no seed, firmware or device security setting was changed. The later owner-approved Pearl 0.1.0 installation is recorded below. Ledger documents the developer-mode and local-import controls in its [developer guide](https://developers.ledger.com/docs/ledger-live/discover/references/developer-mode).

## Host and transport boundary

The installed macOS Ledger Wallet **4.23.0** was inspected read-only on 10 October 2026. The version came from `/Applications/Ledger Wallet.app/Contents/Info.plist`; executable code came from `Contents/Resources/app.asar`. No private Ledger user data or physical device was read during that inspection.

| Installed artifact                               | SHA-256                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------ |
| `app.asar`                                       | `be3bb14a235087969f285e29d44ac2d32d127c48bd6aa29fb705bd0c8802bd19` |
| `.webpack/renderer.bundle.js` inside the archive | `936ae9c4eaf9c38bbb58bd1337cab3cffbbd5bf658769938b371a49124f6ff02` |

The installed host's manifest validator requires plural `platforms`, plus `visibility`, localized descriptions and nonempty domains/categories. Its `currencies` field accepts `"*"`; this does not identify Pearl as a supported Ledger currency. The manifest requests exactly four method permissions. It omits account access, transaction signing APIs, user identification, storage APIs and the EVM `dapp` section. The current [manifest reference](https://developers.ledger.com/docs/ledger-live/discover/references/manifest) contains older singular-`platform` examples; the installed validator is the compatibility reference here.

`wallet.capabilities` lists installed handlers, independently of the manifest's permission checks. All three device methods must be supported and explicitly permitted. The [Device module](https://developers.ledger.com/docs/ledger-live/discover/integration/wallet-api/core/modules/device) returns a Ledger transport; the Pearl adapter uses raw `exchange`, retaining status words such as continuation `0xe000`.

The connection request uses an exact network-specific app name, currently `device.transport({appName: "Pearl"})` for mainnet. The current **Pearl 0.1.0** binary has now been installed with owner approval on the recorded Nano S Plus OS 1.7.0, and account/Receive verification passed in actual Ledger Discover. See the [installation checkpoint](install-pearl.md). Earlier Pearl Dev results retain their separate artifact identity. A physical test showed that omitting the name defaults to BOLOS and sends the device back to its dashboard. Manually opening the matching installed PRL app allows the host to match its name without depending on catalog metadata for an unpublished app. Both standard browser and Discover routes default to mainnet. Pearl's own protocol capability and network checks reject an incompatible response before deriving accounts or signing. These checks are not firmware attestation. Do not add `appVersionRange` to this host without rechecking: 4.23.0's handler rejects when its supplied semver range _matches_ the returned version.

The host maintains one transport and returns ID `"1"`; its close handler operates on that shared transport. Teardown must finish before reconnecting. An unresolved open, exchange or close requires reopening the Live App rather than allowing stale cleanup to close another session. Cancelling the host request cannot promise to dismiss a physical review. A winning valid signature response still needs independent verification and durable recovery before any final protocol acknowledgement.

Desktop uses an Electron `webview`, whose preload exposes `ElectronWebview.postMessage`. The host responds through `contentWindow.postMessage` targeted to the app origin. Keep `frame-ancestors 'none'` and `X-Frame-Options: DENY`: this desktop integration does not require allowing arbitrary iframes. The Live entry requires the Electron or React Native host bridge and must not fall back to cross-origin iframe messaging. Android uses the mobile host bridge; the app does not use browser WebHID there. See Ledger's [WalletAPIWebview](https://github.com/LedgerHQ/ledger-live/blob/develop/apps/ledger-live-desktop/src/renderer/components/Web3AppWebview/WalletAPIWebview.tsx) and [device host implementation](https://github.com/LedgerHQ/ledger-live/blob/develop/libs/ledger-live-common/src/wallet-api/react.ts).

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

Earlier local checkpoint on 10 October 2026 (artifact-specific results retained below; the current hosted/product review supersedes its setup and service-availability status):

- `npm run check`: 489 tests passed across six workspaces; TypeScript, production builds and tracked-source secret-pattern scan passed. A supplementary run of the same patterns over tracked and untracked files passed for 1,860 files.
- Dependency/source inventory: 755 checks and four notice tests passed, including reconstruction of all copied UI adaptations and exact emitted font bytes. The locked dependency audit reported no advisories.
- Chrome exercised the real Recipient → Amount → Summary flow with synthetic public data: 1 PRL plus 0.00001000 PRL fee displayed exactly as 1.00001000 PRL. Escape closed the modal without dropping its unsigned reservation; explicit discard removed the test drafts. Receive progressed to the device step and exposed no usable Copy control without verification.
- A 390 × 844 viewport fit the summary without horizontal overflow. Exact Inter 400/600 fonts loaded. Routine graphics, duplicate branding and the companion sidebar were removed; account/recovery settings remain behind Settings.
- The ordinary browser rejected `/live.html` connection without silently switching to WebHID. Installed Ledger Wallet accepted the manifest and reached its native connection dialog. Hardware signing and cancellation/reconnect with an unlocked physical signer remain untested.
- Live Testnet2 status/genesis validation succeeded once in an earlier check. The latest [read-only public-source recheck](../tools/live-app-public-review/README.md) used the real `BlockbookSource` and existing port-5188 same-origin proxy: both mainnet and Testnet2 status/genesis calls timed out before any address query. Independent normal-TLS curl requests also timed out before TCP/TLS connection. Results remain unavailable rather than a substituted zero balance; live-chain balance discovery, broadcasting and confirmation are **not established**.
- Current-source Nano S Plus mainnet/regtest emulator runs cover both P2TR and P2MR recipients, exact amount/fee/address review and independently checked signatures. See [native evidence](../tools/live-app-native-review/README.md), including 75 malformed-request rejections and explicit rejection/fresh approval.

The dev server uses port 5188 to avoid an unrelated service worker found at the usual port 5173. No other app's storage or service worker was removed. At that earlier checkpoint, no public deployment, repository push or vendor submission had occurred. The current release has since been pushed and deployed as recorded in [release evidence](../tools/hosted-wallet-review/release.md); no vendor submission or public Discover listing is claimed.

## Entry isolation

The web and Discover entries register their transport once before loading the common wallet. The browser graph excludes Wallet API, and the Discover graph excludes DMK/WebHID. A missing or mismatched registration fails closed. WebHID discovery starts synchronously within the connect gesture. Production graph tests traverse imports from both HTML entries, including the common wallet and external backup validator worker.

## Physical checkpoint

The [recorded Nano S Plus test](../tools/live-app-physical-review/README.md) now covers the actual Wallet API public-account and verified Receive flows. The synthetic signing checkpoint used direct HID; Wallet API signing, cancellation and reconnect remain separate qualification work. No live transaction was broadcast.

## Current hosted behavior and resource boundary

Fast/Medium/Slow use 1/10/25-block estimates, with Medium selected when a fresh quote is available. Exact total fees update with amount, selected input/output shape and Max. Custom allows an explicit total fee. Missing estimates are labeled Standard at the pinned relay minimum, never presented as a confirmation-time promise. Fast/Medium/Slow show short approximate times of ≈3 min, ≈32 min and ≈1 h 21 min, derived from their 1/10/25-block targets and the pinned 194-second Pearl block target. These are rough target hints, not a countdown, measured current mining pace or confirmation guarantee. Equal-priced tiers remain separate choices. Quotes retain a 120-second lifetime. While an unprepared Send Amount step is visible and the app is not busy, one anonymous fee batch refreshes around 105 seconds after the prior request began. Input edits do not reset that absolute deadline; busy work defers it, hidden/other pages make no timer request, and prepared reviews are not repriced. Returning to the visible Amount step performs a cache-aware check. The top-right service status describes the last chain/service and fee check; it is not a guarantee of future availability or complete history.

The two hosted functions reuse the bounded fixed-endpoint proxy. They store no application account profiles, wallet histories or database records. Browser display caching and the durable payment journal are local to that origin/profile. There is no unconditional hosted idle full-account polling loop. While visible and idle with known pending transactions, public-source mode reads up to four transaction statuses per 60-second cycle (one early check for a new payment); a changed hint can trigger one coherent fresh discovery/reconciliation. It pauses during unsigned/Receive/device review, preserves missing/failed results and never auto-broadcasts or releases reservations. A measured empty public-fixture scan used 46 reads and 10,760 response bytes; six uncached fee reads used 1,003 bytes, with a combined observed duration of 3.677 seconds. Used accounts and active Amount-step fee refreshes require additional bounded reads. These are measurements, not unlimited traffic, zero-cost or service-availability promises. Infrastructure can retain ordinary request metadata; public account queries still disclose addresses to the selected service.

QR camera/image decoding uses lazy-loaded jsQR locally; it uploads no image or frame. Cancellation stops acquired tracks, and a decoded request only fills the reviewed form. See the [hosted boundary review](../tools/hosted-wallet-review/deployment.md), [wallet review](../tools/hosted-wallet-review/README.md) and [current C regtest roundtrip](../tools/hosted-wallet-review/simulator/README.md).
