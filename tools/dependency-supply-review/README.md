# Dependency and build supply-chain review

Review date: 2026-10-09. Read-only production inspection and an in-memory host build. This is a bounded source review, not an independent human audit, dependency-authenticity proof, Ledger approval, physical qualification, or a release certification. No firmware, emulator, native build, live indexer, device, real seed, deployment, or funds were used.

Later explicitly authorized attribution-only work is documented in [SOURCE-ATTRIBUTION.md](SOURCE-ATTRIBUTION.md): 33 modified upstream C/header files received one prominent change-notice comment, with all original bytes preserved and before/after hashes retained. That follow-up did not execute native code or alter copied TypeScript modules.

## Useful result

The npm/CI baseline is already deliberately constrained: exact direct versions, consistent lock metadata, official-registry tarball integrity fields, suppressed install hooks, pinned CI action commits, read-only workflow permissions, and no production-browser import of MetaMask, CLI, private-node bridge, tests or fixture modules. The official-registry advisory lookup returned **zero known npm advisories** for this lockfile. This does not imply no vulnerabilities.

The actionable website distribution gap was **missing third-party notices in delivered assets**. The coordinating implementation has now integrated the verified candidate and a stale-notice CI check. A separate documentation review is correcting legacy Rust evidence labels. The new C native build's previously overstated provenance wording is now corrected, with complete builder-input binding explicitly left as a future release gate; it must not inherit the old Rust build's reproducibility claims.

## Finding 1: website distribution drops third-party notices

**Priority: before distributing the website; licensing/release preparation, not a demonstrated key compromise.**

- The actual Vite production build's main JS, backup worker, HTML and CSS contain none of the inspected license/copyright markers. No notices artifact was initially emitted or served.
- The real module graph includes **25 npm package/version instances with 24 distinct names**, not the entire installed workspace graph. Both `tslib@1.14.1` and nested `rxjs/node_modules/tslib@2.8.1` are reachable. The worker includes only `@noble/curves@1.9.7`, `@noble/hashes@1.8.0`, `@scure/base@1.2.6`, and `@scure/bip32@1.7.0`.
- Vite emits its module-preload polyfill and CommonJS interoperability helpers. Their notices must not be missed just because Vite is a development dependency. The complete installed Vite license file is retained conservatively; its additional build-tool notices are not a claim that every bundled Vite dependency runs in the wallet.
- Six adapted Ledger Bitcoin host modules also appear in the main graph. Their Apache license and the local modification/provenance notice are included separately.
- Source retention was already good: the Ledger C app's license and nested third-party license files match recorded upstream Git blob identities. `packages/bitcoin-prl-adapter/provenance/verify_upstream.py` passes for the six adapted source files, original files, license and exact patch. The problem is browser distribution, not missing source provenance.

### Implemented narrow correction

The coordinating implementation copied `THIRD-PARTY-NOTICES.proposed.txt` into `apps/companion/public/third-party-notices.txt`, added a footer link, and serves only the exact notices route through the existing bounded in-memory/no-symlink loader. It also added the fresh graph/generator check to CI after `npm run check`. The coordinator reports **10 passing real-loopback server tests**, including text MIME, GET/HEAD, rejection of unrelated text paths, and rejection of missing/symlinked notices at startup, plus a passing fresh inventory/distributed-file check after integration. These are host software results, not qualification of a public HTTPS deployment. This reviewer authored only files in this review folder; the coordinating implementation owns production changes and the final combined regression run.

The candidate is **186,206 bytes**, SHA-256 **`ccea80c549383223e6cf762fa9fabb3648379b61763ab2222570e90e670a3808`**. `license-inventory.json` maps every component to the measured main/worker file hashes and records each installed license/copyright source hash. All referenced notice bodies are retained verbatim, including their original line endings. A UTF-8 BOM precedes the generated document so local preview servers without an explicit charset display Unicode correctly; the production server also sends an explicit UTF-8 Content-Type. No blanket project license is invented; newly authored project licensing remains an owner decision. This is a proposed technical notices artifact, not a legal opinion.

## Finding 2: C build attribution wording corrected; complete builder binding remains open

**Priority: correct the description now; close provenance gaps before a future native release qualification. No native execution is needed or authorized by this finding.**

The original `tools/bitcoin-prl-port/README.md:26-28` described exact source/compiler/linker/SDK/binary hash manifests. The actual `provenance.py:8-12,19-24` records app-source SHA-256 values, ELF/HEX/build-log SHA-256 values, declared upstream metadata, an SDK path and the first `--version` lines of three tools. It does **not** hash the compiler/linker executables, objcopy, sysroot/newlib, Python dependencies, build wrapper, or provenance script. `build.sh:11-13` checks the SDK commit and cleanliness before the build; its before/after comparison snapshots only the app inputs, without rechecking the SDK at completion.

Existing mitigation matters: exact clean SDK checks, explicit app source hashes, per-target serialization, cleaning when changing network, and refusal of changed app source already provide useful local attribution. The report does not allege a malicious tool or SDK change occurred. It identifies an overstatement and inputs that a future reproducer cannot recover from this manifest alone.

