# Mixed-session native stability, 2026-10-09

## Outcome

All **500 release sessions** (100 successive sessions per model, without restarting the app) and **100 separately instrumented sessions** (20 per model) passed. Release sessions exported and independently verified 1,130 signatures: 1,080 from complete signing sessions and 50 from deliberately interrupted partial exports. Instrumented sessions verified a separate 230 signatures. No native crash, stale approval reuse, stale signature retrieval, unexpected process exit or native heap-baseline drift was observed within these bounded runs. This is development evidence using emulated device UI; no physical Ledger was attached.

Each deterministic ten-session cycle includes two ordinary signings, one 16-input signing, account export, address verification, upload cancellation, visible review rejection, invalid ownership/point rejection, offset/hash rejection and partial-signature cancellation. Transaction inputs/branches/indices, output order/change presence, fees and exact large amounts vary. Native negative cases are followed by fresh valid sessions in the same process. The 16-input case occurs ten times per release model and twice per instrumented model. Synthetic outpoints and a public BIP32 test seed are used; nothing is broadcast.

## Release results

The maximum-input columns describe the full session from upload through emulated device UI review/approval, fetching and independent verification. They are not secure-element CPU timings. All five release models ran concurrently on one development host; touchscreen holds, transport, rendering, signature verification and host contention are included. Median is the upper middle sorted sample; p95 is the sorted floor(0.95 × count) sample capped at the last sample. Full per-case and approval-gesture timing distributions are in each JSON.

| Model       | Sessions | Verified signatures | Max-16 min / median / p95 / max | Emulator RSS change, session 10 → 100 |
| ----------- | -------: | ------------------: | ------------------------------- | ------------------------------------: |
| Nano S Plus |      100 |                 226 | 13.34 / 13.95 / 14.54 / 14.54   |                             2,332 KiB |
| Nano X      |      100 |                 226 | 13.06 / 13.87 / 14.88 / 14.88   |                             2,268 KiB |
| Stax        |      100 |                 226 | 13.51 / 13.94 / 14.51 / 14.51   |                             8,560 KiB |
| Flex        |      100 |                 226 | 14.01 / 14.15 / 15.31 / 15.31   |                             7,384 KiB |
| Nano Gen5   |      100 |                 226 | 15.35 / 16.22 / 17.19 / 17.19   |                             2,544 KiB |

Emulator-process RSS increased by 2.2–8.4 MiB over the warm baseline. This measured host-side growth is retained, not labeled zero drift or attributed to native firmware. RSS combines Speculos/Python and QEMU; it is not the native app heap, and these bounded observations do not prove an emulator leak or long-term memory bound. The historical Speculos OCR event cache is cleared after each idle session through the official DELETE /events endpoint, which does not alter current screen content, firmware state or approval. Log/UI/APDU histories are bounded as documented by the harness.

## Separate instrumented resource results

Instrumentation was initialized once per run. The app heap baseline was checked at initialization and after sessions 10 and 20. Each model stayed at 160 B, with zero observed baseline drift. The allocation-sampled cumulative heap peak reached 1,672 B by session 10 and did not grow in the second cycle. App-stack high-water also stayed unchanged after the first cycle and matched the previous maximum-input measurements.

| Model       | Sessions | Initial → final idle heap | Cumulative allocator peak | App-stack high-water |
| ----------- | -------: | ------------------------- | ------------------------: | -------------------: |
| Nano S Plus |       20 | 160 → 160 B               |           1,672 / 8,192 B |             12,472 B |
| Nano X      |       20 | 160 → 160 B               |           1,672 / 8,192 B |             12,752 B |
| Stax        |       20 | 160 → 160 B               |           1,672 / 8,192 B |             12,568 B |
| Flex        |       20 | 160 → 160 B               |           1,672 / 8,192 B |             12,576 B |
| Nano Gen5   |       20 | 160 → 160 B               |           1,672 / 8,192 B |             12,576 B |

