/** Address derivation and account validation remain in the browser, including on a hosted origin. */
import { assert, type NetworkName } from "@pearl-ledger/sdk";
import {
  BlockbookSource,
  BLOCKBOOK_HOSTS,
  lightNetwork,
} from "./blockbook-source.js";
export function browserPublicSource(
  network: NetworkName,
  consent: boolean,
  signal?: AbortSignal,
): BlockbookSource {
  assert(consent, "Approve public address disclosure first");
  const selected = lightNetwork(network);
  const base = BLOCKBOOK_HOSTS[selected];
  const proxyFetch: typeof fetch = async (input, init) => {
    assert(
      typeof input === "string" && input.startsWith(base + "/api/v2/"),
      "Unexpected public source",
    );
    const response = await fetch("/api/indexer/read", {
      method: "POST",
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      headers: { "content-type": "application/json", "x-pearl-companion": "1" },
      body: JSON.stringify({
        network: selected,
        consent: true,
        path: input.slice(base.length),
      }),
      signal: init?.signal ?? null,
    });
    return response;
  };
  return new BlockbookSource(selected, proxyFetch, signal);
}
