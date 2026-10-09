# Transaction binding regressions

Read [REPORT.md](REPORT.md) for scope, findings, source bindings and limitations.

From the repository root, using the existing pinned dependencies:

```sh
node --import tsx --test tools/transaction-binding-review/transaction-binding.test.ts
node_modules/.bin/tsc --noEmit -p tools/transaction-binding-review/tsconfig.json
node --import tsx --test packages/sdk/test/*.test.ts packages/bitcoin-prl-adapter/test/*.test.ts apps/cli/test/cli.test.ts apps/companion/test/signed-recovery.test.ts apps/companion/test/psbt-lifecycle.test.ts apps/companion/test/signing-recovery.test.ts apps/companion/test/ledger.test.ts
sha256sum -c tools/transaction-binding-review/SHA256SUMS
```

Host-only mocked tests. No device, emulator or network account is required. The existing CLI suite listens only on local loopback for its fixture APDU server. Never fund public-vector test addresses.
