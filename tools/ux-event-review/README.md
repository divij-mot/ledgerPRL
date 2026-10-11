# Pearl 0.1.4 SDK event compatibility review

**Qualification withdrawn pending incident investigation:** later Gen5 QR/disconnect use was followed by a reported freeze/reset. Earlier successful operations below do not establish safety. See [incident record](../gen5-reset-incident/README.md).

The physical Gen5 0.1.3 diagnostic stopped on a complete STATUS event: `M1 P01 T15 H2 N14 L10`, stop `0D`, exception `0`. Its ten payload bytes were **not captured**. The displayed zero status field was unused; it does not establish USB power loss or any flag value. `status-analysis.json` records this framing and the pinned SDK source hashes.

The API27 SDK treats ticker, display-processed and status payloads as opaque OS UX data. Pearl now forwards these known events after checking the outer packet type, complete declared envelope and destination buffer bounds. Button events require the byte the SDK reads and a valid mask; finger events require five bytes (eight with hardware swipe) and a valid state. Irrelevant suffixes do not define approval or elapsed time. Unknown tags and non-allowlisted ITCs still abort. Nested commands, receive errors, PIN invalidation and command/review deadlines retain their abort behavior, including checks after SDK callbacks.

This removes Pearl's unsupported USB-power heuristic. The SDK consumes transport reset/disconnect events internally, so there is no guarantee that disconnecting USB/BLE or cancelling a browser request immediately closes device review. Reject or close an old review; do not approve it after reconnecting.

## Evidence

- `before-status.json`: the shared focused test fails against preserved 0.1.3 on the captured STATUS framing with a **synthetic zero payload**.
- `after-status.json`: that focused case passes on 0.1.4, with approval still pending.
- `after-{ble,usb,legacy,swipe}.json`: reused `../ble-exit-review/review-heartbeat.{c,py}` exercises every bounded opaque payload length, synthetic zero/high/mixed bytes, short gesture payload rejection, explicit gesture approval/rejection, buffer limits, nested commands, pairing policy, PIN and deadlines under ASan/UBSan. These are syscall/UI-stub boundary tests, not real-device qualification.
- `results.json`: per-model tested ELF and public-fixture result fingerprints, plus actual-SDK event replay and hostile-command outcomes. Full build/loader metadata is kept only in `../../apps/ledger-bitcoin-prl/release.json`.
- `reviewed-source.json`: exact production, test and evidence hashes. [Independent review](independent-review.md) records the separate source audit.

All builds use the pinned SDK and cached official builder without network or hardware access. Speculos fixtures use a public deterministic seed and fabricated transactions; nothing is broadcast. The historical 0.1.3 ticker evidence remains in `../ticker-review`. The emulator checks do not themselves establish physical or BLE-radio success. Subsequent [hardware verification](physical-verification.json) records installed-image hash read-back on Gen5 and Nano S Plus, successful USB public-account approval on both, and owner-confirmed Gen5/iPhone Bluetooth account approval, matching Receive verification, and normal app exit. No funded payment was requested.

The owner also confirmed the phone manifest survives restarting Ledger Wallet after reimporting the separate mobile file. The restored desktop wallet completed automatic mainnet sync and showed its network-available indicator; no balances or transaction identifiers are retained in the verification report.
