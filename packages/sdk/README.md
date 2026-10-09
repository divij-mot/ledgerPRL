# Pearl Ledger host SDK

Development protocol implementation. **Not audited or approved by Ledger. Do not use with valuable funds.** This package has no seed import, private-key import, software signer, arbitrary-digest signing, or broadcast function.

## Data boundary

- Atomic monetary values are `bigint`, with decimal integer strings at JSON boundaries. `parsePrl` accepts decimal strings with at most eight places. Never pass JSON numeric PRL balances through `Number` to recover grains.
- `MAX_GRAINS` is `2100000000000000000n`. Aggregate input/output sums are checked against it.
- `AccountPublicKey` carries network, account, master fingerprint, compressed public key and chaincode. It is watch-only but privacy-sensitive. It does not claim an account parent fingerprint that the device did not export.
- Derivation is `m/86'/808276'/account'/branch/index` on mainnet and coin type 1 elsewhere. Address HRP alone cannot distinguish all networks. `NETWORKS` also pins genesis hashes.
- Only empty-tree P2TR inputs and authenticated branch-1 change are supported. Recipient P2TR addresses may commit to a script tree; an address cannot reveal that policy.
- `bundleFromJson` rejects unknown or missing fields, including annex, alternative sighash and Merkle-root metadata. It never silently converts an unsupported transaction into the supported profile.
- `parseTransaction(raw)` reads exact serialized previous-output amounts, including witness transactions, and independently computes txid/wtxid. Parsing proves serialization consistency, not chain inclusion or spendability.

## Public API

```ts
import {
  LedgerPearlClient, SpeculosTransport, accountFromJson, bundleFromJson,
  deriveAddress, encodeBundle, decodeBundle, inspectBundle,
  computeSighash, finalizeTransaction, parseTransaction,
} from '@pearl-ledger/sdk';

const client = new LedgerPearlClient(new SpeculosTransport(), 'regtest');
const account = await client.exportAccount(0); // Device confirmation required.
const receive = await client.verifyAddress(account, 0, 0); // Check full device address.
const result = await client.signBundle(bundleFromJson(savedBundle), account, {
  signal: abortController.signal,
  onProgress: (phase, completed, total) => { /* render progress only */ },
});
// result: {signatures, rawTx, txid, wtxid, vsize, bytes}
// Signing does not broadcast. The application owns a separate explicit broadcast action.
```

`encodeBundle`/`decodeBundle` implement [protocol v1](../../docs/protocol-v1.md). Binary transaction hashes are wire order; `BundleInput.txid` is conventional lowercase reversed display hex. `validateBundle(bundle, account)` additionally derives every input/change script. Signing always requires the account object and performs this ownership validation.

## Transport and cancellation

`ApduTransport.exchange(apdu, signal?)` returns response data **including** the two-byte status word. Transports must implement bounded waiting, honor abort/disconnect, reject incomplete responses, and never automatically retry an APDU. `close()` should disconnect and invalidate pending responses. A browser DMK adapter can implement this narrow interface without changing the protocol.

`LedgerPearlClient` serializes operations. It snapshots the full bundle before the first asynchronous step, checks capabilities/network, uploads contiguous bounded chunks, requires review hash/count agreement and independently verifies every returned BIP340 signature. The device signs the parsed transaction only after user approval, not the bundle-transfer commitment hash.

The client additionally enforces its own 120-second per-command timeout and races cancellation independently of the transport; late responses cannot resume a failed signing session. An optional third constructor argument `{timeoutMs}` configures that bound.

Any received status failure, malformed response, cancellation, transport failure or signature mismatch is terminal for that operation. The client closes its transport and refuses further work until explicit recovery. Never downgrade to blind signing. `DeviceError` identifies a returned status and its exact `instruction`; applications may distinguish a confirmed `0x6985` rejection of `INS.REVIEW` from an uncertain fetch/transport failure when managing input reservations. Generic failures must not release potentially signed inputs. `reset()` sends ABORT only after the transport owner has reconnected/reset it; the client does not reconnect automatically.

A canceled Speculos HTTP request is not proof the emulated device wiped its pending review. Restart/reset the emulator app before reconnecting after an interrupted request. The transport is restricted to plain loopback HTTP, refuses credentials/paths/redirects and does not click approval controls. Physical hardware and emulator disconnect behavior require integration testing.

## Verification

```sh
npm run test --workspace @pearl-ledger/sdk
npm run typecheck --workspace @pearl-ledger/sdk
```

The frozen [public vector](../../fixtures/protocol-v1.json) uses only the publicly documented BIP32 test-vector seed. Its generation code is isolated in `test/create-fixtures.ts`, never exported by the runtime package. Never fund its addresses. Tests also use the published BIP86 public-key vector, exact amounts beyond JS's safe integer, maximum-money limits, malformed/truncated data, field tampering, signature checks and transport state/cancellation scenarios.

Cryptographic primitives come from pinned `@scure/bip32`, `@scure/base`, `@noble/curves` and `@noble/hashes` releases. Their audit history does not constitute an audit of this adapter. Sources: [scure-bip32](https://github.com/paulmillr/scure-bip32), [BIP86](https://github.com/bitcoin/bips/blob/master/bip-0086.mediawiki), [BIP341](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki), [Speculos APDU API](https://speculos.ledger.com/user/agent.html).
