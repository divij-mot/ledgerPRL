# Composed host payment-lifecycle review

## Result

On the unchanged reviewed checkout, **15 finite sequence tests passed**, with no
new production counterexample. The final run took 19.1 seconds in the measured
case bodies. It executed 212 mocked HTTP requests, including 126 explicitly
requested mock broadcast attempts, and 161 actual backup-validator invocations.
These are harness operations, not real transactions, network traffic or funds.

Reviewed commit: `dbf8af9c2c99fbb971a166d2eeb3c11ecc628f40`.
`results.json` records runtime, exact production/dependency/fixture source hashes,
per-sequence counts and outcomes. The tracked sources hashed before and after
were unchanged. No production file was changed, and no commit was created.

## Why this campaign is different

The existing wallet property campaign checks all state-pair merges and randomized
backup histories, while existing companion tests isolate recovery, persistence,
broadcast and archival boundaries. This packet composes those operations into
longer histories in the **actual companion main.ts handlers**, retaining the same
payment identity, canonical bundle and chosen exact signed bytes throughout.
It reuses public deterministic signature fixtures and the repository's frozen
PSBT endpoint; it is an independently designed sequence harness, not an
independent cryptographic implementation or firmware test.

## Sequences and invariants

One receive sequence checks:

- Successful address verification followed by a rejected next address preserves
  the issued range while clearing the verified-address state.
- Full-backup migration to a fresh simulated profile restores the range without
  restoring device verification. Consecutive issuance then continues.
- Preparing the fixture raises receive recovery coverage to its highest consumed
  path, and discarding the unsigned draft retains both receive and change
  high-water marks through another backup round trip.

Fourteen payment sequences cover seven initial signing outcomes, each with both
original and alternate valid BIP340 witness fixtures for the same transaction ID:

1. Review rejection
2. Disconnect before the first signature yield
3. Disconnect after the first signature yield
4. Explicit cancellation after the first signature yield
5. Final device-ACK loss after verified signed bytes are saved
6. Signed storage commit failure with emergency backup recovery
7. Successful initial signing

The harness asserts that each intended review/signature/ACK boundary was actually
reached. Cancellation must abort the real adapter/fetch signal; observations are
checked outside the UI error catcher so a swallowed test assertion cannot count
as a successful cancellation. These checks were strengthened after independent
review identified a harness false-positive risk; no production change was needed.

Each history then checks the applicable recovery path and the following common
suffix:

- Interrupted attempts remain `signing`, with identical bundle, input locks and
  allocated change. A further recovery review rejection cannot release them.
  A new approved identical-payment recovery saves the selected valid witness.
- Reload and full-backup import strip callback ownership. Stale draft and
  uncertain backups cannot downgrade saved signed bytes.
- A signed-storage failure leaves an emergency artifact that the real backup
  validator independently checks; importing it saves the same payment and clears
  the temporary recovery warning only after verified read-back.
- An unapproved broadcast does not reach the mocked network. Approved timeout,
  wrong transaction ID, HTTP error and explicit cancellation after submission
  all preserve `broadcast-unknown`, exact bytes and every reservation. The mock
  asserts uncertainty was durable before any submitted payload was observed.
- Reload/import after each error and later explicit retries retain the chosen
  raw transaction, transaction ID and bundle. Importing an older accepted backup
  cannot overwrite a later unknown outcome.
- Six-confirmation reconciliation archives without releasing inputs or changing
  bytes. An archived record cannot rebroadcast. A detached checkpoint after
  reload unarchives; an older archive backup cannot reassert archival authority.
- Fresh-profile restoration strips the archived receipt and source validation.
  Unknown evidence cannot archive it; a later confirmed check may archive it.
- Importing another genuinely valid witness for the same transaction ID is
  rejected atomically rather than replacing the retained exact signed bytes.

