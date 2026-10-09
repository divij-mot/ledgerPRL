# Final-source instrumented memory replay

Five models passed three 16-input signing flows and a separate 20-session mixed
replay each. All use public BIP32 vector-1 fixtures. No physical Ledger, funds,
seed import, vendor upload or install was involved.

These are measurements from **separate instrumented emulator binaries**, not
measurements of release ELFs or physical-device/OS stack guarantees.

## Exact source and isolation

Crypto SHA256 is
`50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.
The parent release source and both copied SDK checkouts were frozen. Both vendor
checkouts were independently copied; only the mirror's nested instrumented SDK
received the test patch. The parent SDK/release artifacts were never modified.

Before/after native maps match exactly. Every copied input hash was rechecked.
The instrumented SDK differs from the copied release SDK in exactly two tracked
files, and reapplying the retained memory patch independently reproduced both.
Rust SDK pin: `4123d2dc85a2085115e6a36826460a9fe742cfb1`.
Secure SDK pin: `6709cd2bdfebb224ee070f7c1211b54254262579`.
Build features: `simnet,ledger_device_sdk/stack_usage`.

A later host recovery-export change is not imported by these native/core/SDK
measurement tests. It does not change the native source binding.

## Observed results

| Model | App-stack span | Highest app-stack observation | Remaining span | Highest allocator occupancy |
|---|---:|---:|---:|---:|
| Nano S Plus | 31,968 B | 12,544 B | 19,424 B | 1,836 / 8,192 B |
| Nano X | 19,660 B | 12,824 B | 6,836 B | 1,836 / 8,192 B |
| Stax | 26,772 B | 12,640 B | 14,132 B | 1,836 / 8,192 B |
| Flex | 26,772 B | 12,648 B | 14,124 B | 1,836 / 8,192 B |
| Nano Gen5 | 30,868 B | 12,648 B | 18,220 B | 1,836 / 8,192 B |

All five stack observations are 72 bytes above the earlier-source measurements.
The three flows are ordinary maximum-input signing, all recovery/high-fee warnings,
and absolute bounds: maximum account/index, aggregate Pearl MAX_MONEY and long
amount/address/path displays. Each flow returned and independently verified all
16 signatures.

The 100 mixed sessions verified 230 complete/partial signature returns across five
models. Native idle allocator occupancy remained 160 B at initialization and after
sessions 10 and 20. Cumulative mixed-session peak stayed 1,672 B; the separate
absolute-bound tests peaked at 1,836 B. Host process RSS is retained separately and
is not treated as native allocation.

## Recheck and rerun

Intended location: `tools/native-final-memory/`.

```sh
python3 tools/native-final-memory/verify.py --source .
# Optional: also hash the five actual separately retained instrumented ELFs.
python3 tools/native-final-memory/verify.py --source . \
  --artifacts /path/to/retained/instrumented/artifacts
```

The verifier checks exact copied/native inputs, patch hashes, per-model raw result
hashes, sessions, bounded observations, unchanged idle baseline, and optional ELF
bytes. It does not rerun the emulator or prove a hardware bound.

For a fresh measurement replay, configure the pinned toolchain/Speculos described
in `docs/firmware.md`, and ensure the checked-out source and prepared vendor pins
match this qualification. Then use an entirely new output directory:

```sh
bash tools/native-final-memory/run-isolated.sh /path/to/checkout /path/to/new-output
```

This uses the retained repository build/tests inside a new source mirror and
independent vendor copies. It does not mutate the chosen checkout. Node dependencies
are reused through a shared symlink without writes by this runner; the symlink is
not OS-enforced read-only. Output must resolve outside the source checkout, including
through symlink aliases. Compiler/Speculos paths must be configured by the caller;
the wrapper does not install tools. The parameterized wrappers were
syntax/import checked; retained results came from the equivalent original local
runner using the same build and measurement scripts.

## Limits

The SDK paints the app stack and samples allocator occupancy after every allocation.
OS/syscall stack is not measured. Instrumentation changes code layout. Observed
high-water is not a formal worst-case bound; allocator occupancy does not establish
worst-case fragmentation. Physical latest-firmware validation and human security
review remain separate gates. The measurement APDU exists only in these test-only
binaries; release suites reject it.

The folder contains raw compact reports, source/patch inventories, small build
logs and replay/check scripts. It contains no instrumented ELF, vendor checkout,
cache or screenshot duplication. `report.json` is the aggregate; `memory/` and
`stability/` retain exact raw JSON.
