# Pearl Ledger companion

A local, seedless, watch-only companion for the development Pearl Ledger protocol. It is **not audited, Ledger-approved, or qualified on physical hardware**. Do not use valuable funds. The signer is classical BIP86 Taproot; this is not post-quantum custody.

## Run

From the repository root, install the pinned lockfile with `npm ci --ignore-scripts`, then:

```sh
npm run dev --workspace @pearl-ledger/companion
```

Open **http://127.0.0.1:5173/**. The local Vite server includes the narrow public-indexer adapter, so light mode needs no RPC credentials or local full node. `npm run build --workspace @pearl-ledger/companion` followed by `npm run preview --workspace @pearl-ledger/companion` serves the built app and the same adapter. Do not serve the static `dist` directory alone and expect the adapter to exist. Do not expose the server to a LAN or the public internet.

The package scripts load `tsx` before Vite so the server-side middleware can resolve workspace TypeScript exports, including the SDK's `.js` ESM specifiers. Node 24.19.0 or a newer compatible 24.x release is required. No hot-wallet daemon, recovery words or seed import is used.

### Public light mode

1. Select **mainnet** or **testnet2**, connect a Ledger running the matching development Pearl app, and physically approve the public account export. Alternatively, import a public account/recovery JSON file to view an account without a connected device.
2. Read the public-address privacy notice and explicitly enable it. Choose **Discover watch account**.
3. The local server derives addresses from the public account, queries their history and UTXOs, fetches raw previous transactions, and verifies transaction IDs, exact grain amounts and derived script ownership. It binds network name, genesis, tip hash and the eight-decimal unit before displaying a completed source view.
4. A fresh full-address rescan is explicit through **Resync account & history**. This rebuilds UTXOs and history, rather than trusting a previous checkpoint through a reorganization. It reports confirmed, pending and detached history. It is not a background monitor and does not automatically follow new blocks while the page is idle.

Fixed upstreams:

- `https://blockbook.pearlresearch.ai`: mainnet
- `https://blockbook.testnet.pearlresearch.ai`: **testnet2**, despite its hostname

The current services omit browser CORS headers. Only the local same-origin server contacts them. There is no general URL/RPC proxy. Read paths are explicitly allowlisted. The mutating Blockbook `GET /sendtx/{hex}` route is never available through the read adapter. A separate POST route is the only public broadcast path.

**Trust and privacy:** HTTPS authenticates the service endpoint; it does not prove chain truth. The operator can censor or omit transactions, misreport state, and link addresses/IP/timing. No SPV proof verification, FP8 certificate verification or independent chain consensus runs in the companion. The Ledger cannot establish the host's chain view. The public account key/chain code is sent to the user's local server, while only derived addresses and transaction IDs are queried upstream. The browser-session privacy permission is cleared when the account is closed/restored or a different account is imported.

The adapter requires a consistent in-sync indexer/backend status and matching genesis, fetches canonical block hashes, and rejects a changing tip during a completed scan. It independently parses raw transactions and excludes inputs spent by any parsed history transaction, including pending transactions, even if a UTXO endpoint incorrectly still lists them. Source consistency is not an assurance of a complete or honest mempool.

### Bounded discovery and recovery

