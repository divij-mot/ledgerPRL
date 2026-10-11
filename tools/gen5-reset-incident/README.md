# Gen5 freeze and reported factory-reset incident

**Unresolved. Hardware use, installation and release promotion are paused.** The owner reported a freeze while Pearl’s Receive QR screen was displayed after an iPhone disconnection, followed by a welcome/new-device screen after holding the side button. The owner subsequently reported restoring the wallet from the existing backup; apps were absent. No recovery secret was requested or collected.

The event itself was not captured by tools. [record.json](record.json) separates the owner’s report, previously verified image identity, containment actions and open questions. The prior successful USB/BLE account and Receive checks remain observations of those operations; they do not qualify QR/disconnect/restart behavior or establish release safety.

Read-only source inspection found unqualified QR rendering and power-button handling paths. They are investigation leads, not a confirmed cause. No direct app reset/seed-erasure reference has been found so far; absence of such a call does not exclude an indirect SDK/OS failure or protective reset. Do not apply another speculative firmware change or ask the owner to reproduce this on a real device.

PR #5 was stopped before merging and returned to draft. No further device commands or installations will be performed during this investigation. Existing source, qualified images, diagnostics and metadata-only test records are preserved. Any vendor report must omit recovery words, PINs, account keys and wallet data. No report has been sent to Ledger; the owner previously chose to handle contact themselves.

## Possible Protection mode

The owner initially wondered about Protection mode, then clarified that the device did not actually display it. This incident must not be classified as Protection mode. Ledger’s [official E6 guide](https://support.ledger.com/article/8632894981149-zd), read in its rendered English page, says the mode can follow events interpreted as attacks, including false positives, and resets the device when progress reaches 100%. That documentation is background only; it does not establish the mode or cause in this incident, or show that Pearl is unrelated.
