# Public Pearl Blockbook backend evidence

Observed 2026-10-09, 14:41–14:46 UTC. These are point-in-time public-service observations, not a service guarantee or independent validation of Pearl consensus. All network calls were read-only HTTPS GETs. No transaction was broadcast, no account or credentials were used, and no user-derived addresses or account public keys were transmitted.

## Integration conclusions

- The mainnet and testnet2 services provide the data needed for a watch-only light companion: address history, UTXO candidates, complete prior transaction bytes, and block-height/hash lookup.
- The host named `blockbook.testnet.pearlresearch.ai` serves **testnet2**, not the original testnet. Require the expected genesis hash and backend chain name; an address prefix alone cannot distinguish these networks.
- Both services returned successful responses to GETs with `Origin: http://localhost:5173`, but **neither returned `Access-Control-Allow-Origin`**. A browser cannot directly read these cross-origin responses under normal CORS enforcement. Use a narrowly allowlisted same-origin proxy. This report checked HTTP headers, not an actual browser request.
- `/tx/{txid}` supplies exact grain strings and raw transaction `hex`. Prefer locally parsed raw outputs over any backend amount claim. `/tx-specific/{txid}` and nested `coinSpecificData` also contain JSON-number PRL amounts; those numbers must never be used for accounting.
- `confirmed=true` includes confirmed but immature coinbases. Actual Pearl UTXO responses omitted a `coinbase` property even for a one-confirmation coinbase. Detect coinbase from raw transaction bytes, and apply the wallet's maturity policy locally.
- Used-but-fully-spent addresses retain transaction history. UTXO count and balance must never determine the derivation gap.
- Mempool transactions were observed, but live exclusion of mempool-spent confirmed inputs could not be established. Fail closed when pending-history completeness or spend status is uncertain.

## Fixed service identities

| Network | API base | Reported backend | Reported tip at initial observation |
| --- | --- | --- | --- |
| mainnet | `https://blockbook.pearlresearch.ai/api/v2` | chain `mainnet`, pearld `1.4.6` | 125415 |
| testnet2 | `https://blockbook.testnet.pearlresearch.ai/api/v2` | chain `testnet2`, pearld `1.4.11` | 108984 |

Both reported Blockbook commit `81f52f2`, version `devel`, build time `2026-08-11T10:42:47+00:00`, `decimals: 8`, `inSync: true`, `initialSync: false`, and `inSyncMempool: true`. These are backend claims.

Relevant status fields, with spelling preserved:

```json
{
  "blockbook": {
    "coin": "Pearl",
    "network": "PRL",
    "bestHeight": 125415,
    "inSync": true,
    "initialSync": false,
    "inSyncMempool": true,
    "decimals": 8
  },
  "backend": {
    "chain": "mainnet",
    "blocks": 125415,
    "headers": 125415,
    "bestBlockHash": "48107a671ce3111f251ae992974325a725562e5925b67da700711e683467dc70",
    "subversion": "/pearlwire:0.5.0/pearld:1.4.6/"
  }
}
```

Genesis GETs matched `packages/sdk/src/network.ts` exactly:

- [Mainnet `/block-index/0`](https://blockbook.pearlresearch.ai/api/v2/block-index/0): `a18d3093b7ff618f0cdd073fa3d10374e2e0105fe7ef53ff48b55f41c58dadd7`
- [Testnet2 `/block-index/0`](https://blockbook.testnet.pearlresearch.ai/api/v2/block-index/0): `b0c86d0cd8825f4d72260d2de46f470429eece413811d5d82b5f2e2ea0336f96`

The response is an object with a `blockHash` string. Mainnet `/block-index/125415` returned the status tip hash above. Testnet2 `/block-index/108984` returned `93b25b1f57e496d1e16a29e809d86844d44038e69a95511ae68441855d0652f6`.

## Public deterministic empty-address fixtures

These addresses were derived locally from the already published BIP32 vector used by `packages/sdk/test/create-fixtures.ts`. They are permanently public test material. Never deposit funds at them.

- Mainnet, path `m/86'/808276'/0'/0/0`: `prl1pdmqd2wzd3e2unrkvq880t24acsrf8zffzqjqr356pmd93cve9eqs4u7tjx`
- Testnet2, path `m/86'/1'/0'/0/0`: `tprl1pzh75rtx74l85v2xqfr5uln7mhy40vyqzm68ml4yngcqy9v085tqqg5e3rn`

GET `/address/{address}?details=txids&page=1` returned, on each network:

```json
{
  "page": 1,
  "totalPages": 1,
  "itemsOnPage": 1000,
  "address": "<queried address>",
  "balance": "0",
  "totalReceived": "0",
  "totalSent": "0",
  "unconfirmedBalance": "0",
  "unconfirmedTxs": 0,
  "txs": 0
}
```

An empty address **omits `txids`**. GET `/utxo/{address}?confirmed=true` returned `[]` on both networks. Do not turn a failed request, malformed response, stale cache or interrupted scan into this successful-empty state.

## History, pagination, and a spent-address counterexample

The mainnet block at height 125415 exposed a public mining address:

`prl1p50ltku2jjcwdxh4nzjrw98nwdswdn25qdkr2fdtw8hsq3qu9cdhscchnnm`

`/address/{address}?details=txids&page=1&pageSize=2` returned `page:1`, `totalPages:11158`, `itemsOnPage:2`, `txs:22315`, and two txids. Page 2 returned `page:2`, the same counts and the next two distinct txids. `itemsOnPage` is the requested page capacity; the empty fixture still reported 1000. Do not treat it as the actual number of returned txids. Counts and pages can change while blocks arrive; a scan is not an atomic snapshot.

A public payout from that mining address, transaction `da8d2054efb8719fb672e2ea63f733b3e49aa0e5de89c82775af96ec8e9f6c14`, exposed this fully spent address:

`prl1p4ny7fvly8qy7nkfqnpec373fscxfvrcyutfdmfua9k6ac2j6hkwsraa7ry`

Its `/address/{address}?details=txids&page=1&pageSize=3` returned:

```json
{
  "page": 1,
  "totalPages": 720,
  "itemsOnPage": 3,
  "balance": "0",
  "totalReceived": "238003019089",
  "totalSent": "238003019089",
  "unconfirmedBalance": "0",
  "unconfirmedTxs": 0,
  "txs": 2158,
  "txids": [
    "a66630f7d7a95b4f67addc946037f297d4ca682d6fc3886c09b0ef4288c1f5db",
    "da8d2054efb8719fb672e2ea63f733b3e49aa0e5de89c82775af96ec8e9f6c14",
    "cd3c246b1496216e24444b9ca6ef4ac09eff1633dccc82302be62a8356947ed5"
  ]
}
```

Its confirmed UTXO list was empty. Two other spent payout addresses also returned zero balances with 158 and 1962 historical transactions. Discovery must reset each branch's consecutive-unused counter whenever `txs > 0` or `unconfirmedTxs > 0`, even when balance and UTXO count are zero. Preserve a declared scan bound and expose incomplete coverage rather than silently stopping on errors or work limits.

### Deployed-source pagination finding

After live requests ended, the GitHub connector successfully read the official [GetAddress source at the reported deployed commit `81f52f2`](https://github.com/trezor/blockbook/blob/81f52f2/api/worker.go#L1520-L1790). This is source analysis, not a successful live pending-address test:

- `txs` is the confirmed address-index count (`int(ba.Txs)`). `unconfirmedTxs` is a separate count. For an unfiltered, stable complete response set, require the unique transaction count to equal **`txs + unconfirmedTxs`**, and reconcile each transaction's confirmation category as well.
- This commit prepends pending transactions only on page 1, appends that page's confirmed transactions, and then truncates the combined list to `pageSize`. Page 2 still begins at the confirmed offset `pageSize`. Consequently, with pending transactions and more than one full page, confirmed transaction IDs can be skipped between pages. `totalPages` is based on confirmed history and does not account for these pending entries.
- A pending-only address sets confirmed `txs` to zero and page to one; its pending entries can still be truncated by page size.
- Therefore, do not infer completeness merely from reaching `totalPages`. Require exact count/category reconciliation and fail closed on mismatch. A larger bounded page can handle a small account whose total confirmed-plus-pending count fits on that page; it does not solve arbitrary large-account pagination.
- Mempool fetch failures are skipped by the server and can lower `unconfirmedTxs` itself. Count equality remains a consistency check against the server's response, not proof that no pending transaction was omitted.

Current upstream uses a merged confirmed-plus-mempool paging sequence, but that newer behavior must not be assumed for the reported deployed commit. The connector returned source blob SHA `2d9bc38c835d7015c75b73dc01cf8fabd311745a` for `api/worker.go` at `81f52f2`.

The matching [deployed request parser](https://github.com/trezor/blockbook/blob/81f52f2/server/public.go#L1032-L1111) sets the maximum/default page size to 1000 for `details=txids` (100 for `details=txs`). `to=<positive tip height>` is passed as `ToHeight` and suppresses mempool processing; `from=0` is supported. The address handler does **not** parse `confirmed=true`, so that parameter must not be used to claim a confirmed-only address query.

Recommended bounded policy for this deployment: request up to 1000 txids per page. If pending transactions exist, require `txs + unconfirmedTxs <= 1000` and exact unique/category reconciliation on the first page, otherwise mark history incomplete and block spending. With no pending transactions, paginate confirmed history and require exact count reconciliation. A more complex source-supported alternative is a separate confirmed scan with `to=T`, followed by an unfiltered page-1 pending scan when all pending entries fit. However, filtered scans can return `totalPages:-1`, requiring bounded short-page termination and exact count reconciliation; that alternative was not tested live. For either strategy, a moving tip, changed counts, missing raw transactions or mismatched categories require a fresh scan or an explicit incomplete state.

## UTXOs, raw transactions, exact amounts, and coinbase

Mainnet mining-address `/utxo/{address}?confirmed=true` included:

```json
{
  "txid": "f510d4314355f4fd6b4e19c74ec87161762d75b73549d3722d5297d374e458fc",
  "vout": 0,
  "value": "226966975650",
  "height": 125415,
  "confirmations": 2
}
```

There is no script or coinbase flag in this entry. This address returned 650 entries; a testnet2 mining address returned 31,799. UTXO responses are a plain array, with no observed pagination wrapper. Enforce explicit response-size and work limits; report an oversized/partial account instead of a fabricated balance.

GET `/tx/f510d4314355f4fd6b4e19c74ec87161762d75b73549d3722d5297d374e458fc` returned:

- `vin[0].coinbase` as a hex string
- `vout[0].value: "226966975650"`
- `vout[0].hex: "5120a3febb7152961cd35eb31486e29e6e6c1cd9aa806d86a4b56e3de0088385c36f"`
- `blockHash`, `blockHeight:125415`, `confirmations:2`, `blockTime`, `size:255`, `vsize:228`
- top-level `hex` containing the complete transaction, including witness

`/tx-specific/{same txid}` returned identical raw `hex`, but its `vout[0].value` was the JSON number `2269.6697565` PRL, and its block field was lowercase `blockhash`. Use only normalized exact strings and locally decoded bytes for amounts.

The same checks succeeded for testnet2 coinbase `c4f88cff36b216a42dcb3953a049126ac02f8e4eab8ec1331d05d07cd75b95ee` at height 108984, amount `"236897434984"` grains. `packages/sdk/src/transaction.ts::parseTransaction` independently reproduced the txid, coinbase classification, every output amount and every output script for both coinbases and the 1001-output mainnet payout above. No signing was performed.

`/tx/{payout txid}?spending=true` returned confirmed-spent metadata, for example output 1:

```json
{
  "value": "136251032",
  "n": 1,
  "spent": true,
  "spentTxId": "a66630f7d7a95b4f67addc946037f297d4ca682d6fc3886c09b0ef4288c1f5db",
  "spentIndex": 599,
  "spentHeight": 125384
}
```

Absent `spent` does not establish universal unspent status. Input `vout` may be omitted when zero; raw parsing gives the actual outpoint. In general, treat unknown fields as untrusted and validate the fields actually used.

## Pending transaction evidence and the remaining spend-status limit

The official [mainnet mempool page](https://blockbook.pearlresearch.ai/mempool) listed `f435a711ce1ba95018369f69f91dfee8a6a81ef0efdb4fb9e2b9bd86957d1f59`. Its normalized `/tx/{id}?spending=true` response had:

```json
{
  "txid": "f435a711ce1ba95018369f69f91dfee8a6a81ef0efdb4fb9e2b9bd86957d1f59",
  "blockHeight": -1,
  "confirmations": 0,
  "blockTime": 1791557103,
  "confirmationETABlocks": 1,
  "confirmationETASeconds": 205,
  "value": "1430667760",
  "valueIn": "1430875827",
  "fees": "208067"
}
```

`blockHash` was omitted; `hex` was present. A second live pending transaction had the same confirmation/height shape. `blockTime` is a mempool observation time in this case, not a mined-block timestamp. Nested `coinSpecificData` includes floating PRL values; do not read amounts from it.

The first pending transaction spends confirmed outpoint `4840b8c5dad676b68a8cff3bf94473948d08c7415c1aad7555edf116dc5df723:372`. Subsequent address/UTXO/previous-transaction reads timed out, and the retry could not be completed because the execution approval review was cancelled. Therefore this investigation **does not establish live** whether the Pearl deployment's `confirmed=true` UTXO list excludes that mempool-spent outpoint, whether `spent` reflects mempool spends, or the precise pending-only address pagination behavior. The deployed-source pagination finding above gives a separate code-level warning.

Conservative integration: parse unconfirmed transaction inputs from a complete address-history result and exclude those outpoints; keep local reservations; never free reserved inputs merely because a response is stale or a transaction temporarily disappears. If complete pending history cannot be obtained, mark spendability uncertain. Mock tests can verify handling, but cannot replace this outstanding live-service behavior check.

## Transport and safety requirements

1. Pin only the approved HTTPS upstream host for each supported network. Pin genesis before accepting account data. Never silently route original testnet to testnet2.
2. A same-origin proxy must have a strict endpoint/parameter allowlist and must reject arbitrary URLs, redirects to other origins, path traversal and unsupported methods. A GET-only restriction is insufficient: upstream Blockbook has a mutating GET broadcast endpoint.
3. Bound timeouts, concurrency, response bytes, address count, history pages and raw transaction count. Unknown availability is not zero balance. Allow cancellation and prevent stale responses from a previous account/network from updating the current view.
4. Address queries link a user's addresses at the public operator and proxy. Explain and obtain the applicable user permission before transmitting real derived addresses; never upload an account xpub merely for convenience.
5. Match each candidate's locally parsed txid, output index, grain amount and script to the derived owned script. A metadata-only `isAddress` claim is insufficient.
6. Recheck observed block hashes at their heights before using a cached snapshot, and recheck the original tip hash at the end of a scan. These detect some inconsistencies/reorgs but do not prove the backend honest or the address history complete.
7. Blockbook status, genesis response, inclusion, confirmation count, unspent status and scan completeness remain server claims. Raw transaction parsing proves byte consistency and ownership of the script, not chain inclusion or present spendability. Do not call this full-node or SPV verification.
8. Preserve separate explicit signing and broadcasting steps. This investigation did not broadcast on any network and did not verify broadcast acceptance, propagation or confirmation.

## Broadcast documentation, not a live broadcast test

The companion implementer also requested a read-only check of the upstream broadcast interface. The official [Blockbook OpenAPI specification](https://github.com/trezor/blockbook/blob/master/openapi.yaml) documents POST `/api/v2/sendtx/`, a mandatory trailing slash, a `text/plain` raw-hex body, and an 8 MiB request limit. It also documents GET `/api/v2/sendtx/{hex}` as a broadcast. Both must remain outside the read-only proxy path allowlist. Actual Pearl deployment acceptance/error behavior was not exercised. A successful backend response would still not prove confirmation.

Read-only inspection of the [matching deployed handler](https://github.com/trezor/blockbook/blob/81f52f2/server/public.go#L1749-L1795) additionally confirmed a successful response shape of `{"result":"<backend transaction id>"}` and the 8 MiB body limit. This is source evidence only. Verify the returned ID equals the independently computed signed transaction ID before reporting backend acceptance, and treat a timed-out submission as ambiguous rather than failed.

The same official specification describes normalized integer-denomination strings, optional empty fields, history pagination and UTXO behavior. Deployment observations take precedence over its generic examples: in particular, the tested Pearl deployment omitted the immature-coinbase flag that current upstream documentation describes.

## Reproducing safe reads

Use the public fixture address, not a user's address, for smoke checks:

```sh
curl --fail --show-error --silent --max-time 30 \
  -H 'Origin: http://localhost:5173' -D - \
  'https://blockbook.pearlresearch.ai/api/v2/block-index/0'

curl --fail --show-error --silent --max-time 30 \
  'https://blockbook.pearlresearch.ai/api/v2/address/prl1pdmqd2wzd3e2unrkvq880t24acsrf8zffzqjqr356pmd93cve9eqs4u7tjx?details=txids&page=1'

curl --fail --show-error --silent --max-time 30 \
  'https://blockbook.pearlresearch.ai/api/v2/utxo/prl1pdmqd2wzd3e2unrkvq880t24acsrf8zffzqjqr356pmd93cve9eqs4u7tjx?confirmed=true'
```

No availability promise, production qualification, complete gap/reorg end-to-end test, or private-account check is implied by these observations.