These are separately instrumented app measurements, not release-binary memory proofs. OS/syscall memory, physical-device behavior and worst-case fragmentation remain unmeasured. Instrumented timing data is retained separately and is not used in the release timing table. See ../<model>/memory.json for linker stack spans, instrumentation patch hashes, and the larger earlier absolute-bound peak of 1,836 B.

## Immutable binaries and test provenance

| Model       | Release simnet ELF SHA256                                          | Instrumented simnet ELF SHA256                                     |
| ----------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| Nano S Plus | `016a24fb3dce05d48a08118575802a44d561c29781572fbeab9d037bda77a661` | `c79e05a3cc8dbace16811c5ca4d8b7b082342306672ba546227cea4fcc81e1b0` |
| Nano X      | `4771a8b5349042bfac313e33e5b66229c2e76e327469e8af01c86dede68356a0` | `0532d40ea96a4af56513102572282f50e987e37e20fcd3433779d2023d168074` |
| Stax        | `7232fb09694fc9d2f27040ed19685277fb7065c6dfe9e6aa28647391e7fcc678` | `8186f80d96102f2e36fa51576892d18051fcffad90cd0a541ff3aeaabead4863` |
| Flex        | `07405a1c64c6fadfa289ede2fa1d9c4593cb29f784d85a219ac8a672d7b4b8fd` | `3017fb666359320c785093d05789df6cbc471372c345bbc33f663632b14c08a9` |
| Nano Gen5   | `4efa4e5a91bdb1ffcaba3c6c022f048972b09554601bf7da4027b23f60aa3592` | `7b3d332c06a73e3f1a8d836648a85760f2c023af18e762550c7ba70526e7f61a` |

- Native signing source SHA256: `e29384e20151aca794771c2026aa93ac710ad796ac6c44f0f1ca4ae3a378f563`
- Production SDK patch SHA256: `49b0ebcd4632c59a5312ed49966b14c51104bb400c9e7917f28f2b560507f09b`
- Instrumentation patch SHA256: `239aee20dac28c21562a7f99ca1e2ccf872d2d99da2c9dca520dedb3b903427b`
- Stability harness SHA256: `99bc588374523e93b1221903c47133cc5ad59e8a9f667239dc86375fc44a2cd6`
- Emulated device UI driver SHA256: `ab3d5d8a1638b9ee2841a2467f21f0cef33eab0d1ec0e6df4a5d67cfbf0f8fdf`
- Speculos: 0.27.1; firmware compiler: nightly-2025-12-05; public test seed: `000102030405060708090a0b0c0d0e0f`.

Each machine-readable report retains its immutable snapshot hash, run timestamps, dependency-lock and fixture hashes, all session records, resource checkpoints and source-unchanged check. `SHA256SUMS.json` binds the ten reports. No ELF, full emulator trace or duplicate screenshots are stored here. Original run directories identify the local evidence origin, not portable dependencies.

## Replay

Install the documented official toolchain, Speculos 0.27.1 and repository Node dependencies. Build simnet release artifacts and separately instrumented artifacts using the tracked build helpers. Set SPECULOS_BIN and SPECULOS_PYTHON when the Speculos virtual environment is not on PATH. From the repository root:

```sh
SPECULOS_MODEL=nanox PEARL_EVIDENCE=/path/to/fresh-release-directory \
  node --import tsx apps/ledger/tests/native-stability.ts
SPECULOS_MODEL=nanox PEARL_INSTRUMENTED=1 \
  PEARL_EVIDENCE=/path/to/fresh-instrumented-directory \
  node --import tsx apps/ledger/tests/native-stability.ts
```

Repeat with nanosp, stax, flex and apex_p. Defaults are 100 release or 20 instrumented sessions. For concurrent runs, give each model a distinct SPECULOS_API_PORT with gaps of at least two. Use a sufficiently large shared/workspace filesystem rather than /tmp, and a new output directory for every invocation. No private host signing key or external node is required. The driver snapshots before launching and refuses to overwrite an existing ELF. Failure retains the current deterministic bundle, bounded APDU/UI history and screenshot, then terminates the emulator.
