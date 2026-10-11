# Public indexer and Pearl compatibility review

Review completed: 2026-10-09, approximately 22:36–22:40 UTC.

## Result

No source-pin drift or new critical/high-severity defect was established in this limited review. The reviewed read-only source and same-origin proxy retain narrow fixed-host/request boundaries, explicit chain/genesis/unit checks and fail-closed history handling. Eighteen existing offline tests and six independent adversarial tests passed.

**Fresh live-network integration remains blocked and must not be reported as passing.** The actual production BlockbookSource smoke-test invocation received a cancelled automatic approval review. No usable live response evidence was produced; live-results.json records the cancellation rather than a successful probe result. No retry, escalation or alternate tool/host route was used after cancellation.

This report does not qualify the wallet for real funds.

## 1. Official source and release freshness: passed

Fresh read-only official GitHub API calls established:

- Default branch master: 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701. This is exactly the repository's implementation-oracle pin.
- Latest published release: v1.4.11, published 2026-09-29T19:49:34Z; its Git tag resolves directly to commit 2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4.
- FP8 PR311: open, merged=false, head 684f7045f3b3b7c5b7598f46c06b7dceb506f74b; base 2f8b770cac8f8b74be05c1fc51c2baeb76ce0701.
- Exact directory Git-tree identities for node/btcec, node/btcutil, node/mempool and node/txscript are equal across all three immutable refs.
- node/wire/msgtx.go is the same blob, 84a76dd6a82f9e1ab4642d4ef1334da26b43171d, at all three refs.

The retained source identities are in upstream-evidence.json. Identical trees establish identical tracked bytes for the selected source areas, not identical transitive dependencies or universal behavioral equivalence. This review did not rerun the repository's three-ref Go compatibility matrix; its recorded synthetic acceptance results remain separate historical evidence.

Primary sources:

- https://api.github.com/repos/pearl-research-labs/pearl/branches/master
- https://github.com/pearl-research-labs/pearl/releases/tag/v1.4.11
- https://api.github.com/repos/pearl-research-labs/pearl/git/ref/tags/v1.4.11
- https://github.com/pearl-research-labs/pearl/pull/311
- https://github.com/pearl-research-labs/pearl/tree/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node
- https://github.com/pearl-research-labs/pearl/tree/684f7045f3b3b7c5b7598f46c06b7dceb506f74b/node

## 2. FP8 and light-client caveat: confirmed by source

Fresh inspection of the FP8 proposal's node/chaincfg/params.go, blob 23ba77d2e0d20f4c44acabb06f75ab743b7c892c, confirms that Fp8ForkHeight=0 disables the fork, and RequiredCertVersion selects V4 when the fork is active. Mainnet, Testnet and Testnet2 omit that field and therefore use Go's zero value; regtest and simnet explicitly set it to 1. This proposal is not a released or activated public-network FP8 compatibility guarantee.

The existing docs correctly separate transaction signing from proof/chain validation:

- Normal upstream SPV checkHeaderSanity calls contextual header checks, certificate rules and block-header sanity checks.
- The !zkpow VerifyCertificate stub returns an error. Simply compiling a browser/WASM light client without the native verifier is not independently verified Pearl SPV.
- NeutrinoClient.TestMempoolAccept returns ErrUnimplemented. Replacing the indexer with upstream SPV still needs a separate pending-spend/acceptance design.
- The web wallet checks consistency within a server-provided chain view. It does not validate Pearl proof certificates, demonstrate transaction inclusion or prove unspentness.
- BlockbookSource.tip does not enforce a backend version/activation compatibility floor or independently validate freshness against peers. Before an eventual activated FP8 deployment, an explicit supported-backend gate and outdated-backend rejection/recovery qualification remain necessary, as existing docs say.

Primary sources:

- https://github.com/pearl-research-labs/pearl/blob/684f7045f3b3b7c5b7598f46c06b7dceb506f74b/node/chaincfg/params.go#L283-L346
- https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/spv/blockmanager.go#L2823-L2865
- https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/zkpow/zkpow_stub.go#L20-L29
- https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/chain/neutrino.go#L259-L267

## 3. Live read-only integration: blocked, not passed

Prepared probe.ts imports the actual production BlockbookSource, rather than reimplementing it. Its fixed destinations are:

- https://blockbook.pearlresearch.ai
- https://blockbook.testnet.pearlresearch.ai

It permits only GET status, numeric block-index, and the two documented deterministic public BIP32 fixture address/UTXO paths. It has a global 16-request ceiling, inherits the client's 20-second per-fetch timeout and redirect rejection, adds a one-MiB evidence-body cap, and has no broadcast, transaction submission, credentials, user addresses, private account keys or RPC. The intended empty-fixture flow is six calls per network: status, tip hash, genesis, address, UTXOs and recheck of the original tip hash. It stops without retries after a transport/access failure.

