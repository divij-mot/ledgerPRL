# Native development evidence

These retained machine-readable results come from real ARM Ledger application execution in Speculos 0.27.1 with the public BIP32 vector-one seed. They are development evidence, not Ledger approval or physical-device validation.

- `builds/`: thirteen exact ELF/build manifests, including all five models on mainnet/simnet and all five networks on Nano S Plus. Source/tool hashes and build flags are included.
- `<model>/smoke.json`: exact account fixture, invalid recipient SDK point rejection, subsequent valid address/signing and independent signature verification.
- `<model>/warnings.json` and `warning-screens.json`: extra approval for unusual account/address/input/change paths and high fees.
- `<model>/faults.json`: 16 Nano or 15 touchscreen fault/lifecycle cases, including immutable ELF and numeric SEPH injector hashes. A passing fatal-fault case requires the app's explicit exit status; an emulator exception is not accepted.
- `<model>/node-roundtrip.json` and two `node-*.png` screenshots: current frozen release ELF passed 22 real-node roundtrip cases, with 16 native signatures, isolated acceptance/mining, discovery and reorg. Tool paths must be supplied explicitly when replaying outside the original environment.
- `<model>/memory.json`: separately instrumented ELF and patch hashes, SDK app-stack high-water and allocator occupancy sampled after every allocation across ordinary, warning-heavy and absolute permitted account/index/amount bounds. Release binaries reject the measurement APDU.
- `<model>/latency.json`, when present: five successive maximum-16-input signing sessions. Wall time includes the final approval gesture, emulator, transport, signature fetching and host verification; it is not hardware CPU timing.
- `stability/`: 100 successive mixed release sessions and 20 separate instrumented sessions per model, exact hashes, all case results, latency distributions and explicit host-RSS/native-heap distinctions. See its README for measured results and replay.
- `artifact-race.json`: isolated dummy-file regression proving copy-time generation changes fail closed.
- `build-locks.json`: independent held-lock checks for preparation/build/staging, followed by successful isolated build/stage.

Temporary snapshot/screenshot paths in the JSON identify the original run locations; those paths are not portable attachments. Exact ELF hashes remain verifiable after rebuilding. The reusable node-roundtrip harness and earlier checkpoint/parity evidence are in `tests/e2e/`; current exact-binary results here are described in `docs/firmware.md`.