- Both receive branch 0 and change branch 1 are scanned through **20 consecutive unused addresses** after the last used or saved-issued index.
- “Used” is based on complete transaction history, not current balance. A spent address extends discovery.
- The prototype caps scans at index **999** per branch, which supports issued/recovery indexes **0–979** with the trailing gap; maximum **2,000 unique history transactions**, **256 UTXOs**, and **16 transaction inputs**.
- Any exceeded bound, missing raw transaction, contradictory page count, duplicated/truncated history or changed chain tip aborts the update with an incomplete/unavailable error. It does not turn a partial scan into a final zero balance.
- Blockbook's `txs` counts confirmed transactions and `unconfirmedTxs` is separate. The adapter checks collected unique IDs against their sum. The deployed upstream's older pending/confirmed pagination can drop records; such responses fail closed. A large or active mining account may need a larger dedicated indexer rather than this bounded prototype.
- Verified receive issuance and change allocation update durable public recovery high-water marks. Receive addresses must be issued consecutively or their prior public recovery record must be restored. Light-mode change indexes outside the recovery range are rejected. Change allocations never roll back after cancellation.
- Export the **public recovery record** after issuing addresses. It preserves the account and issued ranges, allowing a new browser to extend its scan beyond a gap of unused addresses. It contains no private keys and is not a Ledger seed backup. It does **not** transfer payment reservations between different browser profiles/computers; reconcile pending/signed transactions before changing profiles.
- Use **Back up full watch wallet** to preserve the account, issued ranges, payment journal, reservations and any verified signed bytes. Backups use compact JSON and omit diagnostic last-error text and local signing-attempt ownership; payment states, canonical bundles, signed bytes, reservations, recovery paths and archival records are retained. Older backups remain readable. Reading/exporting an existing journal uses a readonly transaction and does not rewrite it; completion or a storage error must settle before the action proceeds. Restore through **Complete watch-wallet backup** before using another browser profile. Restoration validates and merges records without clearing signing/broadcast uncertainty; it does not restore source validation, public-service consent or trusted archival status. Separate profiles do not coordinate subsequent activity.
- A bare public-account JSON remains accepted, but has no issued-range metadata. Offline snapshot import does not establish discovery completeness.

## Device, receive and payment flow

The browser adapter uses pinned `@ledgerhq/device-management-kit` 1.11.0, `@ledgerhq/device-transport-kit-web-hid` 1.2.4, typed `Command`/`ApduBuilder`, and `dmk.sendCommand`. Its interfaces were checked against the installed declarations as well as official docs. Legacy LedgerJS transports are not used. The session refresher is disabled during the custom protocol to avoid unrelated commands interrupting signing.

WebHID is feature-detected. Intended test targets are desktop Chrome/Edge on localhost or HTTPS. Safari, Firefox, mobile browsers, every OS/device combination and physical USB are **not qualified**. There is no simulated-device control or software signer in the production UI.

