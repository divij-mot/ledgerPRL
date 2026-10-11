/** Evaluate only the pinned installed host's manifest schema and pure Zod dependencies.
 * No Electron renderer bootstrap, user profile, device, network or app import. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import vm from "node:vm";
const rendererPath =
  process.argv[2] ??
  "/private/tmp/ledger-wallet-4.23-readonly/renderer.bundle.js";
const source = await readFile(rendererPath, "utf8");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const expectedHash =
  "936ae9c4eaf9c38bbb58bd1337cab3cffbbd5bf658769938b371a49124f6ff02";
assert.equal(
  digest(source),
  expectedHash,
  "Installed Ledger 4.23 renderer identity mismatch",
);
const prefix = "(()=>{var __webpack_modules__=";
assert(source.startsWith(prefix));
const end = source.indexOf(",__webpack_module_cache__={}");
assert(end > prefix.length);
const sandbox = vm.createContext({ URL, TextDecoder, TextEncoder });
vm.runInContext(
  "globalThis.modules=" + source.slice(prefix.length, end),
  sandbox,
  { timeout: 15_000 },
);
const modules = sandbox.modules;
const cache = new Map();
const executed = [];
function requireModule(id) {
  if (cache.has(id)) return cache.get(id).exports;
  // These schema-module imports only construct unrelated exported currency maps.
  // Manifest schema fields themselves use the actual host Zod module unchanged.
  if (id === 292009)
    return { FAMILIES: {}, CurrencyType: {}, TokenStandard: {} };
  if (id === 807082)
    return {
      ey: (value) =>
        Object.fromEntries(Object.entries(value).map(([k, v]) => [v, k])),
    };
  assert(modules[id], `Missing extracted dependency ${id}`);
  assert(executed.length < 40, "Unexpected non-schema dependency graph");
  const module = { exports: {} };
  cache.set(id, module);
  executed.push(id);
  modules[id](module, module.exports, requireModule);
  return module.exports;
}
requireModule.d = (exports, getters, values) => {
  for (const [definitions, type] of [
    [getters, "get"],
    [values, "value"],
  ])
    for (const [key, value] of Object.entries(definitions ?? {}))
      if (!Object.hasOwn(exports, key))
        Object.defineProperty(exports, key, {
          enumerable: true,
          [type]: value,
        });
};
requireModule.o = (value, key) => Object.hasOwn(value, key);
requireModule.r = (exports) =>
  Object.defineProperty(exports, "__esModule", { value: true });
requireModule.n = (value) => () => (value.__esModule ? value.default : value);
const schema = requireModule(502606).eq;
assert(schema?.safeParse, "Pinned host manifest validator missing");
const localPath = new URL(
  "../../apps/companion/ledger-live.manifest.json",
  import.meta.url,
);
const hostedPath = new URL(
  "../../apps/companion/ledger-live.hosted.manifest.json",
  import.meta.url,
);
const localBytes = await readFile(localPath);
const hostedBytes = await readFile(hostedPath);
const local = JSON.parse(localBytes),
  hosted = JSON.parse(hostedBytes);
assert.equal(
  schema.safeParse(local).success,
  true,
  "Existing local manifest rejected by host schema",
);
const result = schema.safeParse(hosted);
assert.equal(result.success, true, JSON.stringify(result.error));
assert.deepEqual(hosted.platforms, ["desktop", "android", "ios"]);
assert.equal(hosted.url, "https://pearl-ledger-wallet.vercel.app/live.html");
assert.equal(hosted.homepageUrl, hosted.url);
assert.deepEqual(hosted.domains, ["https://pearl-ledger-wallet.vercel.app"]);
assert.deepEqual(hosted.permissions, [
  "wallet.capabilities",
  "device.transport",
  "device.exchange",
  "device.close",
]);
assert.equal(hosted.private, true);
assert.equal(hosted.branch, "debug");
assert(!Object.hasOwn(hosted, "dapp"));
const singular = { ...hosted, platform: "all" };
delete singular.platforms;
assert.equal(
  schema.safeParse(singular).success,
  false,
  "Obsolete singular platform unexpectedly accepted",
);
assert.equal(
  schema.safeParse({ ...hosted, platforms: ["mobile"] }).success,
  false,
  "Invalid mobile enum unexpectedly accepted",
);
assert.equal(
  digest(await readFile(localPath)),
  digest(localBytes),
  "Local manifest changed",
);
const report = {
  hostVersion: "4.23.0",
  rendererSha256: expectedHash,
  schemaModule: 502606,
  zodModule: 378008,
  pureModulesExecuted: executed,
  tests: {
    localManifest: true,
    hostedManifest: true,
    exactOrigin: true,
    exactFourPermissions: true,
    desktopAndroidAndIos: true,
    rejectSingularPlatform: true,
    rejectMobilePlatform: true,
    localManifestUnchanged: true,
  },
  hostedManifestSha256: digest(hostedBytes),
  localManifestSha256: digest(localBytes),
  importedIntoLedger: false,
  catalogPublished: false,
  physicalAndroidQualified: false,
  physicalIosQualified: false,
};
await writeFile(
  new URL("./manifest-validation.json", import.meta.url),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(JSON.stringify(report, null, 2));
