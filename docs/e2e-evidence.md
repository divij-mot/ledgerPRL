# Native Ledger → Pearl node evidence

Recorded 9 October 2026. Development emulators and public test keys only; this is functional integration evidence, not a security audit, physical-device certification, or permission to use valuable funds.

## Actual passing runs

The checked-in runner is `tests/e2e/native-node-roundtrip.ts`. Essential artifacts are retained under `tests/e2e/evidence/<model>/`: normalized result/provenance JSON, exact APDU transcript, canonical bundle, signed transaction, UI event transcript, and representative PNG screenshots. The normalized result removes machine-specific temporary paths; it retains a SHA256 of the original run record.

| Native target | Speculos model | Actual inputs | Bundle bytes | Cases passed | Review/sign total | After final action |
| ------------- | -------------- | ------------: | -----------: | -----------: | ----------------: | -----------------: |
| Nano S Plus   | nanosp         |            16 |        1,507 |           20 |          12.874 s |            5.600 s |
| Nano X        | nanox          |            16 |        1,507 |           20 |          13.448 s |            5.970 s |
| Stax          | stax           |             2 |          289 |           20 |           5.243 s |            3.107 s |
| Flex          | flex           |            16 |        1,507 |           20 |          14.255 s |            8.861 s |
| Nano Gen5     | apex_p         |            16 |        1,507 |           20 |          15.828 s |           10.122 s |

Times are measured host wall times in this emulated environment, including APDU transport and UI automation. Touch final-action timings include the 2.5-second physical hold. They are not secure-element signing benchmarks. No crash, allocation error or signature failure occurred in these runs. Stack/heap high-water was **not measured**.

All 20 cases passed on each listed run:

- Native capabilities and correct simnet identity; physically approved account export matching the public BIP32 vector; full receive-address review matching public-only BIP86 derivation
- Out-of-order APDUs and malformed BEGIN fail closed; wrong network, substituted input ownership, forged change script and wrong bundle hash reject before releasing a signature
- Explicit UI rejection clears the session; completed signature export cannot be replayed
- Fresh isolated Pearl simnet node verifies expected genesis/zero peers, mines 101 or 115 blocks to the device-derived receive address, discovers the public account and validates exact mature prevouts through the production bridge
- Native BIP340 signatures for every input pass independent host verification; Pearl rejects a bit-flipped witness, accepts the original through `broadcastVerified`, and mines the exact raw transaction
- Production `checkSnapshot` excludes inputs already spent in the Pearl mempool, even though Pearl's `gettxout` still returns those confirmed outputs
- Confirmation removes the spent inputs; account rediscovery finds the exact recipient and change; invalidating and reconsidering the confirmation block detaches and restores the transaction

The max-input tests intentionally spend 16 distinct mature outpoints paying the **same** derived key. They establish bounded multi-input execution, not all internal/output key-parity combinations. Distinct-key parity coverage, cancellation after partial signature export, and maximum-input Stax execution are not claimed by the results above. Additional results may be recorded below when completed.

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

## Not established

No physical Ledger installation, device OS upgrade, real-money/mainnet transaction, private-seed handling, cable/Bluetooth loss behavior, side-channel resistance, or Ledger review has been established by this suite. Additional native transport-fault and touch UI evidence belongs to the firmware test reports; do not silently treat unrun device/OS cases as passing. Mainnet compilation and emulator signing are separate from broadcast permission.

## Reproduction

See `tests/e2e/README.md`. Set `PEARL_E2E_INPUTS=16` for the cap test and use a simnet ELF. This suite has no software signer. The expected independent consensus result is acceptance by the pinned Pearl node after native UI approval; the negative control flips a witness bit and must be rejected.
