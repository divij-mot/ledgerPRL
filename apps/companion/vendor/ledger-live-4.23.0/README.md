# Ledger Wallet Bitcoin flow views

Pinned upstream: `LedgerHQ/ledger-live`, release `@ledgerhq/live-desktop@4.23.0`, commit `abed962b08ca4b746f20192b28ce5b6c06a6c6a4`. The unchanged originals and MIT license are retained here. These are adapted views, not an unmodified Ledger Wallet application.

The Bitcoin family uses the shared desktop Send and Receive steps. Pearl reuses their step status logic, modal header/content/footer structure, account/recipient and amount sections, summary rows, and receive-address segmentation. `provenance.json` records every source and executable adaptation by SHA256. `adaptation.patch` is the complete, reviewable change from each original to its PRL view.

Host Redux, account bridges, analytics, translations and Electron clipboard dependencies become explicit PRL display props and the existing browser handler IDs. Amounts remain exact decimal strings. The single selected Pearl account replaces the host account selector; tokens, fiat conversion, memo fields, contacts, unsupported fee estimators and marketing flows are omitted. Styled-component rules are extracted into scoped static CSS; native HTML dialog supplies focus trapping and Escape handling without weakening CSP. Status and emergency recovery controls are rendered inside the dialog.

The original `GenericStepConnectDevice` automatically broadcasts after signing and is deliberately **not** imported. Existing PRL input checks, atomic reservations, verified signature persistence, ambiguous-operation recovery, and separate explicit broadcast approval remain in `main.ts`. Signed means “Ready to send”; node acceptance means “Submitted”, not confirmed. Copy stays disabled until the current address is verified on the connected device.

## Reproduce the adaptations

From `apps/companion`, create an empty temporary directory. For each `sources` entry in `provenance.json`, copy `vendor/ledger-live-4.23.0/<original>` to `<temporary>/<adapted>`, preserving directories. Then run:

```sh
patch -p1 -d <temporary> < vendor/ledger-live-4.23.0/adaptation.patch
```

The resulting files must match every `adaptedSha256` and `derivedFiles[].sha256`. Supporting originals capture additional modal and button style declarations; they are not shipped as executable JavaScript.
