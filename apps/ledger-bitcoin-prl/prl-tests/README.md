# Native review lifecycle tests

`native-review-faults.ts` runs the actual firmware ELF, Ledger SDK and UI in
Speculos 0.27.1 with the published vector-one test seed. It reuses the existing
Wire transport and `Emulator` UI driver. It does not access physical hardware,
use a real account, patch firmware, or bypass approval.

The default model/network remain `nanosp` / `regtest`. `SPECULOS_NETWORK` selects
the account-export path and fixture network: mainnet uses coin type 808276;
other supported networks use 1. Mainnet test input/change scripts are derived
from the device-approved public fixture account. No software signing is added.

## SDK UX-event replay (0.1.4)

Run inside the existing Linux SDK/Speculos environment with Node 24 and the
workspace dependencies available. Use a frozen Gen5 ELF and a fresh evidence
directory; the driver refuses to overwrite an existing firmware snapshot.
The API port and the following TCP port must be free in that environment.

```sh
SPECULOS_MODEL=apex_p \
SPECULOS_NETWORK=mainnet \
PEARL_APP_ELF=/path/to/frozen/apex_p-mainnet/app.elf \
PEARL_EVIDENCE=/path/to/fresh/ux-event-evidence \
SPECULOS_API_PORT=5121 \
SPECULOS_INJECTOR="$PWD/apps/ledger/tests/speculos-injector.py" \
PRL_FAULT_CASE=account-empty-ticker,account-four-byte-ticker-zero,account-four-byte-ticker-high,account-four-byte-ticker-mixed,account-one-byte-ticker,account-four-byte-display,account-four-byte-status,account-ten-byte-status-zero,account-ten-byte-status-high,account-ten-byte-status-mixed,account-button-suffix,account-finger-suffix,account-empty-button,account-short-finger,account-unknown-event,account-malformed-apdu,account-nested-capabilities \
node --import tsx apps/ledger-bitcoin-prl/prl-tests/native-review-faults.ts
```

The existing injector passes numeric `RAW!` SEPH events into Speculos without
patching the tested ELF or SDK UI code. Automatic
tickers are paused while one event is injected during public-key review. Known SDK UX events must leave review open, return no account response before
touch, then allow normal explicit UI approval of the same account. Opaque
one/four-byte tickers, four-byte display and four/ten-byte STATUS payloads are
accepted; valid consumed button/finger fields may have suffixes. Short consumed
fields and unknown events must execute the native abort, with no successful
response or signature. APDUs arriving during review, including malformed ones,
receive the SDK busy status `6901` without replacing the original operation.
Some tests use synthetic busy-response demultiplexing to verify that original
commitment; this is not production-client reconnect behavior. See the
[Bitcoin fault comparison](../../../tools/bitcoin-fault-parity/README.md). The injector constructs
coherent SEPH envelopes; malformed outer-envelope lengths remain covered by the
separate native guard tests, not claimed by this replay.

Only the physical ticker (four-byte) and STATUS (ten-byte) **length/framing**
were captured. Zero, all-ones and mixed payloads are synthetic; the real bytes
are unknown. STATUS data is not a proven USB/BLE liveness signal.
This exercises real SDK/NBGL behavior in emulation, not actual device OS timing,
USB/BLE hardware or all events that caused the physical incident. Passing does
not qualify Gen5 or justify weakening another event guard.

## Retained regtest lifecycle selection

To replay the retained lifecycle cases against a regtest artifact, keep the
same command/environment but select `SPECULOS_MODEL=nanosp`,
`SPECULOS_NETWORK=regtest`, the matching frozen ELF, and:

```sh
PRL_FAULT_CASE=nested-capabilities-apdu,nested-sign-apdu,bolos-version-apdu,malformed-apdu,empty-button-event,invalid-button-mask,short-finger-event,invalid-finger-kind,empty-itc-event,unexpected-pairing-itc,real-review-timeout,absolute-command-deadline,deny-and-restart-cleanly
```

The former `usb-power-loss` case was a four-zero-byte STATUS event; it is now
a positive SDK-status case because those bytes do not establish disconnection.
The original 0.1.3 ticker/control results remain historical evidence.

Omitting `PRL_FAULT_CASE` runs the model-compatible cases, including UX cases that require
firmware with the 0.1.4 SDK-event alignment. Use a separate fresh
evidence directory for each run. `result.json`, firmware hashes, bounded logs
and captured public-fixture screens are written there. No Docker image, ELF,
compiled test bundle or duplicate driver is added to the repository.
