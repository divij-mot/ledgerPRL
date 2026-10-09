# Optional MetaMask experiment (not integrated into the primary wallet)

**The primary product is the direct Ledger PRL website. MetaMask is not required.**

The user chose direct Ledger receive/send/hold instead of a required MetaMask workflow. Development of the optional `packages/metamask-snap` experiment stopped at a source-tested boundary. The primary companion must not import this package or require its installation. This is not a published Snap, vendor-approved wallet, audited release, or proof that a physical Ledger works. Do not use valuable funds.

## What the optional code actually provides

- A real MetaMask `onRpcRequest` entrypoint, official SDK JSX dialogs, and encrypted public state storage.
- Explicit PRL methods over `wallet_invokeSnap`. They do not implement `eth_*`, inject a universal provider, register a native PRL account in the MetaMask account selector, or make existing websites compatible automatically.
- A trusted companion adapter that receives a hardware signer dependency. The intended signer is the PRL Ledger Bitcoin-app/PSBT adapter. No fake connection, arbitrary APDU relay, HTTP signer, or fallback software wallet exists here.
- A bounded separate-origin developer broker and static demo. A website can request one public address, queue a recipient/amount intent, and read its status. A companion must explicitly claim the intent, choose coins and fee, review it in MetaMask, and request Ledger signing. Broadcasting remains a separate companion action.
- Website responses omit account public keys, chain codes, companion session identifiers, input bundles, signatures, and raw signed transactions. A returned transaction id is **not** evidence of broadcast or confirmation. The `broadcast-reported` state means only that the trusted companion reported node acceptance.

The ordinary core methods are `prl_connect`, `prl_getAccount`, `prl_getAddress`, `prl_prepareTransaction`, `prl_submitSignatures`, `prl_cancel`, and `prl_disconnect`. Only the exact companion origins may use them. The Snap itself cannot contact or authorize a Ledger.

Website methods are `prl_requestAccounts`, `prl_getAccounts`, `prl_requestPayment`, `prl_getRequest`, `prl_cancelRequest`, and `prl_revokeAccounts`. Companion-only broker methods list, claim, reject, prepare, begin signing, record independently verified signed data, and report a broadcast result. The separately exported `PrlDappProvider` and `PrlSnapCompanion` classes implement these bounded interfaces.

## Verified platform boundary

Official documentation checked on 2026-10-09:

