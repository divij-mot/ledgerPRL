# Payment sequence review

See [REPORT.md](REPORT.md) for coverage, results and precise limits.

Offline rerun from the repository root with existing Node dependencies:

    PRL_SEQUENCE_OUTPUT=/tmp/payment-sequence-results.json node --import tsx tools/payment-sequence-review/sequences.mjs

The retained final run is `run.log`; machine-readable evidence is `results.json`.
No native firmware, emulator, browser, live service, signing key or funded account
is needed or used. Only host TypeScript is bundled into memory.

The thin wrapper in `apps/companion/test/payment-sequences.test.ts` is included
in ordinary companion CI. It writes only to a unique temporary result directory,
checks the exact fifteen-case success summary and enforces a 120-second timeout.
Run it alone with:

    node --import tsx --test apps/companion/test/payment-sequences.test.ts
