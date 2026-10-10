# Install the renamed Pearl app

The prepared **Pearl 0.1.0** candidate is for **Nano S Plus, API 27**. The recorded
device runs Ledger OS 1.7.0. Do not use this image on another model or assume it
matches another OS. The [identity checkpoint](../tools/pearl-name-review/README.md)
records the build and emulator tests.

Installation is still pending. It requires the owner to unlock the device and
approve the installation on its screen. It does not require a recovery phrase,
firmware update, reset or deletion of another app. The app is independently
built and is not Ledger-approved.

## Prepared files on the development Mac

- HEX: `.tools/firmware/pearl-nanos-plus-mainnet-0.1.0.hex`
- ELF: `.tools/firmware/pearl-nanos-plus-mainnet-0.1.0.elf`
- HEX SHA-256: `04c121196c75d71776921e78425d3b8b972d3921aa19acbac7d690c546e98174`
- ELF SHA-256: `0f58a289227ccd78a6e66735cb3b7db95f849b9890d454299e83ef15edbd3271`

These generated files are local and ignored by Git. A fresh checkout must build
the matching source using the pinned SDK/builder recipe; it must not substitute
an older binary. The account derivation is unchanged: `86'/808276'/0'`.
Existing receiving addresses remain tied to the same Ledger seed and account.

## Owner-present installation

Close Ledger Wallet to release USB, unlock the Nano S Plus and leave it on the
dashboard. With the verified **ledgerblue 0.1.58** environment, check the image
hash and use its standard loader:

```sh
python -m ledgerblue.loadApp \
  --targetId 0x33100004 --targetVersion '' --apiLevel 27 \
  --fileName .tools/firmware/pearl-nanos-plus-mainnet-0.1.0.hex \
  --appName Pearl --appFlags 0x40 --tlv \
  --dataSize 512 --installparamsSize 61
```

The sizes are specific to this exact image and were read from its linker map.
There is deliberately no delete option. Follow the device's installation
prompts and check that the app is **Pearl**, version **0.1.0**. Do not approve an
unexpected reset, firmware change or different app. Keeping the older Pearl Dev
app installed temporarily is harmless; the current companion requests Pearl.

Open Pearl on the device, reopen Ledger Wallet and select Pearl in Discover.
The local server should still be running with `npm start`. Reconnect the device
and compare a receiving address before the first outgoing payment. The previous
watch-only account, local chain cache and pending-payment journal remain local;
installing this image does not import or replace the Ledger seed.

Complete the small, owner-approved send and confirmation sequence in
[mainnet testing](mainnet-testing.md). Emulator signing and observed incoming
payments do not establish that final physical outgoing step.
