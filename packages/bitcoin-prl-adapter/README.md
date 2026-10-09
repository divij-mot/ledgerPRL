# PRL adapter for the Ledger Bitcoin protocol

Development-only, seedless host adapter for the official app-bitcoin-based PRL fork. No Ledger approval, audit, physical-device qualification or post-quantum custody is claimed. Never use published fixtures with funds.

The companion and CLI use this package through their existing transport and wallet APIs. `LedgerBitcoinPrlClient` consumes the SDK's `ApduTransport`; it does not install firmware, obtain seeds, sign in software, or broadcast. The legacy PRL1 client stays separately named in the SDK and is never selected as a fallback.

## Scope

- Unnamed default policy `tr(@0/**)`, ordinary empty-tree BIP86 P2TR owned inputs/change, SIGHASH_DEFAULT only
- Mainnet `m/86'/808276'/account'`; all other named PRL networks `m/86'/1'/account'`; exact 31-bit account-number and non-hardened address-index ranges, branches 0/1
- Version 1, locktime 0, final sequences, 1–16 inputs, exactly one positive recipient and at most one verified branch-1 change
- External recipients: P2TR witness-v1 or Pearl P2MR witness-v2, both 32-byte programs and bech32m; a P2MR root is not curve-validated. P2MR ownership, XMSS signing and script-path spending are unsupported.
- Exact bigint grains, checked individual/aggregate values through 2,100,000,000,000,000,000 grains
- Strict unsigned PSBTv2/BIP371 only: unknown, duplicate, signed, modifiable, noncanonical, foreign-origin, annex/script-path and unsupported fields fail closed
- Every input carries exact witness prevout, outpoint, final sequence, DEFAULT sighash, internal key and full fingerprint/path; change metadata is independently reconstructed. Optional complete previous transactions must match txid/vout/amount/script.
- PSBT bytes are bounded to 2,000,000; each optional raw previous transaction is bounded to 65,536. A larger raw prevtx cannot be supplied through this optional field. This does not replace the wallet backend's full raw-prevout/source verification.

## Protocol binding

Before each operation, `E1/06`, `P1=0`, `P2=1` must return exactly 58 bytes:

`PRLB || schema=1 || network_id || coin_type_BE32 || genesis_display_order_32 || max_money_BE64 || max_inputs_BE16 || max_outputs_BE16 || flags_BE32`.

The adapter requires the selected network, exact genesis, coin type, maximum amount, limits 16/2 and flags 3. Flag 1 is the ordinary BIP86 signing profile; flag 2 is external P2MR recipient support. Bitcoin, old PRL1, wrong-network and unknown-profile responses are rejected.

Every PSBT includes global proprietary key `fc0350524c01` (identifier `PRL`, subtype 1) with value `01 || network_id || genesis_display_order_32`. Same-HRP testnets remain separately bound. Ordinary SIGN_PSBT, account export, wallet policy, Merkle proof, interruption and signature-yield framing follow pinned official Ledger protocol v1.

Account exports use conventional xpub/tpub **only for Ledger wallet-policy transport**. Pearl node wallet import prefixes differ on some networks; these strings must not be presented as arbitrary Pearl wallet import records. The existing public-account JSON format remains unchanged. The exact device-exported parent fingerprint/xpub is retained internally for native wallet-policy ownership checking.

## API and signed-result durability

- `exportAccount(account, signal?)`: always displays the account/path on the emulated or physical device
- `verifyAddress(account, branch, index, signal?)` / `displayAddress(...)`: requires display and exact independent PRL address equality
- `signBundle(bundle, account, options)` → `PrlFinalizedTransaction`
- `signTransaction(...)` → verified 64-byte signature array, for a higher-level wrapper
- `signPsbt(bytes, account, options)`: imported PSBTs undergo the same strict policy/ownership parser
- `capabilities(signal?)`, `sessionState`, `close()`

Before the first await, caller-controlled account/bundle/prevtx bytes are snapshotted. Native yields must have a unique expected input index, the exact tweaked x-only output key and a valid 64-byte BIP340 signature over the independently recomputed BIP341 digest. The final transaction is independently parsed and checked again.

A wallet integration must provide `options.onVerifiedSigned(transaction)`. It is called once after the complete valid signature set exists, **before the final continuation ACK**, and is awaited so the existing payment journal can save bytes while keeping reservations. The callback receives a separate copy. Storage is bounded by a separate 30-second default timeout (`durabilityTimeoutMs` constructor option); cancellation does not skip durable saving.

If the final ACK/protocol completion/cancellation fails after all valid signatures exist, `signBundle` still returns those bytes with `completionWarning: "device-acknowledgement-unconfirmed"`; the client remains failed and its transport is closed. If the durable callback fails/times out, `VerifiedSigningResultError.signedTransaction` carries the complete verified bytes. It must be preserved; a generic “signing failed” handler must not discard it. Incomplete signatures remain ambiguous. Never automatically retry signing, release payment locks or broadcast after either outcome.

There is no in-place reset command. Reconnect the transport and construct a new client. Default operation timeout is five minutes. No APDU retries are automatic.

## Verification

```sh
npm run typecheck --workspace @pearl-ledger/bitcoin-prl-adapter
npm run test --workspace @pearl-ledger/bitcoin-prl-adapter
python3 packages/bitcoin-prl-adapter/provenance/verify_upstream.py
```

Python 3.8+ is required for the independent, local, hash-pinned official Ledger host oracle. No network or hardware is used by normal tests. Upstream source reuse, exact patch and alternatives inspected are in [provenance](provenance/README.md).

The published maximum-value and P2MR fixtures also pass the actual pinned Pearl Go oracle:

```sh
(cd tools/pearl-oracle && go run -mod=readonly . ../../packages/bitcoin-prl-adapter/test/fixtures/max-grains-payment.json)
(cd tools/pearl-oracle && go run -mod=readonly . ../../packages/bitcoin-prl-adapter/test/fixtures/p2mr-payment.json)
```

An explicit native-emulator run is available as `node --import tsx packages/bitcoin-prl-adapter/test/native-integration.mjs` after a regtest fork ELF and pinned Speculos environment are prepared. It uses only the public vector-one test seed, captures UI, saves signed bytes before the final ACK, and creates Pearl-oracle files. It never broadcasts. See the [recorded Nano S Plus evidence](test/evidence/native-nanosp-20261009/README.md).

The host cannot authenticate chain state from PSBT metadata. Public indexer/node source checks, spendability, maturity, relay policy, payment reservations and recovery remain the wallet layer's responsibility. Emulator and cross-language tests do not establish physical USB/secure-screen behavior, firmware authenticity or general feature compatibility.
