# Trusted display review: exact release ELFs

Reviewed 2026-10-09. **No missing/truncated transaction value or approval bypass found in this review.** This is independent source inspection plus official Speculos 0.27.1 emulation, not physical-screen, hardware/OS, installation, vendor, or external-audit qualification. No production code or SDK was changed.

## Coverage and results

- All five models: Nano S Plus (`nanosp` emulator / `nanosplus` build), Nano X, Stax, Flex and Nano Gen5 (`apex_p`).
- Ten baseline combinations: all five models on mainnet and simnet. Six flows each: ordinary account export, receive address, maximum account export, maximum account/index address, extreme transfer amount with change, and extreme fee without change.
- Thirty-five interaction flows: seven per model on simnet. Account/address/transaction rejection and three warning rejection classes returned `6985`; subsequent signature fetch returned `6986`. Nano both-button presses on a recipient page did not approve. Nano back/forward preserved the field. Touchscreen rejection confirmation's “Go back to transaction” preserved the review. A 100 ms final touch did not approve. Explicit final approval produced a verified native signature.
- Thirty boundary flows: six per model on simnet. Combined maximum account/input/change paths and high fee required four distinct “Review anyway” approvals. Zero fee, one-grain recipient, maximum legal amount, high-fee ceiling and the deliberately exempt small-input-total case passed.
- **125 flows, 400 exact rendered-field comparisons and 20 exact warning-detail comparisons passed.** Assertions reconstruct drawing-event strings across lines and Nano subpages, remove only display whitespace, and compare each value to its field-specific expected value. Representative original PNGs were visually inspected for clipping and label/value association.

The baseline checked the full 63-character mainnet and 64-character simnet recipient, receive and change addresses, network, account, master fingerprint, privacy disclosure, BIP86 type, derivation/change path and amount/fee/change. Maximum account and index were `2147483647`. Extremes included `20999999999.99999998 PRL` amount, `20999999999.99999999 PRL` fee, `21000000000.00000000 PRL` maximum amount, `0.00000001 PRL` and `0.00000000 PRL`.

## Display semantics

- Nano addresses use two manually navigated pages. Every value byte remains visible; long *labels*, such as “Change address”, are abbreviated with ellipses while page numbers remain shown. Recipient and change remain distinct.
- Touchscreen transaction addresses fit completely in the ordinary review pages in these fixtures; no hidden “More” expansion was needed. Full account/index paths and values wrap rather than lose suffixes. Large amounts can wrap inside the decimal fraction. This preserves exactness but requires reading both lines.
- Warnings show the full account/input/change path. Nano may abbreviate the repeated warning heading on its detail page; the preceding warning title is fully shown. The extreme fee warning is paginated and complete.
- The source gates signing after successful review of an immutable validated transaction; UI rejection and a latched transport fault cannot become approval (`ui.rs:22–30`, `session.rs:234–251`). Review fields are device-derived, with no host-provided labels (`ui.rs:126–219`). `Amount::fmt` is bounded integer formatting, eight decimals and no floating point (`amount.rs:38–48`).
- High-fee warning policy is `input_total > 100000` grains and `fee >= ceil(input_total / 10)`. Consequently a 99,999-grain fee on 100,000 grains intentionally has no extra warning; the exact fee still appears in the review. Account warnings begin at 101; index warnings begin at 50,001. This review does not change those policy choices.
- The account screen shows network, hardened account path, master fingerprint and the watch-only privacy consequence. It does not display every exported account-public-key/chain-code byte. Standard input paths are not individually listed in transaction review; out-of-range input paths receive explicit warnings.

## Cosmetic standard-SDK wording

Account export clearly says “Export Pearl account”, “Watch-only public data” and “Approve export”, but its standard transaction-review wrapper labels the touchscreen gesture **“Hold to sign”**. Its rejection flow also uses transaction wording. No signing operation occurs during account export (`session.rs:162–184`).

