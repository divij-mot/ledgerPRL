# Final release software qualification

This is retained development evidence, not a hardware attestation, security audit,
Ledger approval, or production-readiness claim. No physical device was installed,
no custody seed was used, and no financially valued transaction was sent. All
emulator keys come from the public BIP32 vector-1 seed. **Never fund these addresses.**

## Results and exact scope

- 25 release builds: Nano S Plus, Nano X, Stax, Flex and Nano Gen5 (`apex_p`), each
  on mainnet, original testnet, testnet2, regtest and simnet.
- All 25 builds passed emulated capability/account/receive/change-address checks,
  including four wrong host-network selections for each build.
- All 25 offline packages passed the pinned official loader/hash generator and a
  separate standard-library ELF/APDU decoder. No USB transport or installer ran.
- The five simnet models passed six suites each: canonical signing, unusual-path
  and high-fee warnings, hostile events, actual Pearl 16-input roundtrip, four
  internal/output-key parity combinations, and 20 varied repeated sessions.
- Totals are 30 suites, 77 hostile-event cases, 220 node-roundtrip checks and 100
  mixed sessions. These are categories of coverage, not 30 additional hardware tests.
- The ten retained node transactions contain 100 native BIP340 signatures. Offline
  reconstruction verified every signature, canonical bundle, txid, wtxid and raw
  transaction. Pinned Pearl upstream independently verified all 100 BIP341
  digests/BIP340 signatures and executed the script engine for every input.
- Eleven packager unit tests passed. The independently reviewed normal-clock
  timeout, trusted-display and compiled-cleanup reports are retained separately.

Final native crypto SHA256:
`50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

The runtime inventory predates a later **host-only** recovery-export capacity fix.
`source-snapshot/` retains the exact 63-file union of native and runtime inputs
from local commit `d1fd0d38069c09b871b836377812e2fc4bef8b3d`, plus package metadata.
This local commit is provenance, not a GitHub revision identifier. Hashes and the
retained source bytes are authoritative. Do not claim this inventory validates
later host edits. Native inputs and SDK verification code remained unchanged.

## Contents

`qualification-report.json` is the compact checked report. `build-manifests/`,
`runtime/`, `network/`, and `packages/` retain original JSON outputs. Common source
maps are deduplicated; all 60 before/after runtime inventories were byte-identical.
`runtime-bindings.json` preserves each run's artifact/source checks and timestamps.
`transactions/` retains canonical bundles, signed transaction bytes, public account
fixtures and APDU transcripts. No ELF, HEX/APDU install image, dependency cache,
full screenshot collection or vendor checkout is included.

Some original evidence contains historical local paths. Verifiers below use the
selected evidence directory rather than trusting those paths. The source snapshot
is for binding/review, not a complete standalone firmware build checkout.

`harnesses/network-smoke.original.mts` is the exact executed network harness.
`network-smoke.mts` differs only in repository-relative imports/root resolution.
Its intended installation location is `tools/native-release-qualification/`.
Its imports/target guard were tested in an isolated repository layout. No claim is
made that its changed file hash was the originally executed harness hash.

## Recheck retained evidence

From a repository checkout with its locked Node dependencies installed:

```sh
python3 tools/native-release-qualification/verify.py \
  --source tools/native-release-qualification/source-snapshot
node --import tsx tools/native-release-qualification/verify-transactions.mts \
  --source .
```

The first command checks evidence/source/manifest/count consistency. Add
`--artifacts /path/to/retained/artifacts` to hash the 25 actual release ELFs too.
The second command hashes the frozen SDK inventory before rechecking all 100
signatures. A source mismatch fails; it does not silently use newer code.
Neither command repeats emulated UI approval or historical node acceptance.

To regenerate the compact report from the full original run directory:

```sh
python3 tools/native-release-qualification/aggregate-run.py \
  --source tools/native-release-qualification/source-snapshot \
  --run /path/to/full/retained/run --output /path/to/new-report.json
```

The parameterized aggregator was replayed successfully; every report field matched
except its new generation timestamp. Output must be new; earlier evidence is not
replaced. Optimized Python (`-O`, `-OO`, or `PYTHONOPTIMIZE`) is rejected because
the aggregator uses assertions for its source and artifact checks.

For an independent Pearl replay, use Go 1.26.6 and the pinned module locks:

```sh
cd tools/native-release-qualification/upstream-oracle
go mod verify
for fixture in ../oracle-fixtures/*.json; do
  go run -mod=readonly . "$fixture"
done
```

The retained successful replay used an existing verified module cache with
`GOPROXY=off`. An earlier attempt pointed at the wrong empty cache and performed no
oracle checks; that dependency failure is separately retained. No failure was
counted as a pass. The actual isolated Pearl node roundtrips had already passed
before this extra offline replay.

## Remaining limits

No physical-device/OS compatibility or RNG-fault-resistance claim is made. Native
OS/syscall memory, hardware side channels and exceptional reset paths need their
own validation. Conventional BIP340 custody is not quantum-resistant. Nano X
retail sideload restrictions and vendor review/publication gates remain. Instrumented
memory results use separate test-only binaries and are not part of this release
ELF measurement claim.
