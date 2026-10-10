# Current-source Nano S Plus emulator checkpoint

On 10 October 2026, the owner explicitly requested emulator testing before physical-device work. The native lane resumed in an isolated official Ledger container. No signer source or SDK patch was needed. The previous paused/blocked record remains historical; its original rejection reason was not preserved in the repository.

Both builds bind app source-set SHA-256 `b4cb9dba4ceb09c07fd5f7ed7c08f9dba8b10e0eb0ac8eebba1b1aa2e4da5d34`. Source inventories were checked against the working repository after testing. The exact SDK checkout was clean before and after the runs.

| Artifact / check                              | Result                                                                                                 |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Nano S Plus regtest ELF                       | `113a556b2c3708f3aa2edf04467bb204d4f9fd510c78c9f015ae50acd9d48446`                                     |
| Nano S Plus mainnet ELF                       | `729df866b5168192c50abf0904ee31db8f5b8edcf3cd30bd6056acb4bfacfb15`                                     |
| Regtest account / Receive / two-input signing | Passed, independent signature and finalized-transaction verification                                   |
| Mainnet account / Receive / two-input signing | Passed, expected public account at `m/86'/808276'/0'` and full `prl1` address review                   |
| Regtest hostile-host suite                    | All 75 native cases rejected; firmware remained responsive                                             |
| Regtest explicit review rejection             | `6985`, zero yielded signatures, then a fresh approved session succeeded                               |
| C arithmetic/path unit suite                  | All five network configurations passed ASan/UBSan; 1M arithmetic + 400k fee-boundary cases per network |
| Native TypeScript harness typecheck           | Passed                                                                                                 |

The mainnet pilot uses only the public BIP32 vector-one seed and synthetic nonexistent inputs. No node, broadcast, network funds or physical Ledger is involved. Host derivation supplies an independent expected public account; signing takes place in Speculos. Never fund these public test addresses.

Both mainnet and regtest also passed a [positive P2MR-recipient replay](p2mr/README.md) on the same ELFs. The later harness separately asserts the full displayed destination, P2MR label, exact amount and fee; earlier P2TR source hashes remain unchanged.

## Retained evidence

- [Runtime and isolation](runtime.json), [test/source hashes](test-source-hashes.json), [regtest build](regtest-build.json), [mainnet build](mainnet-build.json).
- [Regtest pilot](regtest/result.json), [mainnet pilot](mainnet/result.json), [75 rejection cases](adversarial/adversarial.json), [explicit rejection](reject/result.json).
- Each run includes exact firmware identity and recorded NBGL text; selected original emulator screenshots show both address pages and final approval/rejection. ELF/HEX files and bulk logs remain outside the repository.

## Replay

Use the [official Ledger builder](https://github.com/LedgerHQ/ledger-app-builder) image pinned in `runtime.json`, clean secure SDK commit `6709cd2bdfebb224ee070f7c1211b54254262579`, Node 24.19.0 Linux arm64 and the locked npm dependencies. The image already contains Speculos 0.27.1/API27 libraries, QEMU and ARM GCC. Add `/usr/lib/llvm-21/bin` to PATH for `ld.lld`; set `PRL_SYSROOT=/usr/lib/arm-none-eabi` and `BOLOS_SDK` to the exact SDK mount.

Use a dedicated source copy with a Git root, as required by the SDK. SDK test screenshots can remain Git LFS pointers (`GIT_LFS_SKIP_SMUDGE=1` during clone); this avoids falsely marking hydrated LFS screenshots modified in a container without git-lfs. Do not disable the build's SDK cleanliness check.

The recorded container used `--network none --read-only --tmpfs /tmp:rw,nosuid,nodev --cap-drop ALL --security-opt no-new-privileges --user 501:20`. Only the dedicated source/evidence copy was writable. SDK and auxiliary runtimes were read-only mounts. There were no USB, host device, Docker socket or home-directory mounts, and no published ports. Local loopback inside the container connects the test harness to Speculos.

Inside that container, run:

```sh
tools/bitcoin-prl-port/build.sh nanos2 regtest
tools/bitcoin-prl-port/build.sh nanos2 mainnet
tools/bitcoin-prl-port/unit.sh

export SPECULOS_MODEL=nanosp
export PEARL_TEST_NETWORK=regtest
export PEARL_APP_ELF="$PWD/apps/ledger-bitcoin-prl/build-artifacts/nanos2-regtest/app.elf"
PEARL_EVIDENCE="$PWD/evidence/regtest" node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-pilot.ts
PEARL_EVIDENCE="$PWD/evidence/adversarial" node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-adversarial.ts
PRL_FAULT_CASE=deny-and-restart-cleanly PEARL_EVIDENCE="$PWD/evidence/reject" node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-review-faults.ts

export PEARL_TEST_NETWORK=mainnet
export PEARL_APP_ELF="$PWD/apps/ledger-bitcoin-prl/build-artifacts/nanos2-mainnet/app.elf"
PEARL_EVIDENCE="$PWD/evidence/mainnet" node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-pilot.ts
```

Evidence directories must be fresh. The driver refuses to replace a tested ELF snapshot. The recorded Linux esbuild binary was checked against the npm lockfile; the Node archive was checked against the official published checksum. The app's build recipe records narrower provenance than full cross-machine reproducibility; the immutable container digest supplies compiler/sysroot binding for these runs.

## Limits

This is a limited current-source Nano S Plus checkpoint, not full release qualification. Other models, complete timeout/fault campaigns, maximum-capacity/display matrices, physical timing/USB behavior, installation compatibility, live-chain acceptance and independent professional review remain open. These direct SDK-to-Speculos tests do not exercise the Ledger Wallet Electron bridge or prove the browser UI's full signing flow. Speculos does not model all hardware isolation, alignment or watchdog behavior; see its [official limitations](https://github.com/LedgerHQ/speculos#limitations).
