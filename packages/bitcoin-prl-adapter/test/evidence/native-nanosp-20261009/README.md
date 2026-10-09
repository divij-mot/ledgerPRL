# Native Nano S Plus positive matrix, 2026-10-09

Real compiled app-bitcoin PRL fork in pinned Speculos 0.27.1, using only published BIP32 vector-one test seed. No firmware syscall mocking, physical hardware, live transaction or funds. Tested ELF SHA-256:

`811185a5132614f424207640c6fb308dbaaa4b9a85a796acc7c8fac81db5785a`

`test/native-integration.mjs` produced these records and used `onVerifiedSigned` to persist each complete transaction before its final continuation ACK.

Passed cases:

1. Two ordinary P2TR inputs, P2MR external recipient and independently verified BIP86 change. UI showed network, `Recipient type | P2MR`, account, amount, complete address, change amount/address/path and fee.
2. One input of exactly **2,100,000,000,000,000,000 grains**, recipient of **2,099,999,999,999,999,000 grains**, 1,000-grain fee. Secure-app UI showed `20999999999.99999 PRL`; no Number rounding.
3. One-PRL input, 1,000-grain recipient, **99,999,000-grain fee**. UI explicitly showed the high-fee warning and `0.99999 PRL` fee before the approval gesture.

All four native signatures were independently verified by the host. Each `*-oracle.json` was then passed through `tools/pearl-oracle` with pinned Pearl `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`, Go 1.26.6, `GOPROXY=off`, and readonly modules. All three passed BIP341 digest, BIP340 signature, actual Pearl script-engine execution, BIP86 script/account/address, txid and wtxid checks.

`build-manifest.json` preserves the matching source-bound candidate manifest (its ELF hash was checked against the tested snapshot). `result.json` identifies the tested ELF and transaction IDs; `screens.json` contains the captured native UI text/events. `SHA256SUMS` identifies these retained JSON files. Original screenshot images and exact ELF snapshot remain in the qualification workspace; this compact record does not claim to be a full standalone firmware reproduction archive. Native source changes after this ELF require a fresh run. These tests do not establish Ledger approval, audit, physical-device qualification, mainnet payment acceptance or P2MR ownership/XMSS signing.
