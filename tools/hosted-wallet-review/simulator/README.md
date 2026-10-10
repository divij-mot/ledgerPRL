# Current C signer → real Pearl regtest roundtrip

10 October 2026. **16/16 checks passed** using the actual renamed **Pearl Reg 0.1.0** Nano S Plus firmware in Speculos, current TypeScript adapter/fee code, and an isolated official Pearl regtest node. All keys/addresses/funds in this directory derive from the published BIP32 vector-one test seed. **Never fund these addresses or load this test seed onto a funded device.** No physical Ledger, actual mainnet account or running local wallet was accessed.

## What executed

- Pinned Speculos 0.27.1 ran the unchanged C ELF and explicit button-driven public account/Receive review. No firmware approval bypass, signing stub or software signer was used.
- The real node mined 101 blocks from regtest genesis, using its normal proof generation and coinbase maturity. It had no peers, no P2P listener and a fresh private configuration/data directory. Its authenticated test RPC bound only to an ephemeral loopback port.
- Actual `discoverAccount` read the node's indexed address history, raw transactions and UTXOs. Production `checkSnapshot` and `requireFreshValidation` checked the selected input before signing.
- Current UI helper `paymentAtRate` prepared both a P2TR and a P2MR recipient at an explicit **2,000 grains/kvB**, preserving the entered **1.23456789 PRL**. Each actual one-input/two-output transaction was **154 vB** with a **308-grain fee (0.00000308 PRL)**. Exact amount/fee and complete recipient display were checked against captured C-device screen events; representative screenshots are retained.
- The real C app signed each bundle. The existing adapter verified signatures and invoked its durable-byte callback before final acknowledgment. The test wrote the exact bytes into its own fixture evidence directory.
- The real Pearl node rejected a bit-flipped witness, then the production `broadcastVerified` path submitted the intact bytes. The node accepted them into its mempool, mined each transaction and returned one confirmation for those exact bytes. Original inputs became spent, and subsequent account discovery found the change.
- A separate retained-byte check re-finalized both transactions from their stored canonical bundle and witness signatures and checked exact virtual size/rate arithmetic (`fee-verification.json`).

## Identity and isolation

| Artifact | Identity |
| --- | --- |
| C regtest ELF | `77e2dc35fed3443440a1393c42ed6cf03fad13ecf5532a84dab7de014890ce14` |
| Pearl node | Official macOS ARM64 release **v1.4.11**, commit `2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4`; SHA-256 `0d3a83ba76048bc10cb9ce70b915a20b22f9d102fa4fce2b1edb209a1e39c8d7` |
| Speculos image | `ghcr.io/ledgerhq/ledger-app-builder/ledger-app-dev-tools@sha256:8d3da9179dd1b241883c769c521ee9403352b60091c80405b5bef5801a003ba2` |
| Host runtime | Node 24.19.0 |

The node release is **not** the newer `2f8b770` source pin used by the local watch-only helper. This result qualifies transaction interoperability with the recorded actual release node; it does not relabel that binary as a newer source build. Existing node/ELF/image artifacts were reused without downloading or installing software.

The owned Docker container had a read-only root, all capabilities dropped, no-new-privileges, only a read-only public ELF bind, and a loopback-published emulator API. No physical device, home directory or Docker socket was mounted. The host test owned its separate node process and temporary data. After success, both exited; the node log reported complete shutdown, and a scoped process/container check found neither still running. The production wallet server and profile were untouched.

`result.json` records exact source hashes before and after execution; they match. It also records test cases, public account, transaction bundles, signed bytes and confirmations. `screens.json`, selected PNGs and `run-output.txt` retain the observed device sequence. `evidence-sha256.json` binds retained artifacts.

## Earlier attempts and reproduction

Two earlier mining-only attempts failed at HTTP timeout boundaries: first the driver's 120-second abort timeout, then Node's separate 300-second response-header timeout. Neither signed or broadcast a transaction. Both nodes shut down cleanly; `earlier-attempts.json` preserves their status and artifact identities.

The successful driver uses five-block generation batches. It attempted to copy the second failed run's public-fixture chain, but Pearl intentionally removes regtest databases on every startup (`node/btcd.go`, `removeRegressionDB`). Its recorded initial height is **0**, and the successful output confirms all 101 blocks were freshly mined. No proof or maturity shortcut was taken. The optional `PEARL_PUBLIC_FIXTURE_REUSE` environment variable is unnecessary for reproduction and should be omitted.

From the repository root with Node 24.19.0, Docker and the exact already-verified artifacts available:

```sh
PEARL_APP_ELF=/absolute/path/to/recorded/nanos2-regtest/app.elf \
PEARLD_BIN=/absolute/path/to/recorded/pearld \
node --import tsx tools/hosted-wallet-review/simulator/c-node-roundtrip.ts
```

The driver enforces the recorded ELF/node hashes, requires the cached Docker image (`--pull never`), creates its own temporary outputs/ports, and prints the result location. Real proof generation makes the maturity setup take several minutes. No existing node/profile is used by default.

## Scope limits

This is current C signer/native-node integration, **not** a Ledger Wallet WebView, Android, WebHID, physical-device or public-mainnet trial. It exercises the current fee helper, not the complete fee-editing browser UI. Its `WatchSource` adapter reads an actual node but is test-only, rather than the hosted Blockbook or local Neutrino HTTP path. The host durability callback writes real files, but this does not prove browser IndexedDB crash behavior. Cases cover one input/two outputs at one explicit rate for P2TR/P2MR recipients; they do not qualify every fee/input shape, maximum-input resource use, adversarial lifecycle interleaving or all device models. No release/security-equivalence claim follows.
