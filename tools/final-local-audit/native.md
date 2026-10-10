# Independent local native audit

Audit date: 2026-10-10. Scope: local watch-only initialization, the in-process official Pearl wallet/Neutrino facade, native build provenance, private stdio lifecycle, and the Ledger firmware custody boundaries. Reviewed the implementation and upstream source independently; prior audit conclusions were not used as proof.

## Finding and disposition

**P2, fixed: native readiness could precede a connected peer's advertised tip.** `apps/light-client/cmd/pearl-watch/serve_native.go` previously relied on Neutrino `IsCurrent()` without comparing `BestPeerHeight`. Upstream `BlockHeadersSynced()` checks the selected sync peer, and can consider recent headers current without a selected peer. A newly connected higher peer could therefore coexist temporarily with a ready old wallet view.

The native readiness predicate now requires `HeaderHeight >= BestPeerHeight`, along with connected peers, upstream currentness, wallet synchronization, equal header/filter/wallet heights and the canonical wallet-tip hash. The regression test exercises peer-ahead denial, partial header/filter catch-up denial, noncanonical-tip denial, full verified catch-up, and acceptance of lagging peer advertisements. The browser parser independently received the same conservative readiness requirement.

No additional unresolved P0–P2 issue was established in the reviewed native scope.

## Trust-boundary review

- The pinned archive SHA-256 is `26dec47642a249fa1728f2520670d4d3b2788696207a3c074e0382cc63237396`, for upstream commit `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`. Independently compared all **4,621** archive files with `/private/tmp/astra-pearl-source`: zero mismatches. Build staging validates member paths/types and uses the real `xmss,zkpow` build tags and Rust verifier libraries. Mainnet `NetBehaviorFlags()` does not exempt proof verification; the actual SPV header path calls contextual, certificate-rule and cryptographic certificate checks. No stub verifier was used for live synchronization or the native tests.
- The initializer uses `CreateNewWatchingOnlyWallet` and imports only the account public key, chain code and fingerprint. Upstream watch-only construction passes a nil root key and omits HD/private-key creation. Reopening verifies manager/account watch-only flags, account xpub, fingerprint, scope, schema, supported ranges and absence of extra accounts/loose imported keys. No seed, software unlock or signing method is exposed by the facade.
- The facade has only inherited stdio, bounded JSONL requests, duplicate-key/exact-field validation and a narrow method allowlist. The parent pins the executable hash, checks private profile paths and owns process cleanup. Request timeouts/termination retain ambiguous broadcast outcomes rather than infer failure or automatically retry.
- Readiness is separate from registered address bounds. Snapshots require native readiness, validate raw transaction IDs, canonical block membership and raw-output/UTXO consistency, enforce bounded history, and repeat readiness/tip/range checks. The browser independently parses raw transactions, derives scripts and checks subsequent snapshot fingerprints. Bounds or a header-only catch-up do not qualify as a complete account scan.
- Range expansion stops wallet/client/SPV workers before exclusively reopening the database. Address expansion, transaction rollback and wallet progress rewind share one database transaction. The old process exits; a new process creates a new notification stream and scans the durable rewind. Upstream rollback-to-chain behavior was separately exercised by focused tests. This review does not claim to have simulated a live mainnet reorganization.
- Broadcast accepts only the constrained signed-transaction shape and exact txid, with readiness required before submission. The same-origin server validates the signed bundle and account before using the private pipe. Upstream Neutrino submission announces once; its wallet explicitly skips automatic unmined-transaction rebroadcast after rescans. No transaction was broadcast by this audit.
- Firmware inspection confirmed chain/genesis binding, a bounded PSBTv2 field allowlist, default Taproot sighash, derivation/ownership checks, checked amount totals, exactly one external recipient and at most one verified BIP86 change output, recipient/fee/change review, strict continuation framing, command deadlines, and on-device Schnorr signing with secret zeroing and signature self-verification. The firmware rename changes only Makefile metadata and the home/settings display, not these policy paths. Existing four emulator pilot and 75 rejection-case artifacts were inspected; this audit did not repeat physical-device approval or installation.

## Fresh validation

