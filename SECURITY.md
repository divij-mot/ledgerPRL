# Security status and boundaries

This project is development software. It has not passed an independent human audit, Ledger functional/security review, or physical-device validation. Do not put valuable funds on development accounts. Test success does not establish security parity with Ledger's Bitcoin application.

## Custody model

- The Ledger derives PRL keys from its existing securely initialized seed. The companion never asks for recovery words, exports private keys, unlocks a hot wallet, or signs in software.
- The native app validates a complete bounded canonical transaction, independently derives all owned inputs/change, computes BIP341 digests, and requires trusted on-device review.
- The native signing primitive is the Ledger SDK's secp256k1 BIP340 implementation. The current device app adapts pinned Ledger Bitcoin 2.5.1 C code for PRL-specific network, monetary, path, address and lifecycle policy. The earlier Rust prototype is retained as historical reference. Borrowed upstream code does not transfer Ledger approval or security assurance to this port.
- Device permission metadata restricts derivation to purpose 86 and the selected coin type. Network-specific binaries, account/path validation and clear network labels provide context. Pearl's ordinary transaction digest has no additional chain identifier.
- Only no-script BIP86 P2TR owned inputs/change and SIGHASH_DEFAULT are supported. No annex, script-path signing, external inputs, arbitrary digest/message signing, nondefault sighash, or blind-sign fallback exists.
- This is conventional elliptic-curve custody, not post-quantum custody. XMSS/state restoration and P2MR spending are outside this version.

## Host and backend trust

The direct wallet website is watch-only until the Ledger approves a signature. A node or public indexer learns queried public addresses and can censor, omit or lie about history, spendability, confirmations or fees. Exact raw-transaction parsing and script/txid checks detect important inconsistencies but do not independently validate chain consensus. The Ledger verifies what is being signed; it does not authenticate a live blockchain view.

Use the explicit privacy consent before public indexing. Public services are fixed allowlisted HTTPS endpoints, not a generic proxy. Node credentials stay in the local bridge process and are never sent to the frontend or public indexer. Loopback binding, exact Origin/Host checks, bounded requests, explicit methods, redirect rejection and separate broadcast confirmation reduce web-to-local attacks. The hosted website keeps account derivation in the browser. Its proxy receives queried addresses/transaction IDs and submitted signed transactions, not account derivation keys. The hosting operator can link requests with client IP/timing; the public indexer normally sees the proxy IP. A compromised website, browser extension or local machine can still mislead the UI or request a harmful payment; always compare the full address, amount and fee on the Ledger. No host-side label replaces trusted-device review.

## Sessions and recovery

Complete transfer, checked hash, canonical parse and ownership checks precede review. Approval authorizes only immutable validated data. The host invalidates its session after cancellation or a transport/protocol fault. Closing WebHID does not necessarily notify a still-powered device: reject any remaining review and exit/reopen the Pearl app before reconnecting. Native deadlines, lock/power events and unexpected nested commands provide separately tested device-side boundaries. An interrupted host/device connection is never treated as proof that a signature was not produced. Signed or uncertain UTXO reservations must be reconciled with chain state before reuse. Reopening an app and restoring a watch-only backup does not authorize a transaction.

## Stored data

The intended wallet flow never requests, obtains or stores Ledger seed material or private signing keys. Public-only import schemas reject unexpected fields; selecting an unrelated secret-bearing file would still read its bytes before rejection, so users must never choose seed/key files. The browser intentionally keeps origin-scoped payment journals, reservations, exact signed bytes and receive/change recovery ranges. Full watch-account public-key/chain-code caching is optional. This is financially sensitive data even though it cannot create a new signature. Anyone with an already-signed transaction can broadcast that exact transaction; backup files must remain private. Clearing storage can erase interrupted-payment history, so it is never used as an automatic recovery shortcut. The chain can reconstruct confirmed history but cannot reveal a transaction it has never received.

## Reporting

Until a public security contact is designated, report potential vulnerabilities privately to the repository owner. Do not post recovery material, device secrets, RPC credentials or exploit details publicly. Document an issue's affected commit, reproducible public test case, impact, expected behavior and actual behavior.

## Release gates

Current native scope and evidence are in apps/ledger-bitcoin-prl/README.md and tools/bitcoin-prl-port/README.md. The older docs/firmware.md and native-release-qualification evidence describe the earlier Rust app; those results do not qualify the new C signer. Source-bound builds and emulator checks apply only to each recorded source and artifact identity. Remaining gates include actual supported-device/retail-OS compatibility, physical screens/signing/restore and resource measurements, complete loaded-browser/IndexedDB flows, independent human and dependency review, Ledger vendor review, a production builder/distribution process and a selected project license. Software results and registry advisory scans do not establish these gates.
