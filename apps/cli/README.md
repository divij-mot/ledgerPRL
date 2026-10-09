# Pearl Ledger development CLI

Run from the repository root after `npm ci`:

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

Output files are created exclusively with permissions `0600`; existing files are never overwritten. Signed output contains raw transaction hex, txid/wtxid, exact witnesses and vsize. These are sensitive transaction details even though no seed exists in the host.

The CLI intentionally has no broadcast operation. Review the exported transaction and independently confirm node/network before invoking your node's explicit `sendrawtransaction` action. Native mainnet use, physical-device approval UX and complete emulator integration remain release gates.
