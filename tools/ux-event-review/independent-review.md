# Independent review

An independent Astra reviewer inspected the exact 0.1.4 guard diff and consolidated regression design. No actionable issue was found. Reviewed guard SHA-256: `aaee596683296b4c4b19c6a0c240929c79e137008d4a02a0d9e72e25be8b518d`.

The three known opaque UX event bodies are forwarded only after unchanged packet, complete-envelope and copy bounds. Button events require one byte and a valid mask; finger events require five bytes (eight with hardware swipe) and a valid state. The ITC allowlist, nested-command abort, PIN/deadline checks and SDK-owned exit remain intact. The SDK does not establish transport liveness through these status payloads; no universal native disconnect-cancellation guarantee is claimed.

All four retained sanitizer records match this source hash: 90,454 cases for BLE, legacy and hardware-swipe variants; 90,445 USB cases. A focused old-version failure uses the captured ten-byte status framing with explicitly synthetic data. The reviewer checked source/result bindings but did not independently execute these runs. A separate reviewer runs the actual Gen5 SDK/UI event replay; physical qualification remains separate from both.
