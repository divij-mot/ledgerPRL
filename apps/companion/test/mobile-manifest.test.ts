import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("mobile import preserves wallet identity and permissions without triggering native cache busting", () => {
  const desktop = JSON.parse(
    readFileSync(
      new URL("../ledger-live.hosted.manifest.json", import.meta.url),
      "utf8",
    ),
  );
  const mobile = JSON.parse(
    readFileSync(
      new URL("../ledger-live.mobile.manifest.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(
    desktop.cacheBustingId,
    1,
    "Do not migrate the desktop storage partition",
  );
  assert(!Object.hasOwn(mobile, "cacheBustingId"));
  assert(
    !Object.hasOwn(mobile, "nocache"),
    "Mobile storage must stay persistent",
  );
  assert.deepEqual(mobile.platforms, ["ios", "android"]);
  assert.deepEqual(desktop.platforms, ["desktop", "android", "ios"]);
  assert.equal(mobile.id, "pearl-hosted");
  assert.equal(mobile.url, "https://pearl-ledger-wallet.vercel.app/live.html");
  assert.deepEqual(mobile.permissions, [
    "wallet.capabilities",
    "device.transport",
    "device.exchange",
    "device.close",
  ]);
  const {
    platforms: desktopPlatforms,
    cacheBustingId,
    ...desktopContract
  } = desktop;
  const { platforms: mobilePlatforms, ...mobileContract } = mobile;
  assert.deepEqual(mobileContract, desktopContract);
});
