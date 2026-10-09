# Security status and boundaries

This project is development software. It has not passed an independent human audit, Ledger functional/security review, or physical-device validation. Do not put valuable funds on development accounts. Test success does not establish security parity with Ledger's Bitcoin application.

## Custody model

- The Ledger derives PRL keys from its existing securely initialized seed. The companion never asks for recovery words, exports private keys, unlocks a hot wallet, or signs in software.
- The native app validates a complete bounded canonical transaction, independently derives all owned inputs/change, computes BIP341 digests, and requires trusted on-device review.
- The native signing primitive is the Ledger SDK's secp256k1 BIP340 implementation. Rust code adds Pearl-specific transaction policy, byte serialization, UI and transport handling; these custom surfaces require review.
- Device permission metadata restricts derivation to purpose 86 and the selected coin type. Network-specific binaries, account/path validation and clear network labels provide context. Pearl's ordinary transaction digest has no additional chain identifier.
- Only no-script BIP86 P2TR owned inputs/change and SIGHASH_DEFAULT are supported. No annex, script-path signing, external inputs, arbitrary digest/message signing, nondefault sighash, or blind-sign fallback exists.
- This is conventional elliptic-curve custody, not post-quantum custody. XMSS/state restoration and P2MR spending are outside this version.

## Host and backend trust

The local companion is watch-only. A node or public indexer learns queried public addresses and can censor, omit or lie about history, spendability, confirmations or fees. Exact raw-transaction parsing and script/txid checks detect important inconsistencies but do not independently validate chain consensus. The Ledger verifies what is being signed; it does not authenticate a live blockchain view.

Use the explicit privacy consent before public indexing. Public services are fixed allowlisted HTTPS endpoints, not a generic proxy. Node credentials stay in the local bridge process and are never sent to the frontend or public indexer. Loopback binding, exact Origin/Host checks, bounded requests, explicit methods, redirect rejection and separate broadcast confirmation reduce web-to-local attacks. A compromised local machine can still interfere with the companion; always verify every device screen.

## Sessions and recovery

Complete transfer, checked hash, canonical parse and ownership checks precede review. Approval authorizes only immutable validated data. Error, cancellation, transport fault, lock, timeout and app exit must invalidate the session. An interrupted host/device connection is never treated as proof that a signature was not produced. Signed or uncertain UTXO reservations must be reconciled with chain state before reuse. Reopening an app and restoring a watch-only backup does not authorize a transaction.

## Reporting

Until a public security contact is designated, report potential vulnerabilities privately to the repository owner. Do not post recovery material, device secrets, RPC credentials or exploit details publicly. Document an issue's affected commit, reproducible public test case, impact, expected behavior and actual behavior.

## Release gates

See docs/implementation-status.md, docs/test-evidence.md and docs/firmware.md. Source-bound builds, emulator happy/adversarial workflows, instrumented app-memory measurements and canonical-path package reproduction have passed at the recorded checkpoints. Remaining gates include actual supported-device/retail-OS compatibility, physical screens/signing/restore and resource measurements, complete loaded-browser/IndexedDB flows, independent human and dependency review, Ledger vendor review, a production builder/distribution process and a selected project license. Software results and registry advisory scans do not establish these gates.
