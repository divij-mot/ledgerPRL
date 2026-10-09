# Native device to Pearl node integration

`native-node-roundtrip.ts` runs a real compiled Ledger ELF under Speculos and uses the SDK's APDU transport and independent signature verification against an isolated Pearl **simnet** node. The test has no software signing implementation. It cannot connect to mainnet/testnet, reuse a pre-existing node, or broadcast to a configurable external endpoint.

Use development emulators only. The deterministic seed is the **public BIP32 vector-one seed**. The public account must exactly match `fixtures/protocol-v1.json`. Never send funds to these addresses or load this test seed on a funded device.

## Dependencies

- Node.js 22+ and the repository's locked npm dependencies
- Pinned native Ledger SDKs and target toolchain, installed by the firmware build workflow
- Speculos 0.27.1 and QEMU runtime libraries
- A Pearl `pearld` binary built from the source pin in `docs/e2e-evidence.md`

Build the Nano S Plus **simnet** variant with `scripts/ledger-build.sh nanosplus simnet`. Runtime and source pins are recorded separately in `docs/e2e-evidence.md`; passing host tests is not evidence that a native ELF runs.

The runner's defaults match the isolated implementation environment. Override paths to use installed tools:

    PEARL_APP_ELF=/absolute/path/to/simnet/pearl-ledger \
    PEARLD_BIN=/absolute/path/to/pearld \
    SPECULOS_BIN=/absolute/path/to/speculos \
    PEARL_E2E_OUTPUT=/fresh/output/directory \
    node --import tsx tests/e2e/native-node-roundtrip.ts

`SPECULOS_MODEL=nanosp` is the default. `nanox` uses the button driver; `stax`, `flex`, and `apex_p` use physical swipe/tap/hold automation. `SPECULOS_API_LEVEL`, `SPECULOS_API_PORT`, and `PEARL_RPC_PORT` can be changed for the installed runtime. Set `PEARL_E2E_INPUTS=16` for the full 1,507-byte input-cap test (default: two inputs).

Run the entire harness in one process tree: sandbox executor calls can have separate network namespaces. It spawns both servers and the client itself, uses fresh data directories, verifies the simnet genesis and zero peers, and terminates both children. The RPC credentials are public test-only strings. Speculos exposes its test API and must run in an isolated development environment.

## Assertions and evidence

1. Native capabilities advertise the expected simnet network and protocol bounds.
2. Physically simulated export approval returns the expected public test account.
3. Device-approved receive address matches public-only BIP86 derivation.
4. Out-of-order commands fail closed and do not release signatures.
5. Pearl mines 101 blocks (115 for the 16-input cap) to the device-derived address; account discovery scans receive and change branches and reconstructs exact amounts from raw transactions.
6. A wrong-network bundle is rejected before signing; user rejection releases no signature.
7. A two- or 16-input send, with an exact eight-decimal recipient amount and change, is reviewed and signed on the native app. The SDK independently verifies both 64-byte BIP340 witnesses.
8. Pearl rejects a bit-flipped witness, accepts the genuine transaction, and mines it. Exact raw transaction bytes, recipient/change, and input removal are checked.
9. A fresh discovery finds recipient/change and removes spent coins. Invalidating/reconsidering the confirmation block tests detachment and restoration.

Outputs include JSON status for every case actually reached, public APDU transcript, captured review screens, node/emulator logs, watch snapshots, canonical signing bundle and signed transaction. A failure is recorded with its stage; subsequent cases are **not run**, never presumed passing. The runner exits nonzero on any failure.

The node's `gettxout` RPC does not remove confirmed outputs spent only in its mempool. This harness checks input removal after mining; production freshness logic must separately account for mempool spends. The test source is not a production RPC wallet adapter.
