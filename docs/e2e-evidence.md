# Native Ledger → Pearl node evidence

Recorded 9 October 2026. Development emulators and public test keys only; this is functional integration evidence, not a security audit, physical-device certification, or permission to use valuable funds.

## Actual passing runs

The checked-in runner is `tests/e2e/native-node-roundtrip.ts`. Essential artifacts are retained under `tests/e2e/evidence/<model>/`: normalized result/provenance JSON, exact APDU transcript, canonical bundle, signed transaction, UI event transcript, and representative PNG screenshots. The normalized result removes machine-specific temporary paths; it retains a SHA256 of the original run record. The retention tool verifies the exact executed snapshot hash and excludes all ELF/node binaries from the repository.

| Native target | Speculos model | Actual inputs | Bundle bytes | Cases passed | Review/sign total | After final action |
| ------------- | -------------- | ------------: | -----------: | -----------: | ----------------: | -----------------: |
| Nano S Plus   | nanosp         |            16 |        1,507 |           22 |          13.543 s |            6.084 s |
| Nano X        | nanox          |            16 |        1,507 |           22 |          14.103 s |            6.469 s |
| Stax          | stax           |            16 |        1,507 |           22 |          13.966 s |            9.169 s |
| Flex          | flex           |            16 |        1,507 |           22 |          14.597 s |            9.343 s |
| Nano Gen5     | apex_p         |            16 |        1,507 |           22 |          16.492 s |           10.640 s |

Times are measured host wall times in this emulated environment, including APDU transport and UI automation. Touch final-action timings include the 2.5-second emulated touch hold. They are not secure-element signing benchmarks. No crash, allocation error or signature failure occurred in these runs. Stack/heap high-water was **not measured**.

All 22 cases passed on each listed run against final hardened firmware, with a separately hashed immutable ELF snapshot for every run:

- Native capabilities and correct simnet identity; emulated button/touch-approved account export matching the public BIP32 vector; full receive-address review matching public-only BIP86 derivation
- Out-of-order APDUs and malformed BEGIN fail closed; wrong network, substituted input ownership, forged change script and wrong bundle hash reject before releasing a signature
- Explicit UI rejection clears the session; abort before review clears the transferred bundle; abort after approval and one independently verified signature blocks all remaining exports and replay; a new review/sign then succeeds; completed signature export cannot be replayed
- Fresh isolated Pearl simnet node verifies expected genesis/zero peers, mines 101 or 115 blocks to the device-derived receive address, discovers the public account and validates exact mature prevouts through the production bridge
- Native BIP340 signatures for every input pass independent host verification; Pearl rejects a bit-flipped witness, accepts the original through `broadcastVerified`, and mines the exact raw transaction
- Production `checkSnapshot` excludes inputs already spent in the Pearl mempool, even though Pearl's `gettxout` still returns those confirmed outputs
- Confirmation removes the spent inputs; account rediscovery finds the exact recipient and change; invalidating and reconsidering the confirmation block detaches and restores the transaction

The max-input tests intentionally spend 16 distinct mature outpoints paying the same derived key. A separate parity run below establishes the distinct-key coverage.

## Independently derived key-parity coverage

`tests/e2e/evidence/nanosp-parity/` records a separate successful 22-case immutable Nano S Plus run with four inputs, a 463-byte bundle, and the same final ELF hash as the max-input run. Its public-only Go oracle (`tests/e2e/parity-oracle/main.go`) uses the pinned Pearl BIP32 and BIP86 implementation to identify:

| Receive index | Internal-key Y parity | Tweaked-output Y parity |
| ------------: | --------------------- | ----------------------- |
|             0 | Odd                   | Even                    |
|             3 | Even                  | Even                    |
|             4 | Odd                   | Odd                     |
|             9 | Even                  | Odd                     |

The node mines genuine coinbases among all four derived addresses; the runner chooses four mature distinct-key outputs, obtains native signatures after emulated UI approval, independently verifies every signature on the host, and requires actual Pearl mempool acceptance and mined confirmation. The exact public points/addresses are in `tests/e2e/parity-vectors.json`. No software signer supplies these signatures. This parity run took 7.071 seconds for review/signing and 1.608 seconds after the final emulated approval action. Parity coverage is established on Nano S Plus; repeating the full parity transaction on every model is not claimed.

A separate reviewer also independently reconstructed an earlier immutable parity fixture and executed the pinned Pearl Go oracle: four BIP341 digests, four BIP340 signatures, full script-engine checks, account/owned scripts, receive address, txid and wtxid passed. The final node run uses the latest transport-hardened ELF.

