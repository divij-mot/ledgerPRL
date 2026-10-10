/** Public-fixture, local-filesystem CLI probe. No network/native transport is created. */
import { build } from "esbuild";
import { createRequire } from "node:module";
import * as fs from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import * as sdk from "@pearl-ledger/sdk";
import { networkInfo, publicFixture, yielded } from "../../packages/bitcoin-prl-adapter/test/fixtures.js";

const [mode, bundlePath, accountPath, outputPath] = process.argv.slice(2);
assert.ok(mode && bundlePath && accountPath && outputPath);
const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = publicFixture();
const protocol = JSON.parse(await fs.readFile(resolve(root, "packages/bitcoin-prl-adapter/test/fixtures/ledger-psbt-v2.json"), "utf8"));
let signatures = 0, finalAcks = 0, truncates = 0, intentSeen = false;
let immutableIntent: string | undefined;
const ok = (bytes: Uint8Array = new Uint8Array()) => sdk.concat(bytes, Uint8Array.of(0x90, 0));
class FixtureTransport {
  async exchange(apdu: Uint8Array): Promise<Uint8Array> {
    if (apdu[0] === 0xe1) {
      if (apdu[1] === 6) {
        const saved = JSON.parse(await fs.readFile(outputPath!, "utf8"));
        assert.equal(saved.kind, "pearl-cli-signing-uncertain");
        immutableIntent = await fs.readFile(`${outputPath!}.intent.json`, "utf8");
        assert.equal(JSON.parse(immutableIntent).kind, saved.kind);
        assert.deepEqual(JSON.parse(immutableIntent).bundle, saved.bundle);
        intentSeen = true;
        return ok(networkInfo());
      }
      if (apdu[1] === 5) return ok(fixture.account.masterFingerprint);
      if (apdu[1] === 0) return ok(new TextEncoder().encode(protocol.accountXpub));
      assert.equal(sdk.hex(apdu), protocol.signPsbtApduHex);
    } else assert.equal(sdk.hex(apdu), "f801000100");
    if (signatures < fixture.signatures.length)
      return sdk.concat(yielded(fixture.bundle, fixture.signatures, signatures++), Uint8Array.of(0xe0, 0));
    finalAcks++;
    const saved = JSON.parse(await fs.readFile(outputPath!, "utf8"));
    assert.equal(saved.rawTx, fixture.rawTx);
    return ok();
  }
  async close() {}
}
const realOpen = fs.open;
const injectedFs = {
  ...fs,
  async open(path: Parameters<typeof fs.open>[0], flags: Parameters<typeof fs.open>[1], fileMode?: number) {
    const file = await realOpen(path, flags, fileMode);
    if (String(path) !== resolve(outputPath!) || flags !== "wx") return file;
    return new Proxy(file, {
      get(target, property) {
        if (property === "truncate") return async (size: number) => {
          truncates++;
          await target.truncate(size);
          if (truncates === 2 && mode === "crash-after-truncate") {
            process.send?.({ event: "signed-replacement-truncated", signatures, finalAcks, intentSeen, truncates });
            await new Promise(() => {});
          }
        };
        if (property === "write") return async (...args: any[]) => {
          if (truncates === 2 && mode === "fail-signed-write") {
            const error = new Error("Synthetic ENOSPC after signed replacement truncate");
            Object.assign(error, { code: "ENOSPC" });
            throw error;
          }
          return (target.write as any)(...args);
        };
        const value = Reflect.get(target, property, target);
        return typeof value === "function" ? value.bind(target) : value;
      },
    });
  },
};
const compiled = await build({
  entryPoints: [resolve(root, "apps/cli/src/index.ts")],
  bundle: true, write: false, platform: "node", format: "cjs", logLevel: "silent",
  external: ["@pearl-ledger/sdk", "@pearl-ledger/bitcoin-prl-adapter"],
});
const require = createRequire(import.meta.url);
const module = { exports: {} as { main: (args: string[]) => Promise<void> } };
const injectedRequire = (name: string) => name === "node:fs/promises" ? injectedFs
  : name === "@pearl-ledger/sdk" ? { ...sdk, SpeculosTransport: FixtureTransport }
  : require(name);
new Function("require", "module", "exports", compiled.outputFiles[0]!.text.replace(/^#![^\n]*\n/, ""))(injectedRequire, module, module.exports);
try {
  await module.exports.main(["sign", bundlePath, accountPath, outputPath, "fixture:no-network"]);
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  if (immutableIntent !== undefined)
    assert.equal(await fs.readFile(`${outputPath!}.intent.json`, "utf8"), immutableIntent);
  process.send?.({ event: "finished", signatures, finalAcks, intentSeen, truncates });
}
