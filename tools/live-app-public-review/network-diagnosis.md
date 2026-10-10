# Public-service and P2P diagnosis — 2026-10-10

The configured official Blockbook hostnames and API paths are correct. No supported first-party alternate public API was established. From this Mac, HTTPS fails before TCP connection on both indexer hosts, including their root pages; changing a URL path or JSON parser cannot repair that failure. No production source, DNS, routing, TLS, proxy or security setting was changed.

## Direct network evidence

| Destination | Verified normal HTTPS result |
| --- | --- |
| `blockbook.pearlresearch.ai/` and `/api/v2/` | TCP:443 timeout after ~8 seconds; HTTP `000`; no TLS session |
| `blockbook.testnet.pearlresearch.ai/` and `/api/v2/` | Same TCP timeout |
| `pearlresearch.ai/` | Same TCP timeout |
| `api.github.com/` | HTTP 200; TCP ~122 ms, TLS ~146 ms |
| `dns.google/` | HTTP 200; TCP ~87 ms, TLS ~117 ms |
| `example.com/` | HTTP 200; TCP ~98 ms, TLS ~120 ms |

Normal local Chrome navigation also timed out. Targeted route inspection reports `en0`. This is selective reachability, not a general lack of internet access. The available evidence does not identify whether the cause is a destination-side filter, regional routing or local/network filtering.

Local DNS, Google DNS-over-HTTPS, and direct authoritative queries agree:

- Mainnet A: `136.69.18.254`, TTL 300. Authoritative answer (`aa`) from `ns-cloud-c1.googledomains.com`.
- Testnet A: `34.107.185.250`, TTL 300. The `testnet.pearlresearch.ai` zone delegates to `ns-cloud-e1..e4.googledomains.com`; `ns-cloud-e1` returned the matching authoritative answer.
- Both authoritative zones return no AAAA record. Google also returns no CNAME. A stale local DNS record or IPv6 preference is not supported by these observations.

Representative commands (public data only):

```sh
curl --silent --show-error --connect-timeout 8 --max-time 10 --output /dev/null --write-out '%{http_code} %{time_connect} %{time_appconnect}\n' https://blockbook.pearlresearch.ai/api/v2/
dig @ns-cloud-c1.googledomains.com blockbook.pearlresearch.ai A +norecurse
dig @ns-cloud-e1.googledomains.com blockbook.testnet.pearlresearch.ai A +norecurse
route -n get 136.69.18.254
```

## Remote web retrieval is different evidence

The web-retrieval tool returned a **crawled-today page**, not a direct API test from this Mac, for [official mainnet Blockbook](https://blockbook.pearlresearch.ai/): synchronized, height 125811, Blockbook `81f52f2`, backend `1.4.6`. It also returned [the official explorer UI](https://explorer.pearlresearch.ai/?network=mainnet) with recent blocks. API URLs were inaccessible through that tool. These pages establish useful source/context evidence but may be cached; they do not establish present direct API reachability or a successful wallet query. The explorer was not treated as an undocumented REST substitute.

Current official repository refs checked through GitHub:

- [Pearl master `2f8b770`](https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/main/clients/blockbook-client.ts) still lists these same Blockbook names. Its historical HTTP defaults are not a reason to downgrade this app.
- [Official Pearl Blockbook `81f52f2`](https://github.com/pearl-research-labs/blockbook/blob/81f52f217843429ccbf27df4ec5f983891aaa6d7/openapi.yaml) specifies the v2 status/block/address/UTXO/transaction paths and the v1 fee-estimate path already used here.
- [Official coin configuration](https://github.com/pearl-research-labs/blockbook/blob/81f52f217843429ccbf27df4ec5f983891aaa6d7/configs/coins/pearl.json) has backend RPC 44107, internal indexer 9031 and public indexer 9131. These are deployment ports, not documented alternate hosted endpoints. The packaging config contains a placeholder backend download URL, so it must not be blindly installed as a production recipe.

## Bounded P2P feasibility check

After explicit authorization, queried the three mainnet DNS seeds in [official chain parameters](https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/chaincfg/params.go). Each returned 25 peers. Made one TCP connection to one distinct advertised peer per seed, on the documented port 44108 only:

| Seed | Selected advertised peer | TCP result |
| --- | --- | --- |
| `reef.seeder.pearlnetwork.net` | `136.107.223.121:44108` | Connected, 74 ms |
| `tide.seeder.pearlnetwork.net` | `104.154.133.78:44108` | Connected, 57 ms |
| `stream.seeder.pearlnetwork.net` | `104.155.193.64:44108` | Connected, 160 ms |

No protocol bytes were sent. This proves P2P TCP reachability only, not handshake compatibility, chain identity, header validation or completed SPV sync. No user addresses, account keys, seeds, wallet files or transactions were read/transmitted.

## Practical conclusion

For the existing public API path, preserve the correct HTTPS endpoints and fail closed. A bounded, read-only remote CI smoke test against the same pinned status/genesis checks can distinguish remote API health from this Mac's egress failure; it would not itself repair local reachability. No verified alternate endpoint was available to substitute.

The newly authorized official SPV route has positive TCP evidence and avoids the blocked HTTP service, but requires an actual watch-only integration with chain/filter validation and explicit sync completeness. The [official SPV API](https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/spv/README.md) uses headers and compact filters, downloads relevant blocks on demand, and reports rescan transactions only once confirmed; unconfirmed/mempool semantics must not be invented. A full node/indexer was neither installed nor started. The existing private-node bridge checks known snapshots and transactions; it is not a drop-in account-discovery replacement. See [verified runtime inspection](spv-runtime.md) for the downloaded official artifact and its current limitations.
