# Offline account-discovery review

Read [REPORT.md](REPORT.md) for the two corrected consistency gaps and remaining trusted-indexer/recovery boundaries.

Reproduce from the repository root with already-installed dependencies:

```sh
node --import tsx --test tools/account-discovery-review/account-discovery.test.ts
node node_modules/typescript/bin/tsc -p tools/account-discovery-review/tsconfig.json
node --import tsx --test packages/wallet/test/*.test.ts
```

All fixtures are synthetic public material. HTTP replies are in-memory mocks. No network, secret input, signing, broadcast, native program, browser or device is involved. Never send funds to fixture addresses.

Baseline artifacts ending in `.txt` and `before-fix-tests.log` demonstrate the pre-correction behavior, not the current expected result. The maintained test suite asserts that those contradictions are rejected.