At every signed/uncertain checkpoint, explicit assertions cover a single
unchanged payment ID and creation time, canonical bundle, exact ordered outpoints
and reserved-outpoint set, both input locks,
receive index 7, next change index 1, exact signed bytes/transaction ID where
present, and rejection of draft discard. Actual local-row validation also runs
at the mocked storage read/write boundaries.

## Independent review and sensitivity control

A separate reviewer inspected the host/mocked boundaries and independently
replayed the strengthened harness: **15 of 15 sequences passed**. Evidence is in
`independent-results.json` and `independent-run.log`.

The reviewer also replaced only the in-memory bundled Cancel handler with a
no-op, leaving production files unchanged. The strengthened harness rejected
this mutation in **14 of 15 sequences**: the two signing-cancellation histories
failed the actual signing-signal observation, and the other twelve payment
histories failed the actual broadcast-signal observation. The receive-only
history passed, as expected. These are **expected negative-control failures**,
not production failures. Metadata and full outcomes are retained in
`negative-control-metadata.json`, `negative-control-results.json` and
`negative-control-run.log`.

The pre-review harness incorrectly passed the same no-op control; the reviewer
identified and we corrected that harness gap before retaining the final baseline.
The control establishes sensitivity to broken Cancel propagation, not coverage
of every possible cancellation race or defect.

## Reproduction

From the repository root, using the existing installed dependencies:

    node --import tsx tools/payment-sequence-review/sequences.mjs

For an independent result without overwriting the retained report:

    PRL_SEQUENCE_OUTPUT=/tmp/payment-sequence-independent.json node --import tsx tools/payment-sequence-review/sequences.mjs

The harness bundles only host TypeScript into memory with installed esbuild and
runs in Node. It does not build or execute C/Rust firmware or an emulator.
A failed assertion or changed hashed source produces a nonzero exit code.

## Ordinary companion CI integration

`apps/companion/test/payment-sequences.test.ts` is a thin wrapper picked up by
ordinary companion tests. It runs the same harness in a child Node process with
a unique temporary result path, a 120-second timeout and a 4 MiB output limit.
It requires a successful exit, unchanged source hashes, exactly fifteen uniquely
named passing rows and zero failed rows, then removes its temporary output.
It adds no dependency, giant fixture, native execution or network access.

The parent verified the final-hash wrapper directly in about 19.4 seconds and
ran the companion TypeScript check successfully. This is a focused integration
result, not a claim that every workspace or live/hardware release gate passed.

    node --import tsx --test apps/companion/test/payment-sequences.test.ts

## Exact limits

- DOM controls, storage event ordering, backup worker dispatch and chain/node
  replies are mocks. No browser, WebHID, IndexedDB engine, real module worker,
  actual network request, physical device or native firmware runs.
- The serial in-memory storage model clones/validates rows and commits or rejects
  atomically. It is not evidence of IndexedDB scheduling, quota, crash, operating
  system or power-loss durability. Reload means a fresh bundled app instance
  reading this mock durable state.
- Snapshot setup starts after prior-output admission and uses synthetic public
  outpoints. This does not check raw-prevout import, indexer discovery, source
  truth, consensus acceptance, actual maturity or actual chain reorganization.
- The node bridge is not executed. Mock reconciliation supplies declared
  confirmed/detached/unknown replies to the real companion validator.
- The backup importer is real; the one-shot browser worker is replaced with an
  asynchronous call to that importer. Worker behavior is outside this packet.
- Frozen signatures are verified by the real SDK, which is also used by several
  assertions. The existing PSBT mock validates the frozen commitment and Merkle
  exchange. Neither is an independent cryptographic or physical approval oracle.
- The DOM mock exposes handlers without browser layout/disabled-control behavior.
  Explicit approval and archived-broadcast assertions exercise handler guards,
  not browser presentation or accessibility.
- These are bounded deterministic histories, not exhaustive interleavings or a
  proof of security. No keys, credentials, private data, real wallets, funds,
  installations, remote writes or live endpoints were used.
