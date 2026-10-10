# Dependency and build supply-chain review

Reviewed 2026-10-10 against the file hashes in `results.json`. This is a bounded source/build inspection, not an independent human audit, installed-file authenticity proof, legal opinion, Ledger approval or physical-device qualification. The recorded Git HEAD is context; the source hashes identify the measured working tree.

## Current measured graph

The in-memory production build includes both `index.html` and `live.html`, their shared JavaScript/CSS assets, and the backup-import worker. Attribution maps modules to each actual emitted chunk, without assuming a filename beginning with `index-`. Rollup does not expose the Tailwind config loader's complete preset dependencies, so a separate in-memory esbuild trace of the actual `tailwind.config.ts` captures the contributing Lumen design-core preset/token sources as **CSS build inputs**, not browser-executed JavaScript.

- 757 structural/build checks pass.
- 345 official-registry lock records have SHA-512 integrity fields; 249 installed versions match the lock. The remaining 96 are optional platform packages.
- 765 main/shared modules, 27 worker modules and 50 CSS inputs produce a union of 816 module/input paths.
- Notices cover 48 npm package/version instances (47 distinct names), Vite/CommonJS runtime helpers, and six adapted Ledger Bitcoin host modules, eight adapted Ledger Wallet UI views/components plus their glue/styles, and the three unmodified Inter font assets.
- The graph excludes tests, fixtures, CLI, MetaMask, private-node/server modules and the historical SDK device implementation. Known public test-seed and RPC configuration markers are absent from generated code. These bounded checks are not universal secret detection.
- All direct dependency versions are exact and match lock metadata. Existing CI uses `npm ci --ignore-scripts`, complete action commit pins and read-only contents permissions.
- A fresh official npm advisory lookup reports **zero known advisories** for the current lockfile. This does not establish that dependencies have no vulnerabilities. The raw response is in `npm-audit.json`.

The lock SHA-256 is `7ffdfb4ad695aab839152b6423d6660e19d0b3044b5579e6f1621c76a999ad50`. Structural integrity syntax and version checks do not cryptographically authenticate the installed package contents.

## Distribution notices and remaining gap

`apps/companion/public/third-party-notices.txt` exactly matches the generated candidate: **287,620 bytes**, SHA-256 `051e80f86cacb41704c9b5012aa0384a8a39d97688f2651911ff6997dab83628`. The application links the file and its server serves the fixed notices route. The generator retains source license bodies unchanged, including original line endings, with a UTF-8 BOM for local preview display. `license-inventory.json` maps the corresponding files, source modules, versions and license hashes.

The adapted Ledger Wallet send/receive views form a separate **MIT** source group from the **Apache-2.0** Bitcoin protocol modules. The inventory maps the UI's actual JavaScript and extracted CSS to release `@ledgerhq/live-desktop@4.23.0`, commit `abed962b08ca4b746f20192b28ce5b6c06a6c6a4`. The review checks eight original/adapted pairs, five supporting style originals, two derived glue/style files, the original MIT license and complete patch. It applies that patch to an isolated temporary copy and verifies that all ten resulting files exactly reproduce the recorded adaptations. A separate local comparison confirmed all 13 retained originals and the MIT license match the pinned upstream checkout. Supporting originals are not represented as browser-executed modules; newly written glue is explicitly distinguished from original Ledger code.

The three Inter 400/500/600 fonts are unchanged copies from installed Ledger Wallet 4.23.0, distributed under SIL Open Font License 1.1. The review verifies each source SHA-256 against the extraction provenance and then verifies that the corresponding hash-named emitted WOFF2 retains those exact bytes. The complete copyright and OFL text is included in the distributed notice; no upstream Inter release version is inferred from the Wallet version.

Several official npm packages omit license files. [Supplemental provenance](upstream-notices/README.md) records exact release tags and retained sources:

- Lumen UI/design-core Apache-2.0 licenses come from their exact official repository release commit. Lumen design-core is included for its distributed CSS contribution.
- Ledger transport/logging packages declare Apache-2.0 but their exact source tags also omit license/NOTICE files. Their original declarations and the standard ASF Apache 2.0 text are retained without inventing copyright holders.
- **Wallet API core 2.1.0 declares MIT but provides no license/copyright body in its tarball or exact source tag.** The distributed artifact preserves the declaration and calls out the attribution gap. The separate client's Apache license is not assigned to core. Obtain the missing applicable notices from upstream before public distribution.

A passing byte comparison means the delivered file matches the measured artifact; it does **not** resolve this legal attribution gap. Newly authored project licensing remains an owner decision. Packages absent from the emitted graph are not included merely because they are in the lockfile; retained supplemental material for Lumen utils-shared therefore is not automatically distributed.

## Reproduce

With the locked dependencies already installed:

```sh
node --import tsx tools/dependency-supply-review/review.mjs
node tools/dependency-supply-review/generate-notices.mjs --check apps/companion/public/third-party-notices.txt
node --test tools/dependency-supply-review/notices.test.mjs
```

The review builds with `write:false`, leaving `dist` untouched. The generator rejects changed lock/build inputs, installed package metadata, notice hashes and unknown virtual runtime helpers. It never overwrites the distributed file. Four tests cover exact/stale byte checks, both entries/shared chunks/worker/CSS attribution, emitted Inter font assets/full OFL retention, and the source-derived Ledger Wallet UI MIT attribution. Removing the Buffer initialization shim separately reproduced the browser startup failure caught by the Wallet API browser-bundle regression.

The advisory command is read-only and transmits public dependency names/versions to npm:

```sh
npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json
```

## Boundaries and earlier source attribution

No firmware build, emulator, physical Ledger operation, live indexer, deployment or fund movement was performed by these scripts. No source-level authenticity or security claim is inferred from reuse or a passing advisory lookup. The bounded current C firmware checkpoint is recorded separately in [native evidence](../live-app-native-review/README.md); historical Rust results do not qualify it.

Earlier attribution-only work on 33 upstream C/header files remains documented in [SOURCE-ATTRIBUTION.md](SOURCE-ATTRIBUTION.md), with original-byte preservation and before/after hashes. The native build provenance limitations remain in `tools/bitcoin-prl-port/README.md`; this browser review does not close those gates.
