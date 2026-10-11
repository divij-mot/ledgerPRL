# Native watch-only Pearl light-client backend

Implementation checkpoint, 10 October 2026. This uses official Pearl wallet and Neutrino code at `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701` inside one native Go façade. The real XMSS and Rust ZK-proof libraries are linked with `xmss,zkpow`; a build without both tags refuses to synchronize. No new consensus verifier, software signer, public RPC listener or hosted backend is introduced.

The companion owns Ledger signing, recovery metadata, durable reservations and explicit broadcast approval. The native child owns the public-only watch database and validated chain data. Their interface is private JSONL over inherited standard I/O; [protocol.ts](../../apps/light-client/protocol.ts) specifies requests and responses. [Source](../../apps/light-client/cmd/pearl-watch/main.go) and [native façade](../../apps/light-client/cmd/pearl-watch/serve_native.go) are separate from downloaded upstream sources and generated binaries.

## Why the direct library route

Official Oyster's RPC surfaces do not expose watch-only creation or xpub import, and its SPV JSON RPC lacks generic block-hash lookup and raw transaction broadcast. Experimental gRPC has server TLS but no client authentication. Reusing those surfaces would require additional adapters and historical-header file coordination. The direct façade instead calls the same official wallet/Neutrino APIs through a private process pipe.

The current source also fixes `NeutrinoClient.BlockStamp()` to read `CS.BestBlock()` live. This correction is absent from release v1.4.11 (`2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4`). The selected build uses the current pin, including its correction. Root independently verified all 4,621 upstream blobs against Git tree hashes. The release/source comparison and original RPC investigation were source checks, not evidence that a downloaded binary synchronized.

## Offline watch-only initialization

1. Use a new private data directory for one account and one network. Do not open or modify an existing software-wallet directory. `wallet.NewLoader(params, networkDir, noFreelistSync, dbTimeout, recoveryWindow)` and `CreateNewWatchingOnlyWallet(publicPassphrase, birthday)` create the database without accepting any seed/private passphrase. The public passphrase protects public wallet metadata; it is not signing material. Assert `wallet.Manager.WatchOnly()` both after creation and reopen. [Loader][loader]
2. Call `waddrmgr.InitKeyScopes(params.HDCoinType)` once before opening the wallet. Mainnet coin type is 808276. These are package globals, so do not mix networks in a process. [Scopes][scopes]
3. Validate the device-derived account independently: network/genesis, compressed public point, 32-byte chain code, account index, fingerprint, depth 3 and hardened child number where serialized xpub is supplied. Ledger transports xpub/tpub, while Pearl's mainnet account prefix is zpub. Explicitly set the correct public version when constructing the imported extended public key; compare derived `/0/0`, `/0/n` and `/1/n` scripts to the existing TypeScript derivation. Never interpret the prefix as proof of the derivation path. If reconstructing from the public-account record, the unavailable parent fingerprint must not be substituted with the master fingerprint or represented as verified provenance.
4. Use `Wallet.ImportAccountWithScope(name, accountPubKey, masterFingerprint, KeyScope{Purpose:86,Coin:808276}, ScopeAddrSchema{TaprootPubKey,TaprootPubKey})`. This API needs the explicit input validation in step 3: unlike `ImportAccount`, it does not call `validateExtendedPubKey`. Plain `ImportAccount` is unsafe for a fresh watch-only wallet at this pin: BIP86 inference returns a nil schema, and creating a missing scope dereferences it. [Import APIs][import], [manager creation][manager]
5. Keep one imported account per database and require returned internal account number 0. Recovery explicitly scans `DefaultAccountNum`; it does not promise all imported accounts. The account's actual BIP32 account index remains the imported xpub's index, distinct from internal database number 0. [Recovery][recovery]
6. Before starting the native chain service, materialize both branches through the companion's issued high-water marks plus the bounded lookahead using the scoped manager's `NextExternalAddresses`/`NextInternalAddresses(..., false)` within `walletdb.Update`. This is backend watch registration, not permission to issue a user-facing address or roll back the companion's journal. Choose a birthday that does not omit any possible existing funds; a new trial can use a known pre-funding birthday, while restoration needs earlier coverage. Close through `Loader.UnloadWallet()` before the native service opens the database. [Scopes][scopes]

No `CreateNewWallet`, `CreateWallet`, `--create`, `--createfromfile`, `ImportPrivateKey`, unlock or software signing route is required.

## Native methods and readiness

| Method | Bound operation |
| --- | --- |
| `status` | Returns full public account, source pin, mainnet/genesis, wallet tip, header/filter heights, peer count, synced/ready flags, last-used and registered address bounds |
| `snapshot` | Requires ready; collects bounded complete `Wallet.GetTransactions` raw history and `Wallet.UnspentOutputs` outpoints, checks raw txids/output contents and block hashes, and rechecks the exact tip/ranges before returning `complete:true` |
| `blockHash` | Calls `ChainService.GetBlockHash` for a nonnegative height no higher than the synced tip, bracketed by stable readiness checks |
| `register` | Stops every wallet/client/chain worker, closes databases, extends the bounded public watch set offline, atomically rewinds transaction/address scan state to genesis, responds `restartRequired:true`, and exits. Parent waits for exit before starting a fresh native child |
| `broadcast` | Parses canonical saved bytes, checks expected txid and restricted shape/readiness, calls `ChainService.SendTransaction` once, returns the computed txid or an ambiguous error. No retries, signing or reservation release |

