/** Deterministic source/build boundary review. No network, native app, emulator,
 * browser profile, device, software signing, broadcast, or secret input is used. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build as viteBuild } from "vite";
import { HDKey } from "@scure/bip32";
import { base58check } from "@scure/base";
import * as sdk from "../../packages/sdk/src/index.ts";
import * as adapter from "../../packages/bitcoin-prl-adapter/src/index.ts";
import * as wallet from "../../packages/wallet/src/index.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const here = path.join(root, "tools/website-privacy-review");
const read = (p) => fs.readFile(path.join(root, p), "utf8");
const psbtFixture = JSON.parse(
  await read("packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json"),
);
const cases = [];
function check(name, fn) {
  fn();
  cases.push({ name, pass: true });
}
const sample = JSON.parse(
  await read("apps/companion/public/example-watch.json"),
);
const account = sdk.accountFromJson(sample.account);
check(
  "Exact public-account import refuses seed, mnemonic, privateKey, xprv and extra properties",
  () => {
    for (const field of [
      "seed",
      "mnemonic",
      "privateKey",
      "xprv",
      "password",
      "__proto__",
    ]) {
      const input = JSON.parse(JSON.stringify(sample.account));
      Object.defineProperty(input, field, {
        value: "PUBLIC-REJECTION-CANARY",
        enumerable: true,
      });
      assert.throws(() => sdk.accountFromJson(input));
    }
  },
);
check(
  "Account xpub parser rejects an extended-private version without using a secret",
  () => {
    const codec = base58check(sdk.sha256);
    const bytes = codec.decode(psbtFixture.accountXpub);
    const network =
      new DataView(bytes.buffer, bytes.byteOffset).getUint32(0) === 0x0488b21e
        ? "mainnet"
        : "regtest";
    const index =
      new DataView(bytes.buffer, bytes.byteOffset).getUint32(9) - 0x80000000;
    const privateVersion = bytes.slice();
    new DataView(privateVersion.buffer, privateVersion.byteOffset).setUint32(
      0,
      network === "mainnet" ? 0x0488ade4 : 0x04358394,
    );
    assert.throws(
      () =>
        adapter.parseAccountXpub(
          codec.encode(privateVersion),
          account.masterFingerprint,
          network,
          index,
        ),
      /xpub version/,
    );
  },
);
check(
  "Browser public derivation creates public-only HDKey parents and children",
  () => {
    const original = HDKey.prototype.deriveChild;
    let count = 0;
    HDKey.prototype.deriveChild = function (index) {
      assert.equal(this.privateKey, null);
      const result = original.call(this, index);
      assert.equal(result.privateKey, null);
      count++;
      return result;
    };
    try {
      for (const branch of [0, 1])
        for (const index of [0, 1, 20, 979]) {
          const result = sdk.deriveAddress(account, branch, index);
          assert.equal(result.scriptPubKey.length, 34);
        }
      assert.equal(count, 16);
    } finally {
      HDKey.prototype.deriveChild = original;
    }
  },
);
check(
  "Default journal and its lookup key contain no full derivation key",
  () => {
    const row = wallet.emptyJournal(),
      id = wallet.accountId(account);
    assert.deepEqual(Object.keys(row).sort(), [
      "issuedReceiveThrough",
      "nextChangeIndex",
      "payments",
      "schema",
    ]);
    assert.match(id, /^[a-z0-9]+:[0-9]+:[0-9a-f]{64}$/);
    for (const datum of [
      sdk.hex(account.publicKey),
      sdk.hex(account.chainCode),
    ])
      assert(!JSON.stringify({ id, row }).includes(datum));
  },
);
check(
  "Public recovery intentionally exports full public derivation metadata",
  () => {
    const exported = JSON.parse(
      wallet.exportPublicRecovery(account, wallet.emptyJournal()),
    );
    assert.deepEqual(exported.account, sample.account);
    assert.equal(exported.account.chainCode, sdk.hex(account.chainCode));
  },
);
const captures = [];
const workerModules = [];
const result = await viteBuild({
  root: path.join(root, "apps/companion"),
  configFile: path.join(root, "apps/companion/vite.config.ts"),
  logLevel: "error",
  build: { write: false },
  worker: {
    plugins: () => [
      {
        name: "privacy-review-worker-graph",
        generateBundle(_options, bundle) {
          for (const item of Object.values(bundle))
            if (item.type === "chunk")
              workerModules.push(
                ...Object.keys(item.modules).map((p) => p.replace(root, "")),
              );
        },
      },
    ],
  },
  plugins: [
    {
      name: "privacy-review-module-graph",
      generateBundle(_options, bundle) {
        for (const [file, item] of Object.entries(bundle))
          captures.push({
            file,
            type: item.type,
            modules:
              item.type === "chunk"
                ? Object.keys(item.modules).map((p) => p.replace(root, ""))
                : [],
            code: item.type === "chunk" ? item.code : String(item.source),
          });
      },
    },
  ],
});
const mainModules = [...new Set(captures.flatMap((c) => c.modules))].sort();
const modules = [...new Set([...mainModules, ...workerModules])].sort();
const browserCode = captures
  .filter((c) => c.file.endsWith(".js"))
  .map((c) => c.code)
  .join("\n");
check(
  "Production browser graph excludes server/bridge, tests/fixtures, CLI, Snap and legacy device entry",
  () => {
    for (const module of modules)
      assert(
        !/(?:^|\/)test\/|(?:^|\/)fixtures\/|apps\/cli\/|packages\/snap\/|node_modules\/@metamask\/|apps\/companion\/src\/(?:bridge|blockbook\.ts|indexer-proxy|web-server)|packages\/sdk\/src\/device\.ts/.test(
          module,
        ),
        module,
      );
  },
);
check(
  "Emitted browser code contains no RPC configuration, private-node server implementation or Node secret environment access",
  () => {
    for (const marker of [
      "PEARL_RPC_PASSWORD",
      "PEARL_RPC_USER",
      "PEARL_RPC_URL",
      "createNodeRpc",
      "process.env.PEARL",
    ])
      assert(!browserCode.includes(marker), marker);
  },
);
const builder = await read(
  "node_modules/@ledgerhq/device-management-kit/lib/esm/src/api/DeviceManagementKitBuilder.js",
);
const ledger = await read("apps/companion/src/ledger.ts");
check(
  "Pinned production DMK builder has no log subscribers and companion disables the refresher",
  () => {
    assert.match(builder, /loggers=\[\]/);
    assert(!ledger.includes(".addLogger("));
    assert(ledger.includes("isRefresherDisabled: true"));
  },
);
const appSources = [
  "apps/companion/src/main.ts",
  "apps/companion/src/ledger.ts",
  "apps/companion/src/public-source.ts",
  "apps/companion/src/storage.ts",
  "packages/sdk/src/keys.ts",
  "packages/bitcoin-prl-adapter/src/client.ts",
];
for (const source of appSources) {
  const text = await read(source);
  assert(
    !/\b(?:schnorr|secp256k1)\.sign\(|HDKey\.fromMasterSeed\(|HDKey\.fromExtendedKey\(/.test(
      text,
    ),
    source,
  );
}
cases.push({
  name: "Reviewed production entry points do not call private key import or software signing APIs",
  pass: true,
});
const dependencies = {
  generalPurposePrivateKeyCapabilitiesRemainBundled: {
    fromMasterSeed: browserCode.includes("fromMasterSeed("),
    privateExtendedKey: browserCode.includes("privateExtendedKey"),
    privateKeySignGuard:
      browserCode.includes("No privateKey set!") ||
      browserCode.includes("No private key"),
  },
  vendorNetworkConstantsRemainBundled: [
    "https://manager.api.live.ledger.com/api",
    "wss://scriptrunner.api.live.ledger.com/update",
  ].filter((s) => browserCode.includes(s)),
  ledgerLoggerSubscribers: 0,
  note: "Presence of generic cryptographic/network implementation is not evidence that production flow uses a private key, calls software signing, or contacts these vendor endpoints.",
};
const sources = [
  ...new Set([
    ...modules.filter(
      (x) =>
        !x.startsWith("node_modules") &&
        !x.startsWith("\0") &&
        !x.includes("?") &&
        !x.startsWith("../"),
    ),
    "apps/companion/src/indexer-proxy.ts",
    "apps/companion/src/web-server.ts",
    "apps/companion/src/storage.ts",
    "packages/wallet/src/journal.ts",
    "packages/wallet/src/recovery.ts",
    "node_modules/@scure/bip32/lib/esm/index.js",
    "node_modules/@ledgerhq/device-management-kit/lib/esm/src/api/DeviceManagementKitBuilder.js",
    "node_modules/@ledgerhq/device-transport-kit-web-hid/lib/esm/api/transport/WebHidTransport.js",
    "node_modules/@ledgerhq/device-transport-kit-web-hid/lib/esm/api/transport/WebHidApduSender.js",
    "node_modules/@sentry/hub/esm/hub.js",
    "package.json",
    "package-lock.json",
    "apps/companion/vite.config.ts",
  ]),
];
const hashes = {};
for (const file of sources) {
  hashes[file] = createHash("sha256")
    .update(await fs.readFile(path.join(root, file)))
    .digest("hex");
}
const report = {
  schema: 1,
  scope:
    "Deterministic public-data/source/build boundary checks; no native/emulator or real browser/hardware execution",
  cases,
  dependencies,
  chunks: captures.map((c) => ({
    file: c.file,
    type: c.type,
    bytes: Buffer.byteLength(c.code),
    sha256: createHash("sha256").update(c.code).digest("hex"),
  })),
  modules,
  mainModules,
  workerModules: [...new Set(workerModules)].sort(),
  sourceHashes: hashes,
};
await fs.writeFile(
  path.join(here, "results.json"),
  JSON.stringify(report, null, 2) + "\n",
);
console.log(
  JSON.stringify(
    {
      checks: cases.length,
      allPassed: true,
      modules: modules.length,
      mainModules: mainModules.length,
      workerModules: new Set(workerModules).size,
      dependencies,
      chunks: report.chunks,
    },
    null,
    2,
  ),
);