- Native Go suite: **7/7 passed**, using actual zkpow/XMSS libraries; final test runtime 9.011 seconds. Evidence: `native-go-tests.log`.
- Focused unmodified upstream wallet tests matching `TestRollbackToChain|TestCreateWatchingOnly`: passed, 1.492 seconds. Evidence: `native-upstream-tests.log`.
- Native build: successful with Go 1.26.6, `-trimpath -tags=xmss,zkpow`, `CGO_ENABLED=1`, macOS deployment target 26.0. Evidence: `native-build.log`. Test links emitted macOS target-version warnings; the final build set the matching target and completed cleanly.
- Rebuilt `apps/light-client/bin/pearl-watch` by writing a temporary executable and atomically renaming it, preserving the existing pilot process mapping. Binary SHA-256: `1a8cdcb5a19883a07ca4eade10745a5d5453fee4678dd4bd052c8387cbf2d0c6`; size 27,519,202 bytes. This is the independently rebuilt audit binary, not a claim that a later setup build has identical bytes.

## Evidence limits

This review establishes the inspected code boundaries and the listed tests. Root owns the separate real mainnet initial-sync pilot and its completion evidence. No second live sync was started or existing pilot stopped here. No funded transaction, broadcast, physical-device approval or replacement of the installed Pearl Dev app occurred. The local client retains the normal security assumptions of the official peer-based SPV stack; it is not full-node consensus validation or an independently proven exhaustive mainnet history result.

Root confirmed the native source freeze after the readiness fix. Final reviewed-source hashes are recorded in `native-reviewed-source.json`; binary hashes identify the specific audit build separately from source hashes.

## Read-only assessment: reusing the pilot's chain cache

A fresh Ledger watch-only profile can reuse the trusted local public-fixture pilot's chain cache after that pilot finishes and exits cleanly. This is a copy of an already verified local chain view, not an account-scan shortcut. No cache files were copied or the pilot accessed by this assessment.

Copy exactly this coherent three-file set from the stopped pilot's `mainnet` directory into the fresh profile's `mainnet` directory before starting its chain service:

- `neutrino.db`: account-independent SPV data. The expected top-level buckets are `header-index`, `filter-store`, and `ban-store`. `header-index` holds block/regular tips and hash-to-height subbuckets; `filter-store/regular` holds public compact filters; `ban-store/ban-index` and `ban-store/reason-index` hold peer-ban metadata. The latter is operational peer state rather than account or signing data.
- `block_headers.bin`: canonical serialized block headers, 108 bytes per record for this exact upstream version, including genesis.
- `reg_filter_headers.bin`: canonical regular-filter headers, 32 bytes per record, including genesis.

Preserve the destination's newly initialized `wallet.db` and `.pearl-watch.json` unchanged. Do not copy source wallet data, app markers, locks, `peers.json`, or the entire profile directory. There is no persistent full-block cache in the configured default path; `BlockCache` is an in-memory LRU. Retaining the cached public compact filters can avoid downloading them again, while relevant full blocks may still need downloading for the new account.

Copy only after confirmed process exit and with neither source nor destination under a writer. Check regular files/no symlinks, same pinned upstream and mainnet/genesis identity, and record the three source hashes and matching destination hashes. Use separate file copies, exclusive destination creation, private directories and 0600 file permissions; never share mutable files via hardlinks. Treat all three files as a unit: a partially copied or mixed snapshot can desynchronize the Bolt indexes and flat files. Source references: upstream `spv/neutrino.go` constructor and `Stop`, `spv/headerfs/store.go` (`newHeaderStore`, `NewBlockHeaderStore`, `NewFilterHeaderStore`), `spv/headerfs/index.go`, `spv/filterdb/db.go`, `spv/banman/store.go`, and `node/wire/blockheader.go`.

The trust limitation matters: reopening the cache reconciles file/index tips; it does not replay historical cryptographic proof verification, nor does it independently establish a different network's genesis for already nonempty files. Its assurance derives from the trusted local pilot's original verification plus byte-preserving copying and explicit network/genesis checks. A remote or untrusted cache must not be substituted. The destination wallet must remain at its own genesis/birthday state, perform genuine discovery/rescan, connect to current peers, and satisfy the fresh header/filter/wallet/canonical-tip/address-coverage readiness checks. Only those checks establish the actual Ledger account's usable snapshot. Completing the public fixture's scan alone does not establish that result.