- Connect checks protocol capabilities/network before account export. A failed/cancelled/disconnected operation closes the transport; reconnect explicitly. Never retry signing APDUs automatically.
- Receive derives locally, asks the Ledger to display/approve the full address, compares the returned value and only then enables **Copy verified address**. The verified label does not survive a changed address/account/session.
- Send displays individual UTXOs and separates immature coinbase rewards (100 confirmations), pending outputs, available outputs and reserved value. Imported metadata is clearly labeled unverified until source validation.
- Select inputs, a P2TR recipient, exact decimal PRL amount, exact total fee and change index. All arithmetic is `bigint` grains. Exponent notation, rounded floating values, overflow, duplicate inputs, unsupported scripts and default-policy dust are rejected.
- **Prepare & reserve inputs** atomically stores the canonical unsigned bundle and outpoint reservations in IndexedDB. A cross-tab notification refreshes views. The database's read/write transaction is the locking primitive; no race-prone localStorage lock is used.
- Before signing, recheck the current source's genesis/tip, raw prevouts, canonical inclusion, maturity, current unspent reports and complete history/mempool spends. Validation expires after 60 seconds and must correspond to the exact bundle. The device independently derives ownership and change, validates all transaction fields, displays recipient/amount/fee/change and computes its own BIP341 digest.
- The fee hint recomputes exact signed virtual size after input selection, amount or fee edits, including whether change is present. It shows the minimum under the declared pinned Pearl default relay policy of 1,000 grains per 1,000 virtual bytes. A one-input/two-output payment needs at least 154 grains; the largest supported 16-input/two-output payment needs 1,017 grains, so the editable initial 1,000-grain value is insufficient for that shape. Nothing silently increases the fee, decreases the recipient amount or changes output shape. Edit the fee/amount yourself before preparing.
- Preparation and restored-draft signing both enforce the declared relay fee and dust policy before the journal enters `signing` or any device review begins. A failing restored draft stays reserved and readable; discard only that unsigned draft and explicitly prepare corrected values. Existing signed backups remain readable, and retrying their exact bytes does not reprice them.
- Size comes from the supported unsigned serialization plus the witness marker/flag and one 64-byte SIGHASH_DEFAULT signature per input. The pinned node's fee calculation uses integer `floor(vsize * rate / 1000)`, its nonzero-rate fallback, and monetary overflow cap. Its P2TR dust minimum is derived separately from `3 * (43 output bytes + 41 input-reference bytes + ceil(107/4) discounted witness bytes)`: 333 grains at the default rate, 666 at twice that rate. Values remain integer grains.
- These are relay-policy checks, not consensus rules, a live fee estimate or an acceptance guarantee. The pure wallet helper accepts an explicitly supplied relay rate, while the GUI declares the pinned default. A configured node or public service may use different or changing policy; the companion does not discover that configuration automatically.
- Fees exceeding 100,000 grains and at least 10% of selected input value receive an explicit warning. The user still chooses the fee; no unverified market estimate is substituted.
- An interrupted `signing` record without saved signed bytes offers **Recover identical payment on Ledger**. This is an explicit new approval of the same reserved inputs, recipient, amount, fee, change and canonical transaction ID. Connect a ready matching Ledger, load watch data, then approve a fresh public-account export and the full payment review. The current source must freshly verify every original input as still unspent and mature; pending, spent, detached, unknown or expired evidence blocks recovery. If account approval lasts beyond the 60-second freshness limit, the app performs one additional source check before signing; an unavailable, changed or still-stale result leaves recovery unresolved without looping.
- Recovery does not create a replacement, select new inputs, allocate new change, unlock funds or broadcast. Any rejection, cancellation, timeout or invalid signature retains the earlier signing ambiguity. If valid signatures are returned, they are verified and stored in the same payment; cancellation cannot discard that verified result. Another tab's already verified signed bytes win unchanged even if a later valid witness differs for the same transaction ID. Broadcasting remains a separate explicit approval.
- Before updating the companion, close its other open tabs/windows and reconnect the Ledger after loading the new build. Do not run old and new loaded application bundles against the same browser storage: older code does not understand signing-attempt ownership. Closing a tab does not release interrupted payment locks.
- Local signing-attempt ownership protects against late rejection callbacks and concurrent recovery. It is not restored from backups: legacy signing records remain ambiguous, and merging another uncertain signing backup revokes any live initial attempt's authority to return that record to a discardable draft. Backups retain the canonical payment and every lock. Recovery by looking up missing signed bytes is outside this flow; do not assume that a timeout or missing transaction means an earlier signing attempt failed.
- The SDK independently verifies all returned BIP340 signatures and finalizes exact 64-byte witnesses. The UI repeats finalization before storing signed bytes. Signed data is not broadcast automatically.
- A distinct checkbox and **Broadcast signed transaction** button disclose the current network/provider and submit only those exact verified bytes. The server verifies the bundle, witnesses, signatures and transaction ID again. Public broadcast uses the documented POST `/api/v2/sendtx/`; local-node broadcast is off by default.
- Before sending, the journal moves to `broadcast-unknown`. A timeout or error keeps the reservation and exact bytes. An explicit rebroadcast uses the same bytes; the app never silently constructs a replacement payment. A matching returned transaction ID means node/indexer acceptance, not confirmation. Previously accepted but currently unarchived records expose **Explicitly rebroadcast exact bytes** with a fresh approval checkbox. This repeats the stored bytes and transaction ID; it never selects new inputs or signs again. A currently archived receipt must first be reconciled. Timeout, rejection or an already-known error preserves uncertainty and all reservations; importing an older accepted backup cannot clear that uncertainty.

A proven `0x6985` rejection of **REVIEW** can return an initial signing attempt to its unsigned draft only while that attempt still owns the unchanged record. The caller may then discard it or reconnect and review again. A recovery attempt's rejection cannot clear earlier signing uncertainty. Rejection during signature fetch, transport loss, timeout and any other uncertain result retain the signing reservation. The explicit identical-payment recovery above is implemented; automatic retrieval of earlier missing signed bytes and release of ambiguous or conflicted input locks are not. There is intentionally no “clear all locks” button. Do not clear browser storage to reuse uncertain inputs.