## Source and execution pins

- Pearl: `pearl-research-labs/pearl@2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`
- Ledger Rust SDK: `LedgerHQ/ledger-device-rust-sdk@4123d2dc85a2085115e6a36826460a9fe742cfb1`
- Ledger Secure SDK: `LedgerHQ/ledger-secure-sdk@6709cd2bdfebb224ee070f7c1211b54254262579`, native API level 27
- Speculos: 0.27.1; QEMU executes the real target ELF, using the model's API-27 shared library
- Rust: `nightly-2025-12-05`; Pearl node Go compiler: 1.26.6
- Native application paths and exact ELF SHA256 values appear in every retained `result.json`; binaries are deliberately not checked in
- Public seed: BIP32 test vector one, `000102030405060708090a0b0c0d0e0f`; account `m/86'/1'/0'`; no user seed or private account is used

The node binary SHA256 is `dedca59b19feeeed7ffd0d91806b094be00a93d0705419aa5a9ccb315e9f79ec`. Its only test-harness source addition redirects the otherwise unwritable default home directory via `PEARL_TEST_HOME`:

```go
package main
import "os"
func init() {
    if home := os.Getenv("PEARL_TEST_HOME"); home != "" { defaultHomeDir = home }
}
```

No consensus, script, signature, proof-of-work policy, RPC or wallet behavior was patched. The node's existing `--simnet` dummy-certificate mining path is used. `--regtest` could not CPU-mine this Pearl revision's V1 proof path in this environment, so regtest mining is **not claimed**.

Each run creates a fresh node data directory and starts `--simnet --nolisten --nodnsseed --notls`, with loopback-only authenticated RPC, public test-only credentials, and no peers. Both emulator and node are child processes of the same runner, avoiding separate executor network namespaces. Only this isolated simulation node receives transactions.

## Compatibility bugs found and fixed

- Initial regtest ELF was correctly rejected by the simnet-only harness. This was an intentional configuration failure; no signing or broadcast followed.
- Native account derivation initially returned `0x6f00` before UI review. The firmware worker corrected the checked SDK derivation boundary and pinned the released API-27 SDK; successful account metadata now exactly matches the public vector.
- The actual Pearl node rejected the companion's boolean `getrawtransaction` verbosity with RPC `-32602`. The bridge now sends integer `0`; regression tests and all passing native-node runs above exercise the corrected call.
- Pearl `gettxout(includeMempool=true)` does not hide confirmed outputs spent only in its mempool. The production bridge now checks bounded raw mempool transactions and stable membership before marking an input usable. This is tested against the actual node, not a mock.

## Inconclusive intermediate failures and corrected test setup

An intermediate Nano S Plus parity run reached a successful first signature and cleared the remaining signatures on abort, then its next review encountered `SIGSEGV`. Investigation confirmed that another build had overwritten the same shared ELF inode while Speculos was mapping it. This does not qualify as a firmware regression result because code bytes changed during execution. The original failure record is retained under `tests/e2e/evidence/nanosp-parity-crash/` and classified as inconclusive.

Artifact publication now uses atomic rename. More importantly, the runner copies the entire ELF into a fresh per-run snapshot, hashes that copied buffer and executes only that file. All five final maximum-input runs and the final four-key parity run above were rerun with this protection; the repeated approval/partial-export/abort/new-review sequence passed and the crash did not recur. Earlier unsnapshotted passes were replaced in the retained model results rather than presented as exact-binary qualification.

Two intermediate parity retries also stopped in discovery while the wallet interface gained mandatory confirmed/pending counts. The harness's RPC adapter was updated to provide actual node counts and transaction confirmations; the final matrix uses the current strict interface. Those incomplete retries are not counted as passing native-parity runs.

## Not established

No physical Ledger installation, device OS upgrade, real-money/mainnet transaction, private-seed handling, cable/Bluetooth loss behavior, side-channel resistance, or Ledger review has been established by this suite. Additional native transport-fault and touch UI evidence belongs to the firmware test reports; do not silently treat unrun device/OS cases as passing. Mainnet compilation and emulator signing are separate from broadcast permission.

## Reproduction

See `tests/e2e/README.md`. Set `PEARL_E2E_INPUTS=16` for the cap test and use a simnet ELF. This suite has no software signer. The expected independent consensus result is acceptance by the pinned Pearl node after native UI approval; the negative control flips a witness bit and must be rejected.
