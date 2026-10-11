# Nano S Plus physical checkpoint

On 10 October 2026, the owner approved installing and testing Pearl Dev on their no-balance Nano S Plus. Ledger Wallet reported OS 1.7.0, matching API 27. The exact emulator-tested mainnet build was installed using pinned ledgerblue 0.1.58, without deletion, firmware update, seed initialization/reset or persistent CA enrollment. See [installation identity](installation.json).

## Results

- The real Ledger Wallet Live App connection exported the public account after on-device approval.
- Receive displayed the address on the physical device, independently matched the returned address, and enabled Copy only after approval.
- The isolated HID pilot repeated account/address verification and signed a synthetic transaction with a cryptographically random nonexistent input, 1 PRL to the same account, 1 PRL change and 0.00001000 PRL fee. Signatures and finalized bytes were independently verified. Signed bytes were privately persisted, synced and read back before the final protocol acknowledgment.
- No completion warning, network broadcast or fund movement occurred. [Redacted result and test-source hashes](result.json) contain no public account, address or signed-transaction bytes. Those artifacts remain in a private temporary directory with mode 0700 and files mode 0600.

## Integration fix found on hardware

The first host attempt requested `device.transport({})`, which Ledger Wallet 4.23 treats as BOLOS/dashboard. The device therefore returned 0x6e01 to the subsequent Pearl command. The adapter now requests the exact selected-network app name, e.g. `Pearl Dev`, and keeps its independent PRL network/capability checks. The repeated physical host test passed. No currency alias, catalog override or permission expansion was needed.

## Scope

This is a bounded smoke test on one Nano S Plus, not full release qualification. Physical P2MR display, fault/rejection matrices and other models remain untested; emulator evidence is separate. Both public indexers timed out before address queries in the latest live-source checks. Real-chain discovery, funded sending, relay and confirmation remain unverified. The Git reference in the result is the checkout base; explicit source hashes identify the locally modified test runner.
