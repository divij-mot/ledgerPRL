/** Draft a deployment notices artifact from the measured graph and exact installed notices. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));
const here = path.join(root, "tools/dependency-supply-review");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const read = (file) => fs.readFile(path.join(root, file));
const parse = async (file) => JSON.parse(await read(file));
const result = await parse("tools/dependency-supply-review/results.json");
assert.equal(sha(await read("package-lock.json")), result.lockfileSha256, "Dependency lock changed; rerun review.mjs first");
for (const [file, expected] of Object.entries(result.sourceHashes)) {
  if (/^(?:tools\/dependency-supply-review\/upstream-notices\/|node_modules\/|apps\/companion\/(?:vendor\/ledger-live-4\.23\.0\/|src\/|(?:vite|tailwind)\.config\.ts|(?:index|live)\.html)|packages\/(?:sdk|wallet|bitcoin-prl-adapter)\/src\/)/.test(file))
    assert.equal(sha(await read(file)), expected, `Build input changed; rerun review.mjs first: ${file}`);
}
for (const entry of result.browserPackages) {
  const current = await parse(`${entry.directory}/package.json`);
  assert.equal(current.name, entry.name);
  assert.equal(current.version, entry.version, `Installed package changed: ${entry.directory}`);
  assert.deepEqual(current.license, entry.license, `Installed license declaration changed: ${entry.directory}`);
}
const bundles = result.chunks.filter((entry) => /\.(?:js|css|html|woff2)$/.test(entry.file));
assert(bundles.some((entry) => entry.file === "index.html") && bundles.some((entry) => entry.file === "live.html"));
const bundlesFor = (modules) => bundles.filter((bundle) =>
  [...(bundle.modules ?? []), ...(bundle.cssModules ?? [])].some((module) => modules.includes(module))).map((bundle) => bundle.file);
const components = result.browserPackages.map((entry) => ({
  id: `${entry.directory}@${entry.version}`, name: entry.name, version: entry.version,
  kind: "npm-reachable", license: entry.license ?? entry.supplemental?.license, directory: entry.directory,
  bundles: bundlesFor([...entry.mainModules, ...entry.workerModules, ...entry.cssModules]),
  sourceModules: { main: entry.mainModules, worker: entry.workerModules, css: entry.cssModules },
  scope: entry.supplemental?.scope,
  notices: [...entry.notices, ...(entry.supplemental?.notices ?? [])],
}));
const vite = await parse("node_modules/vite/package.json");
const helperNames = ["\0commonjsHelpers.js", "\0vite/modulepreload-polyfill.js", "\0vite/preload-helper.js", "__vite-browser-external", "\0__vite-browser-external?commonjs-proxy", "\0commonjs-dynamic-modules"];
const helpers = result.mainModules.filter((name) => helperNames.includes(name));
assert(helpers.length >= 2);
for (const module of [...result.mainModules, ...result.workerModules])
  if ((module.startsWith("\0") || module.startsWith("__vite-")) && !module.includes("node_modules/"))
    assert(helpers.includes(module), `Unclassified generated runtime module needs a notices review: ${JSON.stringify(module)}`);
components.push({
  id: `generated-runtime:vite@${vite.version}`, name: "Vite-generated runtime helpers", version: vite.version,
  kind: "bundler-generated-runtime", license: "MIT", bundles: bundlesFor(helpers), sourceModules: { main: helpers, worker: [] },
  scope: "Vite preload/browser-external stubs and bundled @rollup/plugin-commonjs interop helpers. The complete installed Vite license file is retained conservatively; its additional build-tool notices do not imply those packages execute in the wallet.",
  notices: [{ path: "node_modules/vite/LICENSE.md", sha256: sha(await read("node_modules/vite/LICENSE.md")) }],
});
const upstream = await parse("packages/bitcoin-prl-adapter/provenance/upstream.json");
const upstreamModules = result.mainModules.filter((name) => name.startsWith("packages/bitcoin-prl-adapter/src/upstream/"));
assert(upstreamModules.length === 6);
components.push({
  id: `source:LedgerHQ/app-bitcoin@${upstream.revision}`, name: "Adapted Ledger Bitcoin host modules", version: upstream.tag,
  kind: "copied-source", license: "Apache-2.0", bundles: bundlesFor(upstreamModules),
  repository: upstream.repository, revision: upstream.revision, sourceModules: { main: upstreamModules, worker: [] },
  modificationNotice: "Six host protocol modules were adapted from LedgerHQ/app-bitcoin 2.5.1, commit 44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a. Pearl modifications add explicit browser Buffer imports, pinned noble hashing, strict TypeScript/ESM support, bigint-only uint64 handling, canonical varints, and bounded/copying Merkle-interpreter inputs. Original sources and the complete local patch are retained in packages/bitcoin-prl-adapter/provenance. Ledger approval or endorsement is not implied.",
  notices: [{ path: "packages/bitcoin-prl-adapter/provenance/LICENSE.app-bitcoin", sha256: upstream.licenseSha256 }],
});
components.push({
  id: "font:Inter:LedgerWallet-4.23.0", name: result.fonts.name, version: result.fonts.version,
  kind: "copied-font", license: result.fonts.license,
  bundles: result.fonts.assets.map((asset) => asset.file),
  repository: result.fonts.repository, sourceModules: { fonts: result.fonts.assets.map((asset) => asset.sourcePath) },
  scope: "Unmodified Inter font files from the installed Ledger Wallet 4.23.0 distribution. This identifies the distribution, not an upstream font release number. Exact archive asset names and SHA-256 hashes are retained in apps/companion/src/fonts/PROVENANCE.txt. The fonts remain under SIL Open Font License 1.1; use of these fonts does not imply Ledger endorsement.",
  notices: result.fonts.notices,
});
components.push({
  id: `source:LedgerHQ/ledger-live@${result.copiedUi.commit}`, name: "Adapted Ledger Wallet send/receive views", version: "4.23.0",
  kind: "copied-source", license: result.copiedUi.license, bundles: bundlesFor(result.copiedUi.modules),
  repository: result.copiedUi.repository, revision: result.copiedUi.commit,
  sourceModules: { main: result.copiedUi.modules, worker: [] },
  modificationNotice: "Presentation components and the QR camera loop were adapted from the pinned Ledger Wallet 4.23.0 desktop send/receive views, breadcrumb/stepper, modal layout, read-only address field and recipient QR scanner. Pearl modifications replace desktop account/store dependencies with explicit inputs to the existing Pearl wallet, reuse Lumen controls, bound image/camera scanning and retain Pearl verification, reservation, recovery and explicit broadcast boundaries. Unmodified upstream files, exact adapted-source hashes and the complete patch are retained in apps/companion/vendor/ledger-live-4.23.0. Newly written integration glue is included in this component's output mapping; it is not claimed to be original Ledger code. Ledger approval or endorsement is not implied.",
  notices: result.copiedUi.notices,
});
const sections = [
  "PEARL WALLET WEBSITE — THIRD-PARTY LICENSES AND NOTICES\n\n" +
  "This file preserves notices for third-party code included in the measured standalone and Live App browser entries, shared chunks, styles, local Inter fonts and backup-import worker. It does not grant a blanket license to newly authored Pearl project code. Third-party license terms below continue to apply. Names identify source provenance, without implying endorsement, audit, Ledger approval, or suitability for valuable funds.\n\n" +
  "The matching dependency and bundle inventory is recorded separately. Vite's complete installed license file is retained for its emitted runtime helpers; additional notices in that file concern bundled build-tool components and do not imply browser reachability.\n",
];
for (const component of components) {
  sections.push("\n" + "=".repeat(78) + `\n${component.name} ${component.version}\nLicense: ${component.license}\n`);
  if (component.repository) sections.push(`Upstream: ${component.repository}\nRevision: ${component.revision}\n`);
  if (component.modificationNotice) sections.push(`${component.modificationNotice}\n`);
  if (component.scope) sections.push(`${component.scope}\n`);
  assert(component.bundles.length > 0, `Component has no measured output: ${component.id}`);
  assert(component.notices.length > 0, `No notices found for ${component.id}`);
  for (const notice of component.notices) {
    const bytes = await read(notice.path);
    assert.equal(sha(bytes), notice.sha256, `Notice changed since inventory: ${notice.path}`);
    sections.push(`\n--- ${path.basename(notice.path)} ---\n`);
    // Preserve each installed copyright/license body verbatim, including original line endings.
    sections.push(bytes.toString("utf8"));
    sections.push("\n");
  }
}
// BOM preserves UTF-8 display in local static preview servers that omit charset.
// Embedded license bodies remain byte-for-byte unchanged.
const artifact = Buffer.from("\uFEFF" + sections.join(""));
// Every referenced notice must survive byte-for-byte as a contiguous body.
for (const component of components) for (const notice of component.notices)
  assert(artifact.includes(await read(notice.path)), notice.path);
const inventory = {
  schema: 2, reviewedOn: result.reviewedOn, sourceHead: result.head,
  lockfileSha256: result.lockfileSha256,
  scope: "Actual Rollup entry/shared-chunk and worker graph plus watched CSS/preset build inputs, including generated runtime helpers and copied Ledger host source; no host-only package is included merely because it appears in package-lock.json.",
  bundles: bundles.map(({ modules, cssModules, ...bundle }) => ({ ...bundle, components: components.filter((item) => item.bundles.includes(bundle.file)).map((item) => item.id) })),
  counts: { npmPackageInstances: result.browserPackages.length, npmUniqueNames: new Set(result.browserPackages.map((item) => item.name)).size,
    generatedRuntimeGroups: 1, copiedSourceGroups: 2, fontGroups: 1, componentGroups: components.length },
  components,
  proposedNotices: { file: "THIRD-PARTY-NOTICES.proposed.txt", bytes: artifact.length, sha256: sha(artifact) },
  limitations: ["This is a technical notices artifact, not a legal opinion. Wallet API core declares MIT but omits license/copyright text in its package and exact upstream tag; that attribution gap remains unresolved.",
    "Serve a reviewed version through the dedicated host's narrow asset policy and link it visibly; leaving it only in this report does not deliver it to website users.",
    "Regenerate and verify against each changed browser dependency graph. Source-level redistribution may require additional source-specific notices beyond this browser artifact."],
};
await fs.writeFile(path.join(here, "THIRD-PARTY-NOTICES.proposed.txt"), artifact);
await fs.writeFile(path.join(here, "license-inventory.json"), JSON.stringify(inventory, null, 2) + "\n");
if (process.argv[2] === "--check") {
  const target = process.argv[3] ?? "apps/companion/public/third-party-notices.txt";
  assert.equal(path.isAbsolute(target), false, "Check target must be repository-relative");
  assert(!target.split(/[\\/]/).includes(".."), "Check target cannot escape the repository");
  assert.deepEqual(await read(target), artifact, `Distributed notices are stale: ${target}. Review the regenerated candidate before updating it.`);
  console.log(`PASS: ${target} exactly matches the current measured dependency notices.`);
} else assert.equal(process.argv.length, 2, "Usage: node generate-notices.mjs [--check repository-relative-file]");
console.log(JSON.stringify({ counts: inventory.counts, bundles: inventory.bundles.map((item) => ({ file: item.file, components: item.components.length })), proposedNotices: inventory.proposedNotices }, null, 2));