`ready` requires active peers, official `IsCurrent`, a synced wallet, matching header/filter/wallet heights, the wallet hash at the canonical height, and a registered trailing gap. `synced` reports the same native checks before the coverage condition. The full canonical `publicAccount` is present in status/snapshot to prevent same-network account substitution. A registered bound alone is not a completed scan: `coverage.scanComplete` is false until ready.

History is bounded to 2,000 transactions, 3 MiB of raw hex and 256 unspent outputs. Values are derived from raw transaction bytes or native int64 fields; no PRL float RPC values are used. Snapshot cancellation or changing tip/ranges returns an error, never partial data labeled complete. Every unspent output must have a matching full raw history transaction.

Range growth must perform a real historical rescan. `NextAddress` alone merely adds prospective monitoring. In-place rescans were rejected during review: Neutrino notifications have no scan epoch, and `SubmitRescan` acknowledges startup rather than completion. The implemented stop/offline-rewind/exit sequence prevents old queued progress from pairing new ranges with a completed checkpoint. A crash after the atomic rewind causes the next child to recover from genesis. Re-registering already covered bounds does not restart or rescan.

## Trust and payment boundaries

SPV validates the official header/certificate chain and compact filters, downloads matching blocks and checks their Merkle/witness commitments. It does not validate every transaction against a full UTXO set and does not observe a complete mempool. Receive/redeem notifications are confirmed-chain observations, and `TestMempoolAccept` is unimplemented. The companion must label this source correctly and retain its existing backend checks for other source modes; no missing mempool call is represented as success.

The native broadcast method is reachable only through trusted local parent code. The parent still requires exact stored bytes, current account ownership, independent signature verification, journal reservations and explicit user broadcast approval. All timeout/rejection outcomes retain the same saved payment. Upstream SPV does not automatically rebroadcast after rescan; the façade uses one-shot `SendTransaction` and does not import unsent signed payments into an upstream auto-send workflow.

## Build, size and licensing

The unified upstream Go module requires Go 1.26.6. Native builds use verified current source, CGO, `-tags xmss,zkpow`, the official Rust `zk_pow_ffi` static library, generated verifier caches and XMSS static library. The committed Go module uses an immutable pseudo-version; a scratch modfile points native linking to the verified source build, rather than committing an absolute replacement path. No upstream source tree or compiled binary is vendored in the product repository.

The initial local native executable was approximately 26 MiB. Initializer/native linkage tests passed before live synchronization; this is not a portable binary size or runtime-memory guarantee. Default Neutrino caches allow about 31.2 MB filters and 40.96 MB blocks, with eight outbound peers. Header/filter files alone use 140 bytes per height, plus indexes/history/filters. Downloaded headers carry proof certificates up to 65,000 bytes each (100 headers per message), so initial sync is not an 80-byte-per-block Bitcoin download. Actual bytes, duration, RSS and verifier CPU cost must be measured on the recorded build.

Licenses are ISC for Pearl node/wallet, MIT for `spv/LICENSE`, and MIT OR Apache-2.0 for Plonky2; preserve the linked dependencies' notices. The SPV README's ISC sentence conflicts with its actual MIT license file. [Build][build], [verifier][verifier], [licenses][license]

## Qualification remaining

The public-only initializer passed five tests covering strict schema/duplicate/null rejection, invalid points/network/account, exclusive private directory creation, watch-only reopen, restored bounds, symlinks, six independent TypeScript derivations across both branches, and atomic historical rewind. All six native tests passed, including malformed-message rejection before native state access.

The first [native public-fixture pilot](native-pilot.json) connected to eight mainnet peers and advanced to header 300 in approximately ten seconds. Filter height remained zero and wallet synchronization/readiness correctly remained false. Three status calls preserved the full account/watch-only binding; SIGTERM exited cleanly with status 0. This is initial real header verification, not a fully synchronized account. The private fixture profile and header cache remain at the path recorded in the evidence. Full sync, reconnect/reorg/interruption, complete snapshots and process restart remain qualification gates.

No funded transaction, signature or broadcast was performed by this implementation lane. The user can approve the intended small mainnet trial after the local source reaches a verified usable state.

[loader]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/loader.go
[import]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/import.go
[manager]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/waddrmgr/manager.go
[scopes]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/waddrmgr/scoped_manager.go
[recovery]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/recovery.go
[proto]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/api.proto
[rpc]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/rpcserver/server.go
[json]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/legacyrpc/methods.go
[setup]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/walletsetup.go
[startup]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/btcwallet.go
[listeners]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpcserver.go
[utxos]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/utxos.go
[chain]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/chain/neutrino.go
[rescan]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/rescan.go
[headers]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/spv/headerfs/store.go
[wire]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/wire/blockheader.go
[service]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/spv/neutrino.go
[msgheaders]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/wire/msgheaders.go
[build]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/Taskfile.yml
[verifier]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/zkpow/verify.go
[license]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/LICENSE
