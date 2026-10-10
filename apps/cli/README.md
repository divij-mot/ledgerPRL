# Pearl Ledger development CLI

Run from the repository root after `npm ci --ignore-scripts`:

```sh
npm run cli -- help
npm run cli -- capabilities regtest http://127.0.0.1:5000
npm run cli -- account regtest 0 account.json
npm run cli -- derive account.json 0 0
npm run cli -- verify account.json 0 0
npm run cli -- build bundle.json bundle.hex
npm run cli -- inspect bundle.hex
npm run cli -- sign bundle.hex account.json signed-transaction.json
npm run cli -- tx raw-transaction.hex
```

The emulator must already run the matching Pearl network build. Account export, address verification and signing require user approval on its UI. CLI never presses approval buttons. It has no seed/private-key arguments or software fallback. `SIGINT` cancels an operation and makes the current session terminal. Reset/restart the emulator app after an interrupted request; cancellation of HTTP alone does not establish device-side cleanup.

`bundle.json` is the strict canonical object represented by the `bundle` member of `fixtures/protocol-v1.json`. All `amount` fields are exact integer **grain strings**, not floating PRL numbers. `account.json` follows its `publicAccount` member. The fixture uses public test keys and must never receive funds.

Output files are created exclusively with permissions `0600`; existing files are never overwritten. Signing also reserves an adjacent `<output>.intent.json` with the same private, no-overwrite semantics and keeps it after every outcome, including success. Signed output contains raw transaction hex, txid/wtxid, exact witnesses and vsize. These are sensitive transaction details even though no seed exists in the host.

The CLI intentionally has no broadcast operation. Review the exported transaction and independently confirm node/network before invoking your node's explicit `sendrawtransaction` action. The source-bound emulator/node integration matrix is recorded in [test evidence](../../docs/test-evidence.md). Valuable-funds use, physical-device approval/restore and vendor qualification remain release gates.

## Official Bitcoin-protocol PRL adapter

Hardware commands now require the matching `apps/ledger-bitcoin-prl` app and use `@pearl-ledger/bitcoin-prl-adapter`. The CLI does not silently fall back to the old PRL1 prototype. Offline canonical bundle JSON/hex and public account files remain readable. `capabilities` reports the explicit network/genesis binding and exact decimal-string `maxMoney`.

Before account export/signing, the output path is opened exclusively (`wx`) with `0600` permissions. Signing additionally reserves `<output>.intent.json`. Existing files, final-component symlinks and missing parent directories fail before the first APDU. Keep both files in a private directory with trusted parent directories: exclusive creation does not protect against another process that can rename or remove directory entries. Account export continues to create only its requested public-account file.

Signing writes and syncs a `pearl-cli-signing-uncertain` record containing the exact canonical intent in the sidecar before contacting the signer, then writes the same initial record to the primary output. The sidecar is never truncated, replaced or automatically deleted, including after successful signing. It contains no signatures, cannot prove whether signing or broadcast occurred, and is not a replacement for the companion's payment journal/reservations. It does not prevent another payment through a different output path, program or computer. Retain it for reconciliation; do not remove it to bypass the collision guard or select new inputs merely because the CLI did not finish.

The complete verified signed transaction replaces only the primary file descriptor created by this invocation. The file is written and synced in `onVerifiedSigned` **before** the final device continuation ACK. A lost final ACK returns a warning while retaining signed bytes; reconnect before later device operations and do not re-sign automatically. If disk/storage fails after valid signatures exist, stderr prints a clearly labeled recovery record containing the exact raw transaction and IDs, then exits unsuccessfully. Retain those bytes and reconcile before trying anything else. A failed or interrupted replacement can leave an empty or partial primary output; do not trust it without parsing/verification. The separate synced intent remains intact at the tested replacement boundary, but does not reconstruct lost signatures. A killed process cannot emit the stderr fallback. Filesystem crash guarantees depend on the OS/storage; directory fsync is used on non-Windows platforms, and these checks do not qualify every power-loss scenario.

External P2TR and P2MR recipients are supported by the new adapter; owned inputs/change remain ordinary BIP86 P2TR. The legacy SDK client still rejects P2MR before transmitting an APDU. There is no seed entry, private-key import, arbitrary-message signing, automatic approval, automatic retry or broadcast command.

Run the CLI boundary tests with `npm run test --workspace @pearl-ledger/cli`. They cover exact capabilities, frozen independent protocol commitments, private/exclusive file creation, no-overwrite/symlink/path failures before device contact, durable signed bytes before final ACK and retained bytes after acknowledgement failure. The intent regressions additionally exercise a real temporary filesystem, injected signed-write failure, and process termination immediately after primary-output truncation. They verify preserved sidecar intent and no final ACK before successful signed persistence. These are public-fixture transport mocks, not physical-device or storage-hardware evidence.
