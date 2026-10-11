/** Read-only public fixture smoke test. Never deposit funds at these addresses. */
import { writeFileSync } from "node:fs";
import {
  BlockbookSource,
  BLOCKBOOK_HOSTS,
} from "../../apps/companion/src/blockbook-source.js";

const fixtures = {
  mainnet: "prl1pdmqd2wzd3e2unrkvq880t24acsrf8zffzqjqr356pmd93cve9eqs4u7tjx",
  testnet2: "tprl1pzh75rtx74l85v2xqfr5uln7mhy40vyqzm68ml4yngcqy9v085tqqg5e3rn",
} as const;
const result: any = {
  startedAt: new Date().toISOString(),
  scope:
    "Actual BlockbookSource, read-only public BIP32 fixtures; no signing, account keys, broadcast, consensus or real transaction acceptance test.",
  maximumRequests: 16,
  requests: [],
  networks: {},
};
const controller = new AbortController();
let calls = 0;
let stop = false;
for (const network of ["mainnet", "testnet2"] as const) {
  if (stop) break;
  const address = fixtures[network];
  const observedFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    if (++calls > 16) throw new Error("Global request budget exceeded");
    if (
      url.origin !== BLOCKBOOK_HOSTS[network] ||
      (init?.method ?? "GET") !== "GET" ||
      !(
        url.pathname === "/api/v2/" ||
        /^\/api\/v2\/block-index\/[0-9]+$/.test(url.pathname) ||
        url.pathname === `/api/v2/address/${address}` ||
        url.pathname === `/api/v2/utxo/${address}`
      )
    ) {
      throw new Error(
        "Probe refused a request outside its public read-only scope",
      );
    }
    const item: any = {
      at: new Date().toISOString(),
      url: url.href,
      method: "GET",
    };
    result.requests.push(item);
    try {
      const response = await fetch(input, init);
      item.status = response.status;
      item.headers = Object.fromEntries(
        [
          "content-type",
          "content-length",
          "access-control-allow-origin",
          "date",
        ].map((k) => [k, response.headers.get(k)]),
      );
      // A clone is read locally, with no additional HTTP request. Strict one-MiB evidence cap.
      const reader = response.clone().body?.getReader();
      if (reader) {
        let bytes = 0;
        const chunks: Uint8Array[] = [];
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          if (bytes > 1024 * 1024) {
            await reader.cancel();
            throw new Error("Evidence response exceeded one MiB");
          }
          chunks.push(chunk.value);
        }
        const text = Buffer.concat(chunks).toString("utf8");
        try {
          item.body = JSON.parse(text);
        } catch {
          item.body = text.slice(0, 1000);
        }
      }
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 451
      )
        stop = true;
      return response;
    } catch (error: any) {
      item.error = {
        name: error.name,
        message: error.message,
        cause: error.cause?.message,
        code: error.cause?.code,
      };
      stop = true; // No retries, escalation, alternate host or tool route after a transport failure.
      throw error;
    }
  };
  const source = new BlockbookSource(network, observedFetch, controller.signal);
  const entry: any = { fixture: address };
  result.networks[network] = entry;
  try {
    const start = await source.tip();
    entry.tip = start;
    entry.activity = await source.address(address);
    // Empty address() intentionally skips UTXOs; explicitly smoke-test the fixed fixture endpoint.
    if (!entry.activity.used) entry.utxos = await source.unspent(address);
    entry.originalTipStillPresent =
      (await source.blockHash(start.tip.height)) === start.tip.hash;
    if (!entry.originalTipStillPresent)
      throw new Error("Original tip hash changed during public smoke test");
    entry.passed = true;
  } catch (error: any) {
    entry.passed = false;
    entry.error = {
      name: error.name,
      message: error.message,
      cause: error.cause?.message,
      code: error.cause?.code,
    };
  }
}
result.finishedAt = new Date().toISOString();
result.requestCount = calls;
result.stoppedAfterTransportOrAccessFailure = stop;
writeFileSync(
  new URL("./live-results.json", import.meta.url),
  JSON.stringify(result, null, 2) + "\n",
);
console.log(JSON.stringify(result, null, 2));
if (Object.values(result.networks).some((n: any) => !n.passed))
  process.exitCode = 1;
