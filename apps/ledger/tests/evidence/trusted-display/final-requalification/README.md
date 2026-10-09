# Final-source trusted-display requalification

2026-10-09. The original bounded trusted-display/approval matrix was rerun on the definitive checked-RNG, lexical-key-scope release artifacts. This is **new-source requalification of existing coverage, not additional unique coverage**. Original and interim RNG-only evidence were kept separate; no display run was started on the rejected explicit-drop candidate.

## Result

All five models passed: Nano S Plus, Nano X, Stax, Flex and Nano Gen5. Mainnet and simnet were both exercised for the six baseline flows. Rejection/back/short-touch and amount/path/fee-boundary checks used simnet.

- Ten baseline model/network combinations, 60 flows
- All-five interaction results, 35 flows
- All-five boundary results, 30 flows
- **125 requalified flows, 400 exact rendered-field comparisons and 20 exact warning-detail comparisons**

No lost address/amount/fee/path suffix, changed display meaning or new approval bypass was found. Explicit native signing returned signatures verified by the host SDK. Rejection returned `6985` and denied subsequent signature retrieval with `6986`; touchscreen short touches did not approve. Cosmetic account-export “Hold to sign” wording is unchanged.

## Binding and limitations

The only changed file among the 409 native/SDK source files tracked by the original review is `apps/ledger/src/crypto.rs`:

- Original SHA-256: `e29384e20151aca794771c2026aa93ac710ad796ac6c44f0f1ca4ae3a378f563`
- Definitive SHA-256: `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`

The UI hash remains `427b379c7ded08666aed5e4f8f9430175a374bcbc06a5516c747780eb2dcf2c4`. Ten ELF/build-manifest pairs matched their declared model/network and every source hash before testing. Per-device locks protected immutable copying. Exact final ELF SHA-256 values are in `summary.json`. After testing, all 409 native/SDK files, 15 probe/helper/fixture files and ten immutable ELF snapshots matched their pre-run hashes.

The four retained TypeScript/Python probe files, host SDK helper files, Speculos driver and public fixture were unchanged from the original review. Official Speculos 0.27.1 used the same public BIP32 seed `000102030405060708090a0b0c0d0e0f`, no injector, fresh output directories and coordinated port pairs 5281/5282 through 5289/5290. This worker did not modify native source, SDK, tests or production files and did not build, commit, push or use hardware.

This matrix requalifies successful display/signing and user-approval semantics after the native changes. It does not itself establish private-key wipe behavior or RNG-error behavior; those are separate reviews. It is **not physical-screen/hardware/OS or installation qualification, or a formal external audit**. Testnet/testnet2/regtest builds are outside this particular ten-artifact matrix.

## Retained evidence and replay

`summary.json` contains ten final baseline summaries, all-five interaction/boundary results, exact source/ELF bindings, original/final probe and helper hashes, and fresh selected-capture comparisons. Use the unchanged probes and commands in the parent `README.md`, substituting a fresh `PEARL_DISPLAY_EVIDENCE` root and the definitive immutable `PEARL_APP_ELF` for each model/network. Do not rebuild over tested artifacts. The portable verifier was rerun against all fresh observations.

All 17 fresh representative PNG captures are byte-for-byte identical to the original retained PNGs. Their new filenames and hash comparisons are recorded in `summary.json`; `retainedScreenshot` links point to the existing files one directory above. A single additional PNG, `stax-high-fee-ceiling-retry.png`, records the corrected fee page described below. No ELF binaries or duplicate standard screenshots are included.

## Preserved capture retry

The first Stax high-fee-ceiling capture sequence went from page 2 to page 4 without recording its Fee page. The portable field verifier correctly rejected that incomplete sequence. The unchanged six-flow Stax boundary probe was repeated serially in a fresh directory using the same immutable ELF and fixture; it recorded page 3 and passed all exact checks. No source, probe, emulator or firmware modification was made. The first attempt remains preserved and is not used for the accepted Stax boundary display evidence.

Thus 131 operations ran in total: the 125-flow matrix plus six capture-recovery repeats. The accepted result remains the same 125 unique matrix flows, with zero additional unique coverage. `summary.json` records the precise accepted-evidence selection and the retry capture. This timing-sensitive capture gap is a test-driver reliability limitation, not a reason to count an unrecorded field as visible.
