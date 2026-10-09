# Ledger Bitcoin-based PRL integration

Status: implementation in progress. This branch is not qualified for valuable funds.

## Objective

A usable native PRL hardware wallet is the goal. Reusing Ledger's Bitcoin application reduces newly written signing machinery, but Pearl compatibility takes precedence over retaining incompatible Bitcoin assumptions. No security equivalence, vendor approval, physical-device qualification or broad website compatibility is implied.

The previous Rust device app and its evidence remain available as a reference. Its test results do not qualify this different device application or the new host protocol.

## Planned components

- A pinned, release-tagged Ledger Bitcoin application baseline, preserving its PSBT/Merkle parsing, device review and signing machinery where compatible.
- Explicit PRL network, address, derivation and monetary policy. Amounts remain exact integer grains; aggregate totals and fee arithmetic must remain safe through the PRL maximum of 2.1e18 grains.
- A narrowly adapted upstream Ledger Bitcoin host protocol with auditable provenance and exact-integer PSBT support.
- An optional seedless MetaMask Snap and explicit PRL website-provider interface. A separate local companion handles hardware transport. No software private-key derivation or recovery-phrase entry is introduced.

## Integration boundaries

MetaMask's non-EVM Snap APIs provide an extension route, not automatic native account integration or compatibility with every website. Sites must implement the documented PRL methods. The Snap sandbox does not expose WebHID, so the hardware transport boundary remains a separate component. Production Snap allowlisting and Ledger app distribution are separate external gates.

This iteration supports ordinary classical BIP86/Taproot key-path PRL custody. XMSS, arbitrary scripts, multisignature and unrestricted message signing are not implicitly supported by borrowing a broader Bitcoin application.

## Required verification

1. Record exact upstream source and dependency pins, retain licenses, and make the PRL diff reviewable.
2. Test actual native signatures against the Pearl script engine on each supported network. Cover amounts around 2^53 and maximum monetary values, input/output sum overflow, fees, change and derivation boundaries.
3. Verify exact on-device recipient, amount and fee presentation, rejection paths, malformed PSBT/Merkle inputs, unexpected signing modes, and cancellation/disconnection.
4. Preserve host immutable-transaction checks, signature verification, pending-signature reservations, recovery, chain-view validation and exact-integer arithmetic.
5. Test Snap origin/account authorization, permission limits, replay/concurrency/restarts and the real external-signing path. Mock unit tests alone do not establish MetaMask or physical Ledger interoperability.
6. Independently review changed security-critical code. Record passed, failed and unrun checks separately, with the exact tested source/artifact identity.

A release decision requires actual physical-device and loaded-browser qualification, independent human review, and the applicable distribution approvals. More automated tests do not substitute for these gates.
