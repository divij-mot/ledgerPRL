# Live public-source recheck — 2026-10-10

This opt-in read-only test reused the existing local Pearl server at `http://127.0.0.1:5188`; its `/live.html` HEAD response was HTTP 200. No second server was started.

| Network | Real direct `BlockbookSource` | Real same-origin proxy | Discovery |
| --- | --- | --- | --- |
| Mainnet | Status and genesis each failed with `UND_ERR_CONNECT_TIMEOUT` after approximately 10.5 seconds | Status and genesis each returned the existing HTTP 400 unavailable response | Skipped before address queries |
| Testnet2 | Status and genesis each failed with `UND_ERR_CONNECT_TIMEOUT` after approximately 10.5 seconds | Status and genesis each returned the existing HTTP 400 unavailable response | Skipped before address queries |

`results.json` records exact timings, the unchanged pinned genesis values and every proxy request category. There were **zero address queries**, zero broadcasts and no completed balance result. The optional discovery path uses only `packages/wallet/test/fixtures.ts`'s public-only account, never a user's account or addresses.

The proxy test runs production `browserPublicSource` and `BlockbookSource`; Node supplies the Origin/Fetch-Metadata headers that the browser normally supplies, and resolves the same relative proxy URL to the existing loopback server. No proxy, network, address or genesis guard was replaced. This is a live network test through the actual server, not a browser UI test or a mocked upstream.

A second client (`curl`, normal certificate verification) also timed out after 12 seconds on both fixed status URLs. DNS resolved in 2–4 ms, but no TCP connection or TLS session completed (`curl-output.txt`). This corroborates an endpoint/network reachability problem from this Mac; it does not identify whether the cause is the service, routing or a firewall. There is no evidence here of a Node-only parsing or certificate-validation defect. No production change, path relaxation, TLS bypass or alternate endpoint was made.

Re-run only when live read-only testing is intended and the authorized local server is already running:

```sh
node --import tsx tools/live-app-public-review/probe.mjs
```

The discovery branch runs only after complete pinned status/genesis validation, and remains bounded by the existing gap/response/time limits. Failure is retained as unavailable, never reported as an empty wallet. These results do not establish live balances, sending, confirmation or physical-device behavior.

## Manual remote-network probe

The existing host-check workflow also exposes a manual dispatch that runs this
same read-only probe through a temporary loopback companion on a GitHub runner.
It uses only repository public fixtures, keeps TLS verification enabled, and
requires complete mainnet proxy discovery for success. No Ledger, user account,
signing or broadcast is involved. Both fixed networks are observed; a pass is
read-path evidence only, not funded-transfer qualification. The manual event has
its own concurrency group so it cannot cancel normal CI. This diagnostic helps
distinguish this Mac's egress failures from an upstream API/schema problem.
