# Pearl FP8 transaction compatibility replay

## Result

The wallet's ordinary Taproot transactions passed the same deterministic checks against Pearl v1.4.11, current master, and the inspected open FP8 proposal. This demonstrates compatibility with these exact sources. It does not establish live consensus, future activation, or production readiness.

Official refs rechecked 2026-10-09 17:37 UTC:

| Ref | Exact commit | Status |
| --- | --- | --- |
| v1.4.11 | `2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4` | Latest published release |
| master | `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701` | Current source and existing production oracle pin |
| FP8 PR #311 | `684f7045f3b3b7c5b7598f46c06b7dceb506f74b` | Open and unmerged |

Sources: [release](https://github.com/pearl-research-labs/pearl/releases/tag/v1.4.11), [master commit](https://github.com/pearl-research-labs/pearl/commit/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701), [FP8 proposal](https://github.com/pearl-research-labs/pearl/pull/311).

## Corrected matrix

Each ref passed:

- The unchanged production Pearl oracle: 2 BIP341 digests, 2 BIP340 signatures and script executions, BIP32 account, BIP86 scripts, address, txid and wtxid.
- 81 independently generated public-fixture transactions through actual Pearl transaction sanity/input checks and `CheckMempoolAcceptance`: 74 accepted, 4 correctly rejected for fee, 2 for dust and 1 for immature coinbase. Every ref produced identical per-case outcomes.
- 610 valid script executions in the policy probe; an additional pass of the same 610 input signatures in the edge probe. These are repeat executions of the same cases, not 1,220 unique signatures.
- 81 byte-for-byte transaction serialization roundtrips, 50 public-account address derivations and 100 lowercase/uppercase address decodings across all five supported networks.
- 3,455 expected rejections: corrupted signatures, missing witnesses, changed outputs, changed sequences and changed input amounts (610 each); truncated transactions (81), invalid output amounts (162), aggregate output overflow (81), and invalid input amounts (81).
- Focused upstream tests: complete txscript, hdkeychain, chaincfg and mempool packages, plus transaction-wire and amount/address subsets. Exact commands and output are retained.

The matrix covers 1–16 inputs, one/two outputs, 99/100-confirmation coinbase maturity, integer amounts above 2^53 and through 2,100,000,000,000,000,000 grains, default 1,000 grain/kvB relay fees and custom 2,000 grain/kvB fees, and P2TR dust boundaries of 333/332 grains (666 at the higher relay rate). The current wallet generator passed 2,469 assertions before emitting these public fixtures.

All five genesis hashes, HRPs and coin types match the wallet. The default scale is 100,000,000 grains/PRL, coinbase maturity is 100, and the default relay rate is 1,000 grain/kvB. Relay settings are node policy, not consensus guarantees. Testnet and Testnet2 share `tprl`, so an address prefix alone does not establish chain identity.

## Source and dependency integrity

The wallet source was read at commit `87ca040566122a290c79a0a1fbd7590723b9da81`; `wallet-source-sha256.json` records the tested files. The signer/transaction/mempool source trees were unchanged across all three refs: `node/btcec`, `node/btcutil`, `node/txscript`, `node/mempool`, and `node/wire/msgtx.go` (172 Go files, 2,957 files including vectors). This supplements execution rather than replacing it.

Each upstream snapshot was exported from its immutable Git commit and all tracked blob bytes verified: 4,615 release blobs, 4,621 current blobs, and 4,770 FP8 blobs. No production dependency, oracle, native binary or repository file was changed by this review.

Builds used Go 1.26.6, linux/amd64, default build tags, CGO_ENABLED=1. They did not enable `zkpow` or `xmss`. `locks/<ref>/<probe>/` retains the actual go.mod/go.sum used. The original replacement paths merely locate review snapshots; replay rewrites that one path in a fresh work copy. `summaries/<ref>-build-modules.json` records actual non-standard module dependencies and module-to-module import edges from `go list -deps -json`, module checksums, original lock hashes, build-metadata hashes and binary hashes. `results/*-build-info.txt` records the modules actually linked. These graphs describe the probe builds, not the entire Pearl monorepo's unrelated dependencies.

The first release-source pass incorrectly retained current transitive dependency requirements. It is explicitly excluded from the corrected pass counts and separately documented in `initial-release-common-deps.json`. The final release pass used its actual versions, including x/crypto v0.55.0, x/sys v0.47.0, testify v1.11.1 and objx v0.5.2. Current/FP8 used x/crypto v0.57.0, x/sys v0.48.0, testify v1.12.1 and objx v0.5.3. The corrected run and focused upstream tests passed. A separately labeled reproduction retains evidence of the initial mismatch; it is not an additional exact-release pass.

## Failures and limits

- The initial offline release-package test attempt lacked its older cached dependencies. Those were fetched from the standard Go module registry and the exact-release focused tests subsequently passed.
- Broad current/FP8 `node/wire` tests failed five certificate/mining tests because the ordinary build has the fail-closed `zkpow` stub. No mining build was enabled and those tests were not treated as passes.
- Broad current/FP8 `node/btcutil` TLS-certificate tests failed at denied netlink interface enumeration. That action was not retried or bypassed; the focused amount/address tests exclude it. Full failure logs are preserved.
- A Go metadata-recording attempt failed automatic VCS stamping outside a valid repository. The replay builds disable only automatic VCS stamping (`-buildvcs=false`) and independently record pinned source hashes. No source or security setting was changed.
- The programs use synthetic UTXOs, deterministic public BIP32 vector 1 accounts and known public signatures. They do not connect to a node, mine coins, broadcast, use user keys, validate a real V4 proof, run Ledger hardware, or establish transaction inclusion.
- Mempool context uses a supplied synthetic tip, UTXO set and final sequence-lock result. It exercises actual Pearl acceptance logic for these transfers, not chain synchronization, reorg handling, arbitrary timelocks, or network adversaries.
- In this FP8 source, `Fp8ForkHeight` is 0 for mainnet/Testnet/Testnet2, and 1 for regtest/simnet. Compiled parameters select certificate V4 at heights 1 and 200 for regtest/simnet. This is proposal configuration, not evidence of a scheduled or live mainnet activation.
- FP8 mining, certificate/proof, header and SPV validation compatibility remains distinct from transaction signing. The companion must use an appropriately upgraded chain backend when an actual release activates FP8. Repeat these gates against that final release and test stale-backend rejection/recovery before real funds.

## Replay

Prerequisites: Go 1.26.6, Git, Python 3, tar, a writable work directory, and enough space for official source snapshots. No Ledger SDK, simulator, GPU or Rust proof build is needed.

Run:

```sh
GO_BIN=/path/to/go1.26.6/bin/go \
PEARL_COMPAT_WORK=/path/to/isolated-work \
bash replay.sh
```

The script clones the official Pearl repository if needed and verifies the complete entry set, Git file kinds/executable modes, symlink targets and blob bytes of every supplied snapshot. Unexpected files, symlinks and directories are rejected. It then exports a fresh private source tree from the pinned Git commit rather than compiling the caller's mutable snapshot. Each probe also gets a fresh module directory, and ambient Go workspaces are disabled. Complete source-set/hash verification is repeated after each probe and the optional upstream tests. It executes only the bundled public fixtures and compares results with the recorded per-ref summaries. Source and dependency downloads may need the internet; fixture execution is network-free. Do not fund any fixture address.

Optional environment variables:

- `PEARL_UPSTREAM_GIT`: an existing complete official-source Git checkout, used read-only with lazy fetching disabled.
- `PEARL_COMPAT_SNAPSHOTS`: existing snapshots named `released`, `current`, `fp8`; their complete entry set is checked, but compilation always uses a separate fresh Git archive. Do not put a `.git` directory or other extra files inside them.
- `GOMODCACHE`, `GOCACHE`, `GOPATH`: reusable caches. `GOPROXY=off` allows a fully offline replay once all needed modules are cached.
- `RUN_UPSTREAM_TESTS=1`: additionally execute the recorded focused upstream tests. It intentionally does not run the certificate/mining and TLS tests described above.

The portable replay consumes one frozen copy of the generated public cases. It does not claim that later wallet changes have been re-tested automatically. Refresh the wallet source hash manifest and regenerate fixtures when signing or transaction-construction code changes. The original generation source and full raw logs remain in the isolated review workspace; large upstream snapshots, caches, compiled binaries and duplicate per-case results are excluded from this portable package.

## Replay provenance controls

`verify-snapshot.py` rejects added source files, symlinks, directories, missing files, changed contents, wrong Git file kinds/executable modes, and populated submodule directories. It never follows directory symlinks during enumeration and opens every file ancestor with `O_NOFOLLOW`, relative to the snapshot root. Legitimate tracked symlinks are checked against their exact pinned target bytes rather than dereferenced or silently omitted.

An incomplete supplied Git object store fails closed because lazy fetching is disabled; populate a separate official-source cache before replay rather than relying on mutations of the caller's checkout.

The only explicit archive special case is the empty `miner/pearl-gemm/third_party/cutlass` gitlink directory at commit `291300ffffa3533a78ee104f08a8490a29ce9ccb` on released/current. Its pinned commit is recorded in the source-set manifest; it must remain empty. No submodule is initialized, and its unverified contents are never compiled. The FP8 pin has no gitlinks. None of these three pins contains symlink blobs.

Run the local adversarial controls with:

```sh
python3 test-snapshot-integrity.py /path/to/complete/upstream/git /path/to/test-work
```

Fourteen controls passed, including an injected extra `.go` file that aborts the full replay before any compiler invocation, directory-symlink substitution, changed tracked bytes, incorrect modes, populated gitlinks, and synthetic pinned-symlink target checks. Both the compiler path and work directory containing spaces are supported. `.gitignore` excludes the default local `.replay/` output. `replay-validation.json` and `results/integrity-regression-results.json` record the corrected harness verification separately from the unchanged transaction matrix counts.
