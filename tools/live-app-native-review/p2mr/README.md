# Positive P2MR-recipient replay

Both Nano S Plus networks passed using the original ELF hashes from the parent checkpoint, without rebuilding or modifying firmware. Only the external recipient script changed to `52 20` followed by the fixed public 32-byte all-FF root. The owned inputs and change remain BIP86/P2TR. The existing client independently verified both signatures and the finalized transaction bytes.

The pilot additionally reconstructed the entire displayed destination from native screen text and asserted its equality with the expected `prl1z`/`rprl1z` address. It checked the explicit P2MR recipient label and parsed the displayed amount and fee back into exact grains. The recorded results include those reviewed values; selected original screenshots retain recipient, amount, fee and final approval.

- [Mainnet result](mainnet/result.json), [screens](mainnet/screens.json).
- [Regtest result](regtest/result.json), [screens](regtest/screens.json).
- [Executed harness](native-pilot.ts), [separate input hashes](test-source-hashes.json). The parent checkpoint's earlier P2TR hashes remain unchanged.

Replay the parent checkpoint's isolated container commands with `PEARL_TEST_RECIPIENT=p2mr`, the matching `PEARL_TEST_NETWORK`, original ELF and fresh evidence directory. Omitting the recipient flag retains the P2TR pilot. Native harness typecheck passed. No external network, node, broadcast or physical device was involved; this is recipient-payment coverage, not P2MR custody or XMSS signing.