- [Execution environment](https://docs.metamask.io/snaps/learn/about-snaps/execution-environment/): a Snap has no DOM, Node built-ins, or unrestricted platform APIs. Direct WebHID/USB Ledger access is not available inside this Snap.
- [Custom RPC entrypoint](https://docs.metamask.io/snaps/reference/entry-points/#onrpcrequest) and [RPC allowed origins](https://docs.metamask.io/snaps/reference/permissions/#allowed-origins): supported custom RPC is the integration boundary.
- [Account Management entrypoint](https://docs.metamask.io/snaps/reference/entry-points/#onkeyringrequest): the published feature is described as custom EVM accounts. This package does not assert arbitrary native PRL account support.
- [Encrypted public state](https://docs.metamask.io/snaps/reference/snaps-api/snap_managestate/): public account and approval state survive Snap idle shutdown. No private keys are stored.
- [Allowlisting and open permissions](https://docs.metamask.io/snaps/how-to/get-allowlisted/#open-permissions): this package needs `endowment:rpc`, which remains protected and requires MetaMask's production allowlisting route. Open `snap_dialog` and `snap_manageState` permissions do not remove that gate.
- [Publishing](https://docs.metamask.io/snaps/how-to/publish-a-snap/): local Flask development is distinct from npm publication and production distribution.

The package pins official `@metamask/snaps-sdk` 12.0.1. The official CLI reported production platform maximum 12.0.1 during verification; SDK 12.1.0 was therefore replaced. The SDK version alone does not establish release acceptance. Production MetaMask/Ledger approvals and physical-device testing remain external gates.

## Security and recovery contract

No entropy, key derivation from a wallet secret, private-key, Ethereum-provider, network-access, keyring, automatic-connection, or background-operation permission is requested. The only manifest permissions are RPC for fixed origins, dialogs, and encrypted state.

Development origins are explicitly separated:

- Companion: `http://127.0.0.1:5173` and `http://localhost:5173`
- Demo website: `http://127.0.0.1:4173`
- Local static Snap source: `local:http://127.0.0.1:8087`

Actual RPC origin comes from MetaMask and is never accepted from caller parameters. There is no wildcard, suffix match, bearer URL, cross-origin `postMessage` relay, or automatic website approval. Changing origins requires a rebuild and permission review. Non-secret session/request identifiers correlate state; they do not replace origin authorization.

Companion sessions last 15 minutes; transaction approvals last at most three minutes. Website intents expire after at most ten minutes, and address consent ends with the hardware session. Signature submissions consume a matching approval before verification. Sequence numbers prevent replay across rejection or restart. Concurrent requests fail closed. Full network **and** genesis hash are checked; regtest/simnet share a genesis hash and cannot be distinguished by genesis alone.

The developer broker permits four retained intents per website and eight total, with status reads at least one second apart. Cancelled, expired, and reported-accepted records are retained for 24 hours; unresolved signing/signed outcomes are not auto-erased. These development bounds can fill the queue. There is no automatic recovery or re-signing of uncertain work.

A trusted host must supply all three callbacks:

1. `beforeAddressDisplay`: persist the public account and issued-address high-water mark/recovery metadata before showing an address. The experiment limits explicit derivation to indexes 0–999, matching the bounded companion recovery scan. Snap-derived addresses are explicitly not device-verified.
2. `validateBeforeHardware`: check the current account/device, full chain identity, fresh outpoints and maturity, fees, and reservations immediately before signing. Website claiming completes before this callback; an expired approval never reaches hardware.
3. `onVerifiedSigned`: durably journal the independently verified transaction and its context. This callback must ignore UI cancellation. It is forwarded to the PSBT signer so it can run before the final device acknowledgment. Repeated callbacks share one awaited persistence promise.

The companion adapter must never discard valid signatures because of a late cancellation, disconnect, expired Snap approval, missing final acknowledgment, or failed Snap response. `PrlSignedPersistenceError` carries verified transaction bytes and recovery context when storage fails. Signed outcomes with `snapVerification: "not-confirmed"` are still signed transactions and must keep input reservations. They are not authorization to sign again or broadcast automatically.

Website cancellation is allowed only before signing starts. A new session with the identical exported public account, exact chain, and same companion origin can record/reconcile old signed results. It cannot reactivate an old unsigned approval. Clock rollback is rejected before state writes that could corrupt recovery records.

## Local developer checks

From the repository root:

```sh
npm run typecheck --workspace @pearl-ledger/metamask-snap
npm test --workspace @pearl-ledger/metamask-snap
npm run build --workspace @pearl-ledger/metamask-snap
```

The build generates an ignored Snap manifest and bundle. Its checksum follows the current MetaMask multi-file algorithm, including the stable manifest without its checksum. It is not just a SHA-256 hash of the JavaScript source.

An optional local source server command exists:

```sh
npm run serve --workspace @pearl-ledger/metamask-snap
```

It serves only fixed public files on loopback ports 8087 and 4173. It is not a signer and cannot complete the demo by itself. A separately integrated companion, MetaMask Flask, actual Snap installation consent, and a compatible Ledger app would still be needed. **The primary direct-Ledger website does not include that integration.** Do not suggest installing MetaMask as a prerequisite for the primary wallet.

Official verification used `@metamask/snaps-cli` 8.4.1, installed in an isolated development tools directory rather than added to primary wallet dependencies. `mm-snap eval --input dist/snap.js` and `mm-snap manifest` run from the optional package with its `snap.config.js`.

Unit/integration tests use published deterministic transaction fixtures and explicit mocked provider/hardware boundaries. They test source behavior, replay resistance, signature verification, origin separation, recovery persistence, and failure handling. They do not establish browser extension installation, a real MetaMask-to-Ledger session, physical trusted-display correctness, store approval, or live-funds safety. No account credentials, actual funds, publication, or store upload was used.
