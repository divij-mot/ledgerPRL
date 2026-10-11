# Gen5 freeze and reported factory-reset incident

**Unresolved. Hardware use, installation and release promotion are paused.** The owner recalled a QR or similar Receive screen on Gen5, Pearl displaying “Disconnected,” the Close control not responding, and a welcome/new-device screen after holding the side button. The app’s disconnected indication does not establish physical BLE loss or whether it preceded the device failure. The owner subsequently reported restoring the wallet from the existing backup; apps were absent. No recovery secret was requested or collected.

The event itself was not captured by tools. [record.json](record.json) separates the owner’s report, previously verified image identity, containment actions and open questions. The prior successful USB/BLE account and Receive checks remain observations of those operations; they do not qualify QR/disconnect/restart behavior or establish release safety.

Read-only source inspection found unqualified QR rendering and power-button handling paths. They are investigation leads, not a confirmed cause. No direct app reset/seed-erasure reference has been found so far; absence of such a call does not exclude an indirect SDK/OS failure or protective reset. Do not apply another speculative firmware change or ask the owner to reproduce this on a real device.

PR #5 was stopped before merging and returned to draft. No further device commands or installations will be performed during this investigation. Existing source, qualified images, diagnostics and metadata-only test records are preserved. Any vendor report must omit recovery words, PINs, account keys and wallet data. No report has been sent to Ledger; the owner previously chose to handle contact themselves.

## Possible Protection mode

The owner initially wondered about Protection mode, then clarified that the device did not actually display it. This incident must not be classified as Protection mode. Ledger’s [official E6 guide](https://support.ledger.com/article/8632894981149-zd), read in its rendered English page, says the mode can follow events interpreted as attacks, including false positives, and resets the device when progress reaches 100%. That documentation is background only; it does not establish the mode or cause in this incident, or show that Pearl is unrelated.

## Isolated simulator investigation

The exact preserved 0.1.4 Gen5 ELF was tested in a network-isolated Speculos container using only a public deterministic fixture. No hardware was attached, no signature was requested, and nothing was broadcast. [Baseline results](baseline-simulator.json) and [provenance](baseline-provenance.json) distinguish the cases:

- Opening the QR, closing it and cancelling verification worked. Close restored the preceding address screen pixel for pixel; rejection returned `6985`.
- A synthetic host waiter timeout and a separate TCP socket closure also left QR Close responsive. Neither reproduces a retail Bluetooth disconnection or the installed mobile host's timeout implementation.
- Injecting an empty synthetic power-button event (`0x1B`) during QR review caused Pearl to call SDK app exit. The pinned SDK handles this event as normal OS UX, but Pearl's review allowlist rejected it. The actual event payload and delivery on the owner's device are unknown.

The last case establishes an app event-handling defect. It does **not** reproduce the reported freeze, erase device state or explain the factory reset. Speculos cannot qualify the closed retail OS's reset/protection behavior. A correction to that event handling must not be presented as a confirmed reset fix.

The hosted transport audit also found that a host timeout or cancellation may close a logical connection while the device's review remains open. `device.close` is not an address rejection or QR-dismissal command. The app's disconnected indication alone cannot identify what happened on the device.

## Unreleased correction

`prl_review_io.c` now forwards the SDK's power-button event through the existing bounded OS-UX path. The production change is one case label. No event payload length is invented, and the PIN, review/command deadlines, pairing policy, nested-command rejection and approval checks remain unchanged. [Independent source review](independent-source-review.md) records the upstream comparison and limits.

The version label and `release.json` deliberately remain unchanged. This is an investigation build, not a replacement release. The existing installer rejects its changed source against the published manifest; that check was exercised without opening a device. All 12 installer unit tests also pass. The README no longer recommends continued use of an older version while the hardware incident is unresolved.

## Candidate validation

[Candidate evidence](candidate-evidence.json) binds the tested images, SDK sources, harness revisions and outcomes. [Simulator instructions](simulator.md) reproduce the isolated checks. The [final independent review](final-review.md) verifies the source and result bindings and records the remaining limits.

- Eight Gen5 scenarios passed: ordinary QR Close/Cancel; synthetic host timeout; TCP closure; synthetic power event; natural QR-review expiry; Close and host timeout about 105 seconds into review; and a fresh emulator instance after the expiry cases. The power event no longer exits the app: Close restores the original pixels and Cancel returns `6985`.
- Two host-timeout cases were rerun with an additional raw-response assertion. Cancel returned only `6985`; the expiry case received no post-QR response and exited normally after about 125 seconds. Neither received a late success (`9000`). The original eight-case run predates that strengthened assertion and is identified separately.
- Five model builds and the established public-fixture account/Receive/signing pilots passed, with two verified synthetic input signatures per model. Four ASan/UBSan guard configurations passed (91,992 checks each for BLE, legacy and swipe; 91,983 for USB). These are simulator/stub results, not physical qualification.

The timed actions at about 105 seconds do not exhaust final-tick approval races. Exact deadline guards also have stub tests; neither those tests nor a fresh emulator process establishes retail recovery behavior. No physical device was accessed and nothing was broadcast.

**The reported factory reset remains unexplained.** The corrected event-dispatch defect is not a demonstrated cause of it. Hardware installation/use and release promotion remain paused. Resolving the remaining incident needs evidence about the retail SDK/OS failure path; simulator success alone cannot close it. The incident facts and exact artifact identities are ready for a Ledger investigation, but no third-party report has been sent.

## Subsequent Bitcoin parity checks

The [follow-up comparison](../bitcoin-fault-parity/README.md) adds SDK-style busy rejection without replacing the active review, same-process cancellation/review tests, and desktop USB cleanup fixes. Its newer source/binary hashes and test limits are separate from the power-event candidate above. The reported physical reset remains unresolved.