## Optional authenticated local-node bridge

For regtest, simnet, the legacy testnet, or a user-operated node, start the separate narrow bridge. Keep credentials in the server environment; never paste them into the UI, a URL, a public deployment or a committed file.

```sh
export PEARL_NETWORK=regtest
export PEARL_RPC_URL=http://127.0.0.1:8334
# Set PEARL_RPC_USER and PEARL_RPC_PASSWORD using your local secret mechanism.
npm run bridge --workspace @pearl-ledger/companion
```

The default RPC URL is an example; use your node's actual port. The bridge binds `127.0.0.1:8787`. The GUI forwards only `/api/check`, `/api/reconcile` and `/api/broadcast`. It requires exact `Origin` and `Host` for `http://127.0.0.1:5173`, JSON content type and a custom same-origin header. No permissive CORS is enabled. Non-loopback HTTP node URLs, embedded URL credentials/query/fragment and redirects are rejected; remote nodes must use HTTPS with normal certificate verification. HTTP Basic RPC credentials remain server-side. Regtest/simnet share the pinned genesis, so the explicit configured network remains necessary.

Allowed node methods are `getblockchaininfo`, `getblockhash`, `getblockcount`, `gettxout`, `getrawtransaction`, `getrawmempool`, and separately gated `sendrawtransaction`. Pearl's `getrawtransaction` verbose argument is the integer `0` for raw bytes or `1` for reconciliation metadata, not a Bitcoin-style boolean. No `walletpassphrase`, seed/key export, wallet signing, `sendmany`, `sendtoaddress` or arbitrary RPC method is exposed.

**Pearl-specific mempool trap:** `gettxout(includeMempool=true)` can still return a confirmed output already spent by a mempool transaction. The bridge therefore fetches the bounded raw mempool, verifies transaction IDs, parses exact input outpoints, excludes conflicting outputs, and requires stable mempool membership across validation. Up to 2,000 mempool transactions are supported. Missing/malformed/oversized or changing mempool data fails closed. It never relies on the rounded RPC `value` field for amounts. Raw transaction access may require a node transaction index; unavailable data blocks signing.

`PEARL_ALLOW_BROADCAST=1` enables local-node broadcast. Leave it unset for read-only testing. The bridge rechecks network and mempool conflicts before submission. No real public transaction or physical-device action was performed during development checks.

### Archive known local-node payments

In **Activity**, choose **Archive confirmed records** to check saved signed payments against the configured authenticated local node. This works after restoring a full backup, without a complete public-indexer scan or a connected Ledger. The read-only `/api/reconcile` route remains available when broadcasting is disabled. It never contacts a public indexer or submits a transaction.

The companion independently verifies saved signed bytes and checks active payments with `getrawtransaction(txid, 1)`. Archival requires the exact same bytes, at least six confirmations, and a matching active-chain block hash. Previously proven local archives are rechecked by their saved block height/hash, grouped so many records in the same block need only one lookup. Imported archival claims are discarded during backup restoration and must qualify again through a raw-transaction check. Unknown, pending, detached, too-shallow or malformed evidence does not authorize archival. A detached or unverified prior receipt becomes active again. Every signed byte, input reservation and payment state is retained; only archival metadata changes.

Work is bounded by the existing 2,000-record journal. Each request carries at most 100 active signed payments, with archived block checkpoints included only in the first request. One ordinary confirmed payment uses 10 read-only RPC calls; rechecking its archived checkpoint uses nine. The per-request maximum is 2,108 RPC calls: eight chain-identity/tip calls, at most 100 transaction lookups, and at most 2,000 block lookups across active payments and checkpoints. Across at most 20 batches, the worst-case limit is 4,160 calls (two lookups per active record plus eight tip calls per batch). These are safety ceilings, not a target amount of work.

The overall action has an 80-second deadline, including local signature checks and all network batches; each bridge request also has an 85-second deadline. Cancel aborts in-flight reads. Every batch must describe the same stable tip and cover all requested records. Only after all checks finish does one atomic storage update verify that another tab has not changed the journal. A timeout, exhausted budget, changed tip, incomplete response or concurrent edit reports an error and leaves the prior journal unchanged; there is no automatic retry loop. Large journals may require a later retry. The 100-active-payment limit is unchanged, and a reorganization may make previously archived records active again.

