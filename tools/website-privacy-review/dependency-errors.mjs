/** Pinned real DMK/WebHID dependency error-path check with a fake rejecting HID
 * API. No device selection, real browser, native app or outbound I/O occurs. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
const built = await build({
  entryPoints: [
    fileURLToPath(
      new URL("../../apps/companion/src/ledger.ts", import.meta.url),
    ),
  ],
  bundle: true,
  write: false,
  platform: "browser",
  format: "esm",
  logLevel: "silent",
});
let outbound = 0,
  requests = 0;
const deny = () => {
  outbound++;
  throw Error("Unexpected outbound network from dependency error path");
};
globalThis.fetch = deny;
globalThis.WebSocket = class {
  constructor() {
    deny();
  }
};
globalThis.window = { isSecureContext: true };
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  value: {
    sendBeacon: deny,
    hid: {
      addEventListener() {},
      async getDevices() {
        return [];
      },
      async requestDevice() {
        requests++;
        throw new DOMException("PUBLIC-DEVICE-ERROR-CANARY", "NotFoundError");
      },
    },
  },
});
const api = await import(
  "data:text/javascript;base64," +
    Buffer.from(built.outputFiles[0].text).toString("base64")
);
await assert.rejects(api.connectLedger(undefined, "bitcoin-prl"));
assert.equal(requests, 1);
assert.equal(outbound, 0);
const candidates = [globalThis.__SENTRY__, window.__SENTRY__].filter(Boolean);
assert(
  candidates.length > 0,
  "Expected dependency capture hook to touch default Sentry carrier",
);
for (const carrier of candidates)
  assert.equal(
    carrier.hub?.getClient(),
    undefined,
    "Unexpected configured telemetry client",
  );
const result = {
  scope: "Real pinned DMK/WebHID code; browser HID surface mocked to reject",
  discoveryPickerCalls: requests,
  outboundFetchWebSocketBeaconCalls: outbound,
  defaultSentryClientPresent: false,
  captureHookInvoked: true,
  limitation:
    "One default error path in an isolated Node process; not a complete live-browser/extension audit or guarantee against a separately initialized same-origin Sentry client.",
};
await fs.writeFile(
  new URL("./dependency-errors.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
