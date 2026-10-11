/** Read-only production checks; synthetic candidate files remain in this review folder. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

const root = fileURLToPath(new URL("../../", import.meta.url));
const here = "tools/dependency-supply-review";
test("notices verification accepts exact bytes and rejects a stale distributed file", async () => {
  const temporary = `${here}/.notice-check-${process.pid}.txt`;
  const absolute = path.join(root, temporary);
  const candidate = await fs.readFile(path.join(root, here, "THIRD-PARTY-NOTICES.proposed.txt"));
  const run = () => spawnSync(process.execPath, [`${here}/generate-notices.mjs`, "--check", temporary], { cwd: root, encoding: "utf8" });
  try {
    await fs.writeFile(absolute, candidate);
    let result = run();
    assert.equal(result.status, 0, result.stderr);
    await fs.writeFile(absolute, Buffer.concat([candidate, Buffer.from("\nSTALE-NOTICE-NEGATIVE-CONTROL\n")]));
    result = run();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Distributed notices are stale/);
  } finally {
    await fs.rm(absolute, { force: true });
  }
});

test("notices cover both entries, shared chunks, worker and build-time Lumen CSS", async () => {
  const inventory = JSON.parse(await fs.readFile(path.join(root, here, "license-inventory.json"), "utf8"));
  for (const name of ["index.html", "live.html"])
    assert(inventory.bundles.some((bundle) => bundle.file === name), name);
  const worker = inventory.bundles.find((bundle) => /backup-import\.worker-.*\.js$/.test(bundle.file));
  const styles = inventory.bundles.filter((bundle) => bundle.file.endsWith(".css"));
  assert(worker && styles.length > 0);
  for (const component of inventory.components) {
    assert(component.bundles.length > 0, component.id);
    for (const file of component.bundles)
      assert(inventory.bundles.some((bundle) => bundle.file === file), file);
  }
  const designCore = inventory.components.find((component) => component.name === "@ledgerhq/lumen-design-core");
  assert(designCore?.sourceModules.css.length > 0);
  assert(designCore.bundles.some((file) => styles.some((style) => style.file === file)));
  assert.equal(designCore.license, "Apache-2.0");
  const core = inventory.components.find((component) => component.name === "@ledgerhq/wallet-api-core");
  assert.equal(core.license, "MIT");
  assert.match(core.scope, /Unresolved attribution gap/);
});

test("font notices cover exact unmodified Inter assets and retain the full OFL", async () => {
  const inventory = JSON.parse(await fs.readFile(path.join(root, here, "license-inventory.json"), "utf8"));
  const font = inventory.components.find((component) => component.kind === "copied-font");
  assert.equal(font.license, "OFL-1.1");
  assert.equal(font.bundles.length, 3);
  for (const file of font.bundles) {
    assert.match(file, /^assets\/Inter-(Regular|Medium|SemiBold)-[A-Za-z0-9_-]+\.woff2$/);
    assert(inventory.bundles.some((bundle) => bundle.file === file && bundle.components.includes(font.id)));
  }
  const distributed = await fs.readFile(path.join(root, "apps/companion/public/third-party-notices.txt"));
  const license = await fs.readFile(path.join(root, "apps/companion/src/fonts/OFL.txt"));
  assert(distributed.includes(license));
});

test("adapted Ledger Wallet UI retains its MIT copyright and measured source attribution", async () => {
  const inventory = JSON.parse(await fs.readFile(path.join(root, here, "license-inventory.json"), "utf8"));
  const ui = inventory.components.find((component) => component.kind === "copied-source" && component.repository === "https://github.com/LedgerHQ/ledger-live");
  assert(ui, "Copied Ledger Wallet UI must be separate from the Bitcoin protocol group");
  assert.equal(ui.license, "MIT");
  assert.equal(ui.revision, "abed962b08ca4b746f20192b28ce5b6c06a6c6a4");
  assert(ui.sourceModules.main.length > 0);
  assert(ui.bundles.some((file) => file.endsWith(".js")));
  assert(ui.bundles.some((file) => file.endsWith(".css")));
  const distributed = await fs.readFile(path.join(root, "apps/companion/public/third-party-notices.txt"));
  for (const notice of ui.notices) assert(distributed.includes(await fs.readFile(path.join(root, notice.path))));
  assert(distributed.includes(Buffer.from("Copyright (c) 2017-present Ledger https://www.ledger.com/")));
});
