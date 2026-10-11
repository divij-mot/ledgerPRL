# Pearl 0.1.1 Bluetooth preparation

This change enables the official Ledger SDK BLE APDU transport on Nano X, Stax, Flex and Nano Gen5. Nano S Plus remains USB-only. No new signing protocol, derivation path, recipient rule, key handling or transaction-review bypass was introduced. The two firmware source changes are the version/transport settings in `Makefile` and the transport-aware status check in `prl_review_io.c`.

The pinned [official Bitcoin Makefile](https://github.com/LedgerHQ/app-bitcoin/blob/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a/Makefile) enables Bluetooth and settings permission. The pinned [SDK standard-app rules](https://github.com/LedgerHQ/ledger-secure-sdk/blob/6709cd2bdfebb224ee070f7c1211b54254262579/Makefile.standard_app) conditionally enable BLE APDU and `BOLOS_SETTINGS` on the four BLE-capable targets. That permission permits settings writes generally; it is not a narrowly BLE-only privilege. The compiled flags are **0x240** for those four models and **0x40** for Nano S Plus. No library, master-seed or NFC permission was added.

## Review-session behavior

The SDK records the accepted APDU's medium. For a BLE review, a well-formed status event now requires `BLE_ON` instead of USB power, allowing operation on battery. A USB review still requires `USB_POWERED`, even if Bluetooth is on. Complete nested APDUs, malformed events, pairing changes during review, negative receive results, PIN lock and the existing review/whole-command deadlines still abort the application.

Normal pairing before an app command uses the SDK's existing pairing UI. During an active review, only the existing redisplay ITC event is accepted; a pairing mutation must not replace the transaction review.

**Bluetooth radio on is not proof of a live connection.** The SDK's BLE disconnect handler clears link state and restarts advertising; the reviewed API does not guarantee a separate application-visible event for every phone link loss. Therefore this change does not promise immediate review cancellation after a phone cancellation or disconnect. Reject the old review on the Ledger before reconnecting. Lock/rejection/review expiry remain protections; a pending review can last up to its 120-second budget. This is the standard SDK transport, not a custom Bluetooth stack or a claimed physical link-loss test.

## Results

| Check | Result |
| --- | --- |
| Mainnet builds | All five models passed with unchanged pinned SDK |
| Actual ELF version/API/permissions | Pearl 0.1.1 / API 27; Nano S Plus 0x40, others 0x240 |
| Account export, Receive approval, two-input P2TR signing | All five actual firmware images passed Speculos; signatures independently verified |
| Hostile inputs | All 75 cases rejected by the 0.1.1 Nano S Plus regtest image |
| Explicit rejection then fresh approval | Passed on the 0.1.1 regtest image |
| Synthetic C review events, BLE build | 83,446 cases passed under ASan/UBSan |
| Synthetic C review events, USB-only build | 83,446 cases passed under ASan/UBSan |
| New installer boundary tests | 10 passed; all USB-loader calls mocked |
| New Gen5 installer, actual default build-only run | Passed exact source/image hashes, ELF metadata, target/API/permissions and linker sizes |
| Physical installation / BLE radio / iPhone pairing | **Not performed** |

Speculos 0.27.1 exposes HID/U2F/NFC transports, not BLE. Its five positive replays here use HID with the BLE-enabled binaries; this is not evidence of Bluetooth pairing, radio exchange, reconnect behavior or mobile WebView operation. The C tests use deterministic syscall/UI stubs and the actual production guard plus its unchanged deadline helper. They cover all media/status combinations, malformed lengths, nested packet types, pairing ITC values, receive failure, lock and deadline boundaries; they do not simulate the closed device OS radio service.

All emulation uses the public vector-one test seed. No real account, hardware, mainnet broadcast, firmware installation, seed change, OS update or app deletion occurred. Old 0.1.0 images and checkpoint files were preserved; the earlier Nano S Plus physical observations still apply only to that older version.

## Installation tooling

`python3 scripts/install-pearl.py gen5` builds only. Adding `--install` explicitly invokes the standard ledgerblue 0.1.58 USB loader after verification. `flex`, `stax` and `nano-s-plus` select their own targets. `nano-x --install` stops before downloads or device access because ordinary retail Nano X sideloading is unavailable.

The orchestrator reuses the existing build/provenance scripts and metadata inspector. It makes a fresh isolated workspace, pins the SDK and official builder, keeps compilation offline, and checks each model against [release.json](../../apps/ledger-bitcoin-prl/release.json). It checks metadata and linker-derived installation sizes as well as ELF/HEX hashes, rechecks the image after preparing the loader environment, and never passes a delete flag. The metadata inspector's original 0.1.0 CLI defaults remain intact; optional explicit version/target/flags support the new release.

`installer-build-only.txt` is captured output with its host temporary path normalized. No ELF/HEX is included here or published. Model build manifests, metadata, screen text and public-fixture pilot results are in the named subdirectories. `result.json` summarizes this run; `reviewed-source.json` binds source and evidence hashes. The source set is `258d2c41d1d36646855b5397f601b111dfd4061ad9111a43d5f5b0f73dd06c8d`.
