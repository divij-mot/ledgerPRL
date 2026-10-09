# Release and Ledger submission checklist

This is a preparation checklist. Nothing has been submitted to Ledger, accepted on the owner's behalf, installed on a physical device, or made available in My Ledger.

- [ ] Select project license; preserve all dependency and upstream notices
- [ ] Freeze source, SDK/toolchain/OS versions and dependency lockfiles
- [ ] Build current stable-OS matched Nano S Plus, Nano X, Stax, Flex and Nano Gen5 variants
- [ ] Verify mainnet and every supported test-network derivation/load-permission variant
- [ ] Run native Speculos full address/account/signing/rejection/lifecycle tests per target
- [ ] Reproduce signing vectors and actual local Pearl acceptance/confirmation/reorg tests
- [ ] Verify UI on each physical model: full address, exact PRL amount, fee, change, warnings and cancel
- [ ] Measure worst-case RAM, stack, heap, code size, review duration and 16-input signing latency
- [ ] Test disconnect, lock, timeout, interruption, malformed APDUs and repeated button/touch events
- [ ] Perform independent human security audit and resolve findings
- [ ] Arrange Ledger functional review and confirm current submission requirements
- [ ] Prepare source, CI results, icons, support/contact details, tutorial, companion and physical-device video
- [ ] Document installation and recovery without resetting existing seeds
- [ ] Decide and authorize any external submission, publishing, agreement acceptance or physical installation separately

Public distribution must not describe this app as Ledger-approved, audited, quantum-safe or equal in security to the Bitcoin app merely because it uses Ledger cryptographic primitives or passes software tests.
