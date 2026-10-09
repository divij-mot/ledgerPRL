# Production host and public-indexer boundary review

Reviewed 2026-10-09 on branch `ledger-bitcoin-prl`, worktree based on
`bef09f0550eda47956e5862a984a8d584a86fd30`, using Node `v24.19.0`.
Other review changes were present in the shared worktree. This report is not a
claim that the original commit or a deployed service passed these checks.

## Result

No high- or medium-severity vulnerability was demonstrated in the reviewed host
boundary. Two low-risk validation gaps were reproduced with injected responses,
then narrowly fixed under the coordinating review's authorization:

1. **Address-route tokens were only alphanumeric.** Before the patch,
   `BlockbookSource.get("/api/v2/utxo/xpubSyntheticAlphanumericToken")` reached the
   fixed upstream. Invalid checksums, unrelated tokens and wrong-network
   addresses were likewise not rejected at this boundary. The honest browser's
   discovery flow already derived addresses locally, so this was a defensive
   disclosure/scope gap rather than evidence of automatic account-key leakage.
   Both address and UTXO paths now use the existing SDK `addressToScript` before
   fetch. Valid P2TR and P2MR, both public networks, uppercase/lowercase, and
   both allowed history pages remain supported. The route must also match in
   full, rejecting trailing line terminators previously accepted by JavaScript's
   `$` anchor; no destination bypass was demonstrated through that behavior.

2. **The relay's claimed key-path shape allowed nonempty scriptSig.** A synthetic
   transaction with a nonempty scriptSig, one arbitrary 64-byte witness per
   input and the corresponding txid passed the old relay gate and reached the
   injected send endpoint. The relay now requires empty scriptSig for every
   input, in addition to its existing input count, witness shape, byte and txid
   restrictions. Standard regression tests mutate only a frozen public fixture.
   This did not bypass the browser's independent signature/byte verification,
   create a signature, or prove acceptance by a real node.

**Important remaining trust boundary:** The public relay checks structure and
txid; it cannot authenticate a Ledger approval, establish ownership, or prove
signature validity without the spent outputs. A shape-correct transaction with
deliberately meaningless witness bytes still reaches the mocked endpoint, as
the explicit characterization test records. Browser verification and upstream
consensus validation remain necessary. Host/Origin/custom-header checks defend
browser-origin boundaries; an arbitrary HTTP client can supply those headers.
This is a public, bounded relay, not an authenticated wallet service.

## Verified controls

- Exact configured Host/HTTPS proxy header and API Origin/custom-header checks;
  duplicate trust headers, unrelated origins and unsupported methods rejected.
- On supported Node 24.19, excess header count/bytes are rejected with 431,
  rather than silently hiding late Origin or duplicate Host headers. An initial
  truncation hypothesis was tested and **did not reproduce**.
- Ambiguous duplicate Content-Length and Content-Length/Transfer-Encoding
  framing rejected by the HTTP parser before upstream contact.
- A valid JSON body padded to exactly 128 KiB is accepted; a declared body one
  byte larger is rejected without waiting for the body.
- Fixed mainnet/testnet2 HTTPS destinations; read-only operation/path allowlist;
  no arbitrary URLs, private-node routes, xpub routes, extra query arguments,
  encoded traversal, or broadcast-via-read route.
- Client Cookie/Authorization do not enter upstream fetch options. Input,
  credentials, upstream exception text and upstream error bodies are not
  reflected by the public error response.
- Upstream decoded body limits cancel an oversized chunked stream. No automatic
  read or broadcast retry is introduced.
- Sixteen pending reads exhaust the actual shared operation cap; the next
  request gets 429. Client disconnect aborts all pending upstream operations and
  releases every slot for a subsequent successful request.
- The actual overall-operation timeout code aborts upstream work and releases
  the slot. The test shortens only the 25-second operation timer to 80 ms; this
  is deadline-path evidence, not a wall-clock timing qualification.
- Broadcast performs status/tip/genesis checks before exact-byte submission to
  one fixed send endpoint. Wrong genesis prevents submission; a mismatched
  result stays explicitly ambiguous and is not retried.
- Static sources/maps/traversal/private files are inaccessible; build snapshots
  reject index and asset-directory symlinks. The coordinating review's narrowly
  allowlisted public dependency-notice route is included in the test fixture.

## Evidence and commands

- `boundaries.test.ts`: 14 independent loopback/mocked tests, including the two
  repaired regressions and the explicit shape-only relay characterization.
- `focused-results.txt`: 52/52 passing across the independent host/indexer
  reviews plus standard web-server, public-source, blockbook and relay suites.
- `companion-results.txt`: full companion test command, 134/134 passing.
- `source-sha256.txt`: reviewed production sources and changed regression tests.
- Companion package typecheck and a separate strict TypeScript check of the
  independent test file passed. `git diff --check` passed for this review's files.

Run from the repository root:

```sh
node --import tsx --test tools/host-boundary-review/boundaries.test.ts
node --import tsx --test apps/companion/test/indexer-proxy.test.ts apps/companion/test/blockbook.test.ts apps/companion/test/public-source.test.ts apps/companion/test/web-server.test.ts tools/host-boundary-review/boundaries.test.ts tools/public-indexer-review/boundaries.test.ts
npm run typecheck --workspace @pearl-ledger/companion
npm run test --workspace @pearl-ledger/companion
```

## Scope limits

All upstream replies were local injected fixtures; all HTTP probes targeted
newly created loopback test servers. No public indexer probe, real broadcast,
Ledger/native/emulator execution, private credentials, deployment, DNS or TLS
changes were performed. Caddy certificate issuance, real proxy normalization,
browser WebHID/CSP execution, physical devices, indexer honesty and volumetric
DoS resistance remain outside these results. Filesystem race resistance still
depends on the documented owner-controlled, immutable release tree; the static
snapshot is not a defense against an operator who can replace the application.

This is host-side source and modeled-boundary evidence, not a production
security certification or a substitute for the release gates in SECURITY.md.
