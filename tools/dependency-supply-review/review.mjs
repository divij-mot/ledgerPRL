/** Read-only host supply-chain review. No installs, native builds, device or indexer use. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "vite";
import { build as traceConfig } from "esbuild";
import config from "../../apps/companion/vite.config.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "tools/dependency-supply-review");
const read = (file) => fs.readFile(path.join(root, file), "utf8");
const json = async (file) => JSON.parse(await read(file));
const hash = (data) => createHash("sha256").update(data).digest("hex");
const checks = [];
const check = (name, condition) => {
  assert(condition, name);
  checks.push({ name, pass: true });
};
const lock = await json("package-lock.json");
check("npm lockfile uses version 3", lock.lockfileVersion === 3);
const manifestPaths = [
  "package.json", "apps/cli/package.json", "apps/companion/package.json",
  "packages/sdk/package.json", "packages/wallet/package.json",
  "packages/metamask-snap/package.json", "packages/bitcoin-prl-adapter/package.json",
];
const manifestHashes = {};
for (const name of manifestPaths) {
  const manifest = await json(name);
  const key = name === "package.json" ? "" : path.dirname(name);
  check(`${name}: private package`, manifest.private === true);
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    assert.deepEqual(lock.packages[key][field] ?? {}, manifest[field] ?? {}, `${name} ${field} lock drift`);
    for (const [dependency, version] of Object.entries(manifest[field] ?? {}))
      assert.match(version, /^\d+\.\d+\.\d+(?:-[\w.-]+)?$/, `${name} ${dependency}: non-exact direct pin`);
  }
  manifestHashes[name] = hash(await read(name));
}
checks.push({ name: "Every workspace manifest dependency exactly pinned and matches lock metadata", pass: true });
const installedMismatches = [], missingInstalled = [], installLifecycle = [], registryRecords = [];
for (const [location, item] of Object.entries(lock.packages)) {
  if (!location.startsWith("node_modules/") || item.link) continue;
  check(`${location}: official registry tarball`, item.resolved.startsWith("https://registry.npmjs.org/"));
  const integrity = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(item.integrity ?? "");
  check(`${location}: valid sha512 integrity`, integrity && Buffer.from(integrity[1], "base64").length === 64);
  registryRecords.push({ path: location, version: item.version, resolved: item.resolved, integrity: item.integrity, dev: !!item.dev, optional: !!item.optional });
  let installed;
  try { installed = await json(`${location}/package.json`); }
  catch (error) { if (error.code !== "ENOENT") throw error; missingInstalled.push(location); continue; }
  if (installed.version !== item.version) installedMismatches.push({ location, locked: item.version, installed: installed.version });
  const lifecycle = Object.fromEntries(Object.entries(installed.scripts ?? {}).filter(([name]) => ["preinstall", "install", "postinstall"].includes(name)));
  if (item.hasInstallScript || Object.keys(lifecycle).length) installLifecycle.push({ location, lockedVersion: item.version, hasInstallScript: !!item.hasInstallScript, lifecycle });
}
check("All present registry packages have their locked version", installedMismatches.length === 0);
check("Missing registry packages are optional platform packages", missingInstalled.every((name) => lock.packages[name].optional));

const mainModules = new Set(), workerModules = new Set(), cssModules = new Set();
const chunkModules = new Map();
const graphPlugin = (name, destination) => ({
  name,
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) if (chunk.type === "chunk") {
      const names = Object.keys(chunk.modules).map((name) => name.replace(root, ""));
      chunkModules.set(chunk.fileName, names);
      for (const name of names) destination.add(name);
    }
    // Tailwind consumes CSS and the Lumen preset at build time. These sources
    // contribute distributed CSS despite not appearing as executable JS modules.
    for (const file of this.getWatchFiles()) {
      const name = file.replace(root, "");
      if (/node_modules\/.*\.css$/.test(name) || /apps\/companion\/src\/ledger-ui\/.*\.css$/.test(name) ||
          /node_modules\/@ledgerhq\/lumen-design-core\/.*\.js$/.test(name)) cssModules.add(name);
    }
  },
});
// Import the actual config, but do not re-bundle/load it through a temporary config file.
// All build results stay in memory. Existing dist and another review's evidence are untouched.
const built = await build({
  ...config, root: path.join(root, "apps/companion"), configFile: false, logLevel: "error",
  build: { ...config.build, write: false },
  plugins: [...(config.plugins ?? []), graphPlugin("supply-main-graph", mainModules)],
  worker: { plugins: () => [graphPlugin("supply-worker-graph", workerModules)] },
});
const bundles = (Array.isArray(built) ? built : [built]).flatMap((entry) => entry.output);
// Tailwind's config loader does not expose preset dependencies to Rollup's
// watch graph. Trace the real config separately to retain emitted token sources.
const presetGraph = await traceConfig({
  entryPoints: [path.join(root, "apps/companion/tailwind.config.ts")],
  absWorkingDir: root, bundle: true, write: false, metafile: true,
  platform: "node", format: "esm", logLevel: "silent",
});
for (const emitted of Object.values(presetGraph.metafile.outputs))
  for (const [name, contribution] of Object.entries(emitted.inputs))
    if (contribution.bytesInOutput > 0 && name.startsWith("node_modules/@ledgerhq/lumen-design-core/")) cssModules.add(name);
check("Lumen CSS preset inputs are included in attribution", [...cssModules].some((name) => name.includes("lumen-design-core/")));
const modules = [...new Set([...mainModules, ...workerModules, ...cssModules])].sort();
const forbiddenModules = modules.filter((name) => /(?:^|\/)(?:test|tests|fixtures)\/|apps\/cli\/|packages\/metamask-snap\/|node_modules\/@metamask\/|apps\/companion\/src\/(?:bridge|blockbook\.ts|indexer-proxy|web-server)|packages\/sdk\/src\/device\.ts/.test(name));
check("Fresh browser graph excludes tests, fixtures, CLI, MetaMask and server/legacy device code", forbiddenModules.length === 0);
const assetBytes = bundles.map((item) => ({ item, bytes: Buffer.from(item.type === "chunk" ? item.code : item.source) }));
// Bind emitted font assets to the unchanged installed-wallet copies and OFL.
const fontDirectory = "apps/companion/src/fonts";
const fontProvenancePath = `${fontDirectory}/PROVENANCE.txt`;
const fontLicensePath = `${fontDirectory}/OFL.txt`;
const fontProvenance = await read(fontProvenancePath);
const recordedFonts = [...fontProvenance.matchAll(/Asset: ([A-Za-z0-9-]+\.woff2)\nArchive path: ([^\n]+)\nSHA256: ([a-f0-9]{64})/g)];
const emittedFonts = assetBytes.filter(({ item }) => item.fileName.endsWith(".woff2"));
check("Build emits every recorded local font", emittedFonts.length === recordedFonts.length && recordedFonts.length === 3);
const fontAssets = [];
for (const [, name, archivePath, sha256] of recordedFonts) {
  const sourcePath = `${fontDirectory}/${name}`, bytes = await fs.readFile(path.join(root, sourcePath));
  check(`${name}: exact recorded Ledger Wallet font bytes`, hash(bytes) === sha256);
  const emitted = emittedFonts.filter((asset) => hash(asset.bytes) === sha256);
  check(`${name}: emitted asset preserves exact font bytes`, emitted.length === 1);
  fontAssets.push({ file: emitted[0].item.fileName, sourcePath, bytes: bytes.length, archivePath, sha256 });
}
const fonts = { name: "Inter", version: "Ledger Wallet 4.23.0 distribution", license: "OFL-1.1",
  repository: "https://github.com/rsms/inter", provenance: fontProvenancePath,
  notices: [{ path: fontLicensePath, sha256: hash(await read(fontLicensePath)) }], assets: fontAssets };
const browserCode = assetBytes.filter(({ item }) => /\.js$/.test(item.fileName)).map(({ bytes }) => bytes.toString()).join("\n");
const forbiddenMarkers = ["PEARL_RPC_PASSWORD", "PEARL_RPC_USER", "PEARL_RPC_URL", "000102030405060708090a0b0c0d0e0f", "abandon abandon abandon", "test test test test test test", "createNodeRpc"];
check("Emitted code has no known public seed fixture or RPC credential config markers", forbiddenMarkers.every((marker) => !browserCode.includes(marker)));
check("Build emits no source maps", bundles.every((item) => !item.fileName.endsWith(".map")));
function packageRoot(module) {
  const name = module.replace(/^\0/, "").split("?")[0];
  const index = name.lastIndexOf("node_modules/");
  if (index < 0) return undefined;
  const match = /^node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(name.slice(index));
  return match ? name.slice(0, index) + match[0] : undefined;
}
const packageRoots = [...new Set(modules.map(packageRoot).filter(Boolean))].sort();
const browserPackages = [];
const supplemental = await json("tools/dependency-supply-review/upstream-notices/provenance.json");
for (const directory of packageRoots) {
  const packageFile = `${directory}/package.json`;
  const metadata = await json(packageFile);
  const files = (await fs.readdir(path.join(root, directory))).filter((file) => /licen[cs]e|copyright|notice/i.test(file));
  browserPackages.push({
    name: metadata.name, version: metadata.version, directory, license: metadata.license,
    moduleCount: modules.filter((entry) => packageRoot(entry) === directory).length,
    mainModules: [...mainModules].filter((entry) => packageRoot(entry) === directory).sort(),
    workerModules: [...workerModules].filter((entry) => packageRoot(entry) === directory).sort(),
    cssModules: [...cssModules].filter((entry) => packageRoot(entry) === directory).sort(),
    supplemental: supplemental.find((entry) => entry.name === metadata.name && entry.version === metadata.version),
    notices: await Promise.all(files.map(async (file) => ({ path: `${directory}/${file}`, sha256: hash(await read(`${directory}/${file}`)) }))),
  });
}
const uiDirectory = "apps/companion/vendor/ledger-live-4.23.0";
const uiProvenancePath = `${uiDirectory}/provenance.json`;
const uiProvenance = await json(uiProvenancePath);
const uiLicensePath = `${uiDirectory}/LICENSE.txt`, uiPatchPath = `${uiDirectory}/adaptation.patch`;
check("Ledger Wallet UI license matches retained provenance", hash(await read(uiLicensePath)) === uiProvenance.licenseSha256);
check("Ledger Wallet UI patch matches retained provenance", hash(await read(uiPatchPath)) === uiProvenance.patchSha256);
const uiSourcePaths = [];
for (const source of uiProvenance.sources) {
  const original = `${uiDirectory}/${source.original}`;
  const adapted = `apps/companion/${source.adapted}`;
  check(`${source.path}: exact retained upstream UI bytes`, hash(await read(original)) === source.sha256);
  check(`${source.adapted}: exact recorded UI adaptation`, hash(await read(adapted)) === source.adaptedSha256);
  uiSourcePaths.push(original, adapted);
}
for (const source of uiProvenance.supportingSources) {
  const original = `${uiDirectory}/${source.original}`;
  check(`${source.path}: exact retained UI style source`, hash(await read(original)) === source.sha256);
  uiSourcePaths.push(original);
}
for (const source of uiProvenance.derivedFiles) {
  const file = `apps/companion/${source.path}`;
  check(`${source.path}: exact recorded UI glue/style extraction`, hash(await read(file)) === source.sha256);
  uiSourcePaths.push(file);
}
// Reconstruct the adapted views independently; matching unrelated file hashes
// alone would not prove that the retained patch represents these modifications.
const patchDirectory = await fs.mkdtemp(path.join(tmpdir(), "pearl-ledger-ui-source-"));
try {
  for (const source of uiProvenance.sources) {
    const destination = path.join(patchDirectory, source.adapted);
    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.copyFile(path.join(root, uiDirectory, source.original), destination);
  }
  execFileSync("patch", ["-f", "-p1", "-d", patchDirectory], { input: await read(uiPatchPath), encoding: "utf8" });
  for (const source of uiProvenance.sources)
    check(`${source.adapted}: patch reproduces exact UI adaptation`, hash(await fs.readFile(path.join(patchDirectory, source.adapted))) === source.adaptedSha256);
  for (const source of uiProvenance.derivedFiles)
    check(`${source.path}: patch reproduces exact UI glue/styles`, hash(await fs.readFile(path.join(patchDirectory, source.path))) === source.sha256);
} finally { await fs.rm(patchDirectory, { recursive: true, force: true }); }
const uiModules = [...new Set([...mainModules, ...cssModules])].filter((name) => name.startsWith("apps/companion/src/ledger-ui/")).sort();
check("Every recorded UI adaptation is in the emitted browser graph", uiProvenance.sources.every((source) => uiModules.includes(`apps/companion/${source.adapted}`)));
const copiedUi = { ...uiProvenance, modules: uiModules, provenance: uiProvenancePath, patch: uiPatchPath,
  notices: [{ path: uiLicensePath, sha256: uiProvenance.licenseSha256 }] };
const legalMarkers = ["Copyright", "Apache License", "Permission is hereby granted", "Redistribution and use", "Microsoft Corporation", "Paul Miller"];
const noticeObservations = assetBytes.filter(({ item }) => /\.(js|html|css)$/.test(item.fileName)).map(({ item, bytes }) => ({
  file: item.fileName,
  presentLicenseMarkers: legalMarkers.filter((marker) => bytes.toString().toLowerCase().includes(marker.toLowerCase())),
}));
const workflows = [];
for (const name of (await fs.readdir(path.join(root, ".github/workflows"))).sort()) {
  const file = `.github/workflows/${name}`, source = await read(file);
  const actions = [...source.matchAll(/uses:\s+([^\s]+)/g)].map((match) => match[1]);
  check(`${file}: actions pinned by complete commit SHA`, actions.every((action) => /^[^@]+@[a-f0-9]{40}$/.test(action)));
  check(`${file}: read-only contents permission`, /permissions:\s*\n\s+contents: read/.test(source) && !/:\s*write\b|write-all/.test(source));
  check(`${file}: no pull_request_target trigger`, !source.includes("pull_request_target"));
  check(`${file}: checkout credentials not persisted`, source.includes("persist-credentials: false"));
  workflows.push({ path: file, sha256: hash(source), actions });
}
check("Host CI suppresses npm installation lifecycle scripts", (await read(".github/workflows/ci.yml")).includes("npm ci --ignore-scripts"));
const sourcePaths = [...new Set([
  fontProvenancePath, fontLicensePath, ...fontAssets.map((asset) => asset.sourcePath),
  uiProvenancePath, uiLicensePath, uiPatchPath, ...uiSourcePaths,
  ...manifestPaths, "package-lock.json", "apps/companion/vite.config.ts", "apps/companion/tailwind.config.ts", "apps/companion/index.html", "apps/companion/live.html", "apps/companion/src/web-server.ts",
  "tools/dependency-supply-review/upstream-notices/provenance.json",
  "tools/dependency-supply-review/review.mjs", "tools/dependency-supply-review/generate-notices.mjs", "tools/dependency-supply-review/notices.test.mjs", "docs/live-app.md",
  "apps/ledger-bitcoin-prl/UPSTREAM.json", "apps/ledger-bitcoin-prl/UPSTREAM_TREE.txt",
  "tools/bitcoin-prl-port/build.sh", "tools/bitcoin-prl-port/provenance.py", "tools/bitcoin-prl-port/README.md",
  "apps/ledger/packaging-requirements.txt", "docs/licensing.md", "docs/implementation-status.md", "docs/test-evidence.md",
  "README.md", "SECURITY.md", ...workflows.map((entry) => entry.path),
  ...modules.filter((name) => !name.includes("\0") && !name.includes("?") && !name.startsWith("../") && name !== "__vite-browser-external"),
])].sort();
const sourceHashes = {};
for (const file of sourcePaths) sourceHashes[file] = hash(await fs.readFile(path.join(root, file)));
const report = {
  schema: 2, reviewedOn: "2026-10-10", head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  nodeVersion: process.version, lockfileSha256: hash(await read("package-lock.json")),
  checks, counts: { registryRecords: registryRecords.length, installedRegistryRecords: registryRecords.length - missingInstalled.length,
    missingOptionalPlatformPackages: missingInstalled.length, browserMainModules: mainModules.size, browserWorkerModules: workerModules.size,
    browserCssInputs: cssModules.size, browserUnionModules: modules.length, browserPackages: browserPackages.length },
  installedMismatches, missingInstalled, installLifecycle, browserPackages, noticeObservations, fonts, copiedUi,
  chunks: assetBytes.map(({ item, bytes }) => ({ file: item.fileName, type: item.type, bytes: bytes.length, sha256: hash(bytes), modules: chunkModules.get(item.fileName) ?? [],
    cssModules: item.fileName.endsWith(".css") ? [...cssModules].sort() : [] })),
  workflows, mainModules: [...mainModules].sort(), workerModules: [...workerModules].sort(), cssModules: [...cssModules].sort(), registryRecords, sourceHashes,
  limits: ["Structural tarball integrity and installed package version checks do not authenticate installed file contents.",
    "No dependency installation/update, native toolchain/build/emulator, physical Ledger, secrets, live indexer, deployment or fund movement.",
    "Only known public fixture markers and reachable module paths are screened; this is not universal secret detection.",
    "This is source-bound software evidence, not human audit, vendor approval or release qualification."],
};
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ pass: checks.length, counts: report.counts, installLifecycle, noticeObservations, chunks: report.chunks }, null, 2));