This is a snapshot of the trusted node's reported chain, not an independent consensus or SPV proof. Reorganizations can happen afterward; use the explicit check again for a newer view.

The optional local-node mode currently checks imported public UTXOs; automatic address discovery is provided by the fixed public light sources. It does not pretend `walletcreatefundedpsbt` or watch-only xpub discovery exists in Pearl's inspected wallet RPC.

## Public JSON formats

Public account (hex encodings):

```json
{"network":"regtest","account":0,"masterFingerprint":"11223344","publicKey":"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798","chainCode":"4242424242424242424242424242424242424242424242424242424242424242"}
```

The key above is an explicit synthetic **public-only** fixture. It has no funded account or seed in this repository.

Public recovery record:

```json
{"schema":1,"kind":"pearl-public-recovery","account":{"network":"regtest","account":0,"masterFingerprint":"11223344","publicKey":"0279be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798","chainCode":"4242424242424242424242424242424242424242424242424242424242424242"},"issuedReceiveThrough":-1,"nextChangeIndex":0}
```

For snapshot examples see `apps/companion/public/example-watch.json`. Each UTXO supplies `txid`, `vout`, exact `rawTransaction`, derivation `branch`/`index`, and `block:{height,hash}` or `null`. Amount, script and coinbase status are always parsed from raw bytes. The snapshot has an exact schema, public account, genesis hash, tip and scan-coverage fields. Its maximum size is 4 MiB; raw transactions are individually bounded. Unknown fields are rejected, including attempted seed/private-key fields.

## Verification and remaining qualification

Run:

```sh
npm run typecheck --workspace @pearl-ledger/wallet
npm run typecheck --workspace @pearl-ledger/companion
npm run test --workspace @pearl-ledger/wallet
npm run test --workspace @pearl-ledger/companion
npm run build --workspace @pearl-ledger/companion
```

Tests cover integer precision, raw-outpoint/path substitution, duplicates and wrong genesis, maturity boundaries, explicit dust/fee rules, reservations/change allocation, irreversible uncertain state, reorg removal, stale validation, address gap discovery, spent-address discovery, history-spend exclusion, source schema/pagination constraints, URL/origin boundaries and disabled local broadcast. Other repository tests cover SDK APDUs, serialization/signatures and native-node interoperability.

An actual [cloud-browser review](../apps/companion/test/evidence/rendering/README.md) on 2026-10-09 verified the built preview's desktop empty-state rendering, section navigation, guarded Receive/Send views and disabled empty Activity controls at 1180 × 757 CSS pixels. The rebuilt safety footer was rechecked, and the strict CSP allowed the external built stylesheet. This supersedes the earlier local Chromium launch failure for that narrow rendering scope only. Loaded account/import flows, real IndexedDB persistence and cross-tab recovery, interruption/reload behavior, development-server styling and narrow-screen layout were not exercised by that review. The [companion boundary tests](../apps/companion/test/README.md) use explicit DOM/storage/transport mocks and do not replace those browser checks.

Physical WebHID connection, screen comparison, approval/rejection, USB disconnect, all five supported hardware models and real user browser/OS combinations remain release gates. Public backend liveness/CORS/schema observations are documented separately in [backend evidence](backend-evidence.md); a working endpoint is not an audited trust guarantee.

## API references

- [Ledger custom DMK commands](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/how_to/build_custom_command)
- [Ledger DMK transports](https://developers.ledger.com/docs/device-interaction/dmk-ts/integration/how_to/transports)
- [Ledger discovery and connection](https://developers.ledger.com/docs/device-interaction/dmk-ts/beginner/discover_and_connect)
- [Blockbook OpenAPI](https://github.com/trezor/blockbook/blob/master/openapi.yaml)
- [Deployed Blockbook address-pagination implementation](https://github.com/trezor/blockbook/blob/81f52f2/api/worker.go#L1520-L1790)
- [Pinned Pearl node RPC implementation](https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/rpcserver.go)