Pinned secure SDK `nbgl_use_case.c:578` hardcodes the hold label. `TransactionType::Operation` does not change it. Standard `.light()` changes the button to “Approve” but replaces the hold gesture with a tap. `NbglGenericReview`'s `InfoLongPress` accepts custom wording; `NbglReviewExtended` also does so but is touchscreen-only. There is no dedicated account-export wrapper in the inspected Rust SDK. **Retain the frozen standard flow and document this cosmetic mismatch; do not patch the SDK or downgrade its gesture solely for wording.**

## Provenance and retained files

`summary.json` contains every tested ELF SHA-256, model/network, 10 baseline results, all 5 interaction reports, all 5 boundary reports, inspected source hashes and the selected screenshot hashes/captions. `baseline-screen-text.json` retains the complete baseline drawing-text sequence without hundreds of PNGs. `post-review-stability.json` confirms all 409 recorded native/SDK source files and all ten immutable ELF copies were unchanged after review.

Initial source snapshot commit: `87ca040566122a290c79a0a1fbd7590723b9da81`. Rust SDK base: `4123d2dc85a2085115e6a36826460a9fe742cfb1`; secure SDK: `6709cd2bdfebb224ee070f7c1211b54254262579`. The existing strict-transport patch remained in place. All ten build manifests matched their source files before execution. Artifacts were copied under the existing per-device build locks, then executed only through fresh immutable snapshots. Public BIP32 test seed: `000102030405060708090a0b0c0d0e0f`. No real seeds, funds, hardware, uploads, injector, rebuild or firmware modifications.

An initial launch found no QEMU in PATH and exited without app execution. Two early Gen5 interaction attempts overlapped queued gestures and failed harness expectations; the test driver was corrected to await gesture completion. The subsequent all-five interaction runs passed, without changing firmware. These failed attempts are not counted as passes.

The retained set is 17 original screenshots plus JSON/text summaries, about 200 KB; no ELF binaries are included.

## Reproduce

The three sibling `trusted-display-*.ts` probes use the existing `speculos-driver.ts` and SDK. Set `SPECULOS_BIN` and `SPECULOS_PYTHON` to the same official 0.27.1 installation, and ensure its official QEMU dependency is on PATH. Use existing release artifacts; do not rebuild merely to rerun this review. `PEARL_APP_ELF` can point at an immutable independently verified ELF; otherwise the per-model/network artifact path is used. `SPECULOS_API_PORT` can override ports (reserve its next port for APDU too).

From the repository root, choose a fresh evidence directory on a sufficiently large filesystem:

```sh
export PEARL_DISPLAY_EVIDENCE=/path/to/fresh/trusted-display-evidence
export SPECULOS_BIN=/path/to/speculos-0.27.1/bin/speculos
export SPECULOS_PYTHON=/path/to/speculos-0.27.1/bin/python
for model in nanosp nanox stax flex apex_p; do
  target="$model"; test "$model" != nanosp || target=nanosplus
  for network in simnet mainnet; do
    flock -s "apps/ledger/target/.build-$target.lock" \
      node --import tsx apps/ledger/tests/trusted-display-baseline.ts "$model" "$network"
  done
  flock -s "apps/ledger/target/.build-$target.lock" \
    node --import tsx apps/ledger/tests/trusted-display-interactions.ts "$model"
  flock -s "apps/ledger/target/.build-$target.lock" \
    node --import tsx apps/ledger/tests/trusted-display-boundaries.ts "$model"
done
python3 apps/ledger/tests/verify-trusted-display.py "$PEARL_DISPLAY_EVIDENCE"
node_modules/.bin/tsc -p apps/ledger/tests/tsconfig.json --noEmit
```

Boundary probes reuse the corresponding public maximum-account fixture emitted by the simnet baseline. Evidence destinations must be fresh; an existing snapshot is never overwritten. The original probes completed the runs above; integration copies only generalize repository/output paths and import locations, add TypeScript non-null assertions for fixed nonempty fixtures, and format the same test bodies. Their strict typecheck passed; the final portable rendered-field verifier was also rerun against all retained observations and passed.
