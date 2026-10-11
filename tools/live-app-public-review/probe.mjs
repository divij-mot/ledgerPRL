/** Opt-in live READ-ONLY probe. Fixed pinned services; only repository public fixture addresses. */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { BlockbookSource } from "../../apps/companion/src/blockbook-source.ts";
import { browserPublicSource } from "../../apps/companion/src/public-source.ts";
import { discoverAccount } from "../../packages/wallet/src/index.ts";
import { NETWORKS } from "../../packages/sdk/src/index.ts";
import { publicAccount } from "../../packages/wallet/test/fixtures.ts";

const origin = "http://127.0.0.1:5188";
const nativeFetch = globalThis.fetch;
const report = { checkedAt: new Date().toISOString(), origin, fixture: "packages/wallet/test/fixtures.ts publicAccount", cases: [] };
const server = await nativeFetch(origin + "/live.html", { method: "HEAD", signal: AbortSignal.timeout(5_000), redirect: "error" });
assert.equal(server.status, 200, "Existing authorized local test server must be running");
const proxyCalls = [];
// Node supplies the Origin/Fetch-Metadata headers a browser adds automatically.
// Production browserPublicSource still constructs the real allowlisted proxy body.
globalThis.fetch = (input, init) => {
  if (input !== "/api/indexer/read") return nativeFetch(input, init);
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["consent", "network", "path"]);
  proxyCalls.push({ network: body.network, kind: body.path.includes("/address/") ? "public-fixture-address" : body.path });
  return nativeFetch(origin + input, { ...init, headers: { ...init.headers, origin, "sec-fetch-site": "same-origin" } });
};
const failure = (error) => ({ name: error?.name, message: error?.message, causeCode: error?.cause?.code });
async function measure(network, mode) {
  const source = mode === "proxy" ? browserPublicSource(network, true) : new BlockbookSource(network);
  const entry = { network, mode, expectedGenesis: NETWORKS[network].genesisHash };
  const started = Date.now();
  try { entry.tip = await source.tip(); entry.tipValidated = true; }
  catch (error) { entry.tipValidated = false; entry.tipError = failure(error); }
  entry.tipElapsedMs = Date.now() - started;
  // Independently check genesis even if current status/tip is unavailable.
  const genesisStarted = Date.now();
  try {
    entry.genesis = await source.blockHash(0);
    entry.genesisValidated = entry.genesis === NETWORKS[network].genesisHash;
    assert(entry.genesisValidated, "Pinned genesis mismatch");
  } catch (error) { entry.genesisValidated = false; entry.genesisError = failure(error); }
  entry.genesisElapsedMs = Date.now() - genesisStarted;
  report.cases.push(entry);
  console.log(JSON.stringify(entry));
  if (mode === "proxy" && entry.tipValidated && entry.genesisValidated) {
    const discoveryStarted = Date.now();
    try {
      const discovered = await discoverAccount(browserPublicSource(network, true, AbortSignal.timeout(90_000)), { ...publicAccount, network });
      entry.discovery = { complete: discovered.complete, coins: discovered.snapshot.coins.length,
        history: discovered.history.length, coverage: discovered.snapshot.coverage, tip: discovered.sourceTip };
    } catch (error) { entry.discovery = { complete: false, error: failure(error) }; }
    entry.discovery.elapsedMs = Date.now() - discoveryStarted;
    console.log(JSON.stringify({ network, discovery: entry.discovery }));
  } else if (mode === "proxy") entry.discovery = { complete: false, skipped: "Pinned status/genesis verification did not complete; no fixture address query sent" };
}
try {
  await Promise.all(["mainnet", "testnet2"].flatMap(network => ["direct", "proxy"].map(mode => measure(network, mode))));
} finally { globalThis.fetch = nativeFetch; }
report.proxyCalls = proxyCalls;
report.finishedAt = new Date().toISOString();
await fs.writeFile(new URL("./results.json", import.meta.url), JSON.stringify(report, null, 2) + "\n");