At the coordinator's explicit follow-up request, this reviewer corrected only the native-port README to describe those fields and pre-build/app-source check boundaries accurately. It now records exact builder/recipe/tool/library binding and final SDK revision/cleanliness verification as unqualified future release gates. No provenance/build code was changed or executed. This is not a request to restart the paused native lane or replace mature Ledger code.

## Historical evidence labels

At review start, `docs/implementation-status.md:15-23` and `docs/test-evidence.md` still presented the retained Rust app's five-model/25-build/source-final/reproducibility results without an upfront historical label. The root README and SECURITY already separated the new C port correctly. The coordinating release-evidence review is correcting the subordinate documents. This review does not count the old Rust outcomes as qualification of the new C app.

## Verified existing controls

- `package-lock.json` is version 3; all seven workspace/root manifest dependency sets match it and all declared direct package versions are exact. **198 registry records** have official npm HTTPS tarball URLs and valid SHA-512 integrity fields. The **124 present registry package versions** match the lock; the remaining **74** records are optional platform packages. Integrity syntax/version checks do not cryptographically authenticate already-installed file contents.
- The lock marks three installation-script packages: `esbuild@0.25.12`, `vite/node_modules/esbuild@0.28.2`, and optional `fsevents@2.3.3` (not installed on this host). CI and supported setup instructions use `npm ci --ignore-scripts`. Other packages' publishing/prepare scripts are not treated as evidence that registry installs ran them. Explicit build/test scripts remain executable code and need trusted build dependencies.
- The fresh in-memory browser build has **341 main modules**, **27 worker modules**, **342 in their union**. It excludes server/bridge, CLI, MetaMask, legacy SDK device implementation, tests and fixture modules. No known public BIP32/test mnemonic marker or RPC-credential environment name is in the emitted code. This is a bounded marker/module check, not universal secret scanning.
- Vite copies the public synthetic example-watch JSON into ordinary `dist`, but the dedicated production host does not serve its route. The existing fixed allowlist, disabled source maps, no arbitrary filesystem lookup, and docs prohibiting public Vite dev/preview hosting already mitigate fixture/source leakage. No fixture-removal change is recommended solely because that file exists in `dist`.
- Sentry's helper code and generic private-key/signing methods exist in mature libraries. Existing privacy evidence already distinguishes them from configured telemetry/private-key wallet workflows. The app does not initialize a Sentry client and the production CSP restricts connections to its own origin. Do not replace mature crypto libraries merely to remove unused method names.
- All enabled `.github/workflows` action references are 40-character commit pins, permission is `contents: read`, checkout does not persist credentials, and there is no `pull_request_target` or publication job. The official Ledger publication workflow remains inactive. `npm audit --audit-level=moderate` is already a host CI gate.
- Root `Cargo.lock` has 74 registry entries and the historical native lock has 67; every registry entry has a checksum and neither lock includes an unpinned Git source. Host Cargo commands use `--locked`. The Go oracle uses a commit-addressed module version, `go.sum`, and `-mod=readonly`.
- The manual legacy packaging preflight uses exact Python version requirements but no artifact hashes or `--require-hashes`. The inherited C app test `requirements.txt` contains ranges and is not used by enabled CI/the website. These are not production-browser dependencies. Do not elevate these development installs to a reproducible production release process unchanged; no dependency update/install was performed here.
- No workflow, README or primary security page claims vendor approval, physical validation, a human audit or security equivalence solely from professional Ledger source reuse. Those gates remain unmet and explicitly documented.

## Reproduce and prevent stale notices

From repository root, using already-installed locked dependencies:

```sh
node --import tsx tools/dependency-supply-review/review.mjs
node tools/dependency-supply-review/generate-notices.mjs
node --test tools/dependency-supply-review/notices.test.mjs
```

The following pair is now the integrated dependency-update/release CI check:

```sh
node --import tsx tools/dependency-supply-review/review.mjs
node tools/dependency-supply-review/generate-notices.mjs --check apps/companion/public/third-party-notices.txt
```

The first command performs a fresh production host build with `write:false` and captures both main and worker graphs. It leaves deployment `dist` untouched. The second rejects changed lock/build inputs, changed package metadata or notice hashes, and unclassified virtual runtime helpers, then compares the complete regenerated notice bytes with the distributed file. It never overwrites that distributed file. The unit control confirms an exact file passes and one extra byte sequence fails.

The official advisory command used was:

```sh
npm audit --package-lock-only --ignore-scripts --registry=https://registry.npmjs.org --json
```

It returned exit 0 and zero reported vulnerabilities. `npm-audit.json` preserves the raw response. This lookup transmits public package names/versions to npm, not wallet data. It does not install or update anything. Its npm-update notice was not followed.

`results.json` contains source hashes, exact build-output hashes, action pins, lock entries and graph membership; `review-output.txt` preserves the 419 passing structural/graph assertions. `notices-test-output.txt` contains the stale-notice negative-control result. The lockfile reviewed has SHA-256 `816e757d18507e6d3d402157df3bd9eb30ca0599bca08d6e87f51e47d4e4baea`. The checkout was being changed concurrently, so the recorded Git HEAD is context only: use the precise file hashes and rerun on final source. No source/authenticity verification is implied for uninspected dependency code.