Attempted command:

    node --import tsx tools/public-indexer-review/probe.ts

The execution tool initially returned session 96531; polling ultimately returned:

    Unified exec process failed: automatic approval review was cancelled

The execution left an empty live-results.json; it has been replaced with a valid blocker record containing zero completed observations and the exact cancellation error. The tool does not establish whether any HTTP request reached the service before cancellation, so this report does not assert a request count. It establishes zero usable fresh live observations. The probe was not retried through shell, browser, web or another host.

Consequently, these remain unverified in this pass:

- Current service availability, tip, synchronization flags, genesis response and eight-decimal metadata
- Current backend versions and whether the testnet hostname still serves Testnet2
- Current behavior of either deterministic fixture address or UTXO endpoint
- Actual same-origin proxy-to-indexer deployment integration
- CORS headers, pending-spend exclusion, nonempty-address pagination and reorg behavior on the live service
- Transaction acceptance, propagation or confirmation

docs/backend-evidence.md reports earlier observations at 14:41–14:46 UTC on the same date: mainnet pearld 1.4.6 and Testnet2 pearld 1.4.11, decimals=8 and matching genesis values. Those are historical claims retained by the repository, not fresh observations by this review. No user should interpret the fresh GitHub release check as upgrading or verifying a deployed indexer.

## 4. Actual code review and offline tests: passed within stated scope

Reviewed files:

- apps/companion/src/blockbook-source.ts
- apps/companion/src/indexer-proxy.ts
- apps/companion/src/public-source.ts
- packages/sdk/src/network.ts
- docs/backend-evidence.md
- docs/prl-lightclient-comparison.md
- docs/fp8-compatibility.md

Relevant source behavior:

- Only mainnet and Testnet2 are allowed; original Testnet is rejected.
- Fixed HTTPS upstream hosts; no caller-controlled base URL, credentials or redirects.
- Read-only path allowlist excludes Blockbook's mutating GET sendtx endpoint, arbitrary URLs, RPC and xpub routes.
- tip requires exact backend chain name, decimals=8, explicit synchronized states, matching indexer/backend heights, tip hash lookup and pinned genesis lookup.
- Address history reconciles confirmed+pending totals, duplicate txids, stable category/page counts and explicit 2,000-history limits; more than 256 UTXOs fails.
- Preflight parses raw transaction bytes, validates owned prevouts, collects observed spends before coin classification and compares a second bounded address/UTXO view.
- The proxy requires exact origin/host/custom header and same-origin fetch metadata when present, explicit disclosure consent, exact request fields, at most 16 active requests and bounded operations. The broadcast route is separate and was inspected only, never invoked.
- The browser wrapper uses no-store, credentials=omit and redirect=error; derives addresses locally; does not transmit account public key/chain code in normal proxy requests.

Existing test command:

    node --import tsx --test apps/companion/test/blockbook.test.ts apps/companion/test/public-source.test.ts

Result: 18 passed, 0 failed. See offline-tests.log. These use mocked fetch and public deterministic data.

Independent test command:

    node --import tsx --test tools/public-indexer-review/boundaries.test.ts

Result: 6 passed, 0 failed. See boundary-tests.log. New cases cover:

1. Nine incompatible/unsynced status mutations and rejection of original Testnet
2. Wrong-genesis rejection despite otherwise coherent mainnet status
3. Exact old deployed pagination shape: 1 pending + 1,500 confirmed, one skipped confirmed ID; rejected as truncated
4. Complete 1,500-confirmed two-page history with zero UTXOs; preserved as a used address
5. Truncated pending-only first page; rejected
6. Seven mutating/encoded/extra-parameter/full-URL paths; rejected before fetch

These prove handling of the supplied cases. A malicious server can still omit an internally self-consistent history, fabricate synchronization metadata or present its own chain view. No mock can prove the live indexer complete or honest.

## 5. Scope and stopping condition

No production files were edited. This worker added only tools/public-indexer-review artifacts. No native signer/emulator/hardware checks, mining, state-changing RPC, user-key use, signing or broadcast were performed. The root review owns any broader unit/browser/security results.

Fresh source comparison and offline boundary checks are complete. The requested live compatibility check is blocked on the cancelled execution approval. Continuing that exact external action requires the parent to resolve the authorization/access blocker; this worker deliberately stops rather than trying an alternate route.

Reviewed SHA-256 values:

- blockbook-source.ts: 4eefe4712413a8ec47191040d8b31260a2046db3b299a78cfc7db2c879b6010a
- indexer-proxy.ts: d4ec907f76179314b4c776c1800b8fd230b66f8be67e3b04b1900379e80d615b
- public-source.ts: 143b87ee1dde056f35f574ebdf2ab3be58de93a7d9b98d409fc9f3b8e19fd6c2
- network.ts: 8a3178145059cdb6f57a2ec740664db937d87e175b9b1d5cb87f15c9a72e6d91
