/** Read-only host supply-chain review. No installs, native builds, device or indexer use. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { build } from "vite";
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

const mainModules = new Set(), workerModules = new Set();
const graphPlugin = (name, destination) => ({
  name,
  generateBundle(_options, bundle) {
    for (const chunk of Object.values(bundle)) if (chunk.type === "chunk")
      for (const name of Object.keys(chunk.modules)) destination.add(name.replace(root, ""));
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
const modules = [...new Set([...mainModules, ...workerModules])].sort();
const forbiddenModules = modules.filter((name) => /(?:^|\/)(?:test|tests|fixtures)\/|apps\/cli\/|packages\/metamask-snap\/|node_modules\/@metamask\/|apps\/companion\/src\/(?:bridge|blockbook\.ts|indexer-proxy|web-server)|packages\/sdk\/src\/device\.ts/.test(name));
check("Fresh browser graph excludes tests, fixtures, CLI, MetaMask and server/legacy device code", forbiddenModules.length === 0);
const assetBytes = bundles.map((item) => ({ item, bytes: Buffer.from(item.type === "chunk" ? item.code : item.source) }));
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
for (const directory of packageRoots) {
  const packageFile = `${directory}/package.json`;
  const metadata = await json(packageFile);
  const files = (await fs.readdir(path.join(root, directory))).filter((file) => /license|copyright|notice/i.test(file));
  browserPackages.push({
    name: metadata.name, version: metadata.version, directory, license: metadata.license,
    moduleCount: modules.filter((entry) => packageRoot(entry) === directory).length,
    mainModules: [...mainModules].filter((entry) => packageRoot(entry) === directory).sort(),
    workerModules: [...workerModules].filter((entry) => packageRoot(entry) === directory).sort(),
    notices: await Promise.all(files.map(async (file) => ({ path: `${directory}/${file}`, sha256: hash(await read(`${directory}/${file}`)) }))),
  });
}
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
  ...manifestPaths, "package-lock.json", "apps/companion/vite.config.ts", "apps/companion/src/web-server.ts",
  "apps/ledger-bitcoin-prl/UPSTREAM.json", "apps/ledger-bitcoin-prl/UPSTREAM_TREE.txt",
  "tools/bitcoin-prl-port/build.sh", "tools/bitcoin-prl-port/provenance.py", "tools/bitcoin-prl-port/README.md",
  "apps/ledger/packaging-requirements.txt", "docs/licensing.md", "docs/implementation-status.md", "docs/test-evidence.md",
  "README.md", "SECURITY.md", ...workflows.map((entry) => entry.path),
  ...modules.filter((name) => !name.includes("\0") && !name.includes("?") && !name.startsWith("../")),
])].sort();
const sourceHashes = {};
for (const file of sourcePaths) sourceHashes[file] = hash(await fs.readFile(path.join(root, file)));
const report = {
  schema: 1, reviewedOn: "2026-10-09", head: execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim(),
  nodeVersion: process.version, lockfileSha256: hash(await read("package-lock.json")),
  checks, counts: { registryRecords: registryRecords.length, installedRegistryRecords: registryRecords.length - missingInstalled.length,
    missingOptionalPlatformPackages: missingInstalled.length, browserMainModules: mainModules.size, browserWorkerModules: workerModules.size,
    browserUnionModules: modules.length, browserPackages: browserPackages.length },
  installedMismatches, missingInstalled, installLifecycle, browserPackages, noticeObservations,
  chunks: assetBytes.map(({ item, bytes }) => ({ file: item.fileName, type: item.type, bytes: bytes.length, sha256: hash(bytes) })),
  workflows, mainModules: [...mainModules].sort(), workerModules: [...workerModules].sort(), registryRecords, sourceHashes,
  limits: ["Structural tarball integrity and installed package version checks do not authenticate installed file contents.",
    "No dependency installation/update, native toolchain/build/emulator, physical Ledger, secrets, live indexer, deployment or fund movement.",
    "Only known public fixture markers and reachable module paths are screened; this is not universal secret detection.",
    "This is source-bound software evidence, not human audit, vendor approval or release qualification."],
};
await fs.mkdir(output, { recursive: true });
await fs.writeFile(path.join(output, "results.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ pass: checks.length, counts: report.counts, installLifecycle, noticeObservations, chunks: report.chunks }, null, 2));
