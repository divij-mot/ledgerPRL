# Native Bitcoin lifecycle comparison

The held change adopts Bitcoin's nested-command busy response while retaining the original device review. It does not identify the cause of the reported physical freeze/reset. Hardware and release remain halted; version and release manifest are unchanged.

## Pinned comparison

The reference is Ledger Bitcoin `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`, originally deployed against SDK26.6.2 (`22d1131…`). Pearl uses SDK27.1.2/API27 (`6709cd2…`). Exact files, URLs and hashes are in [source-comparison.json](source-comparison.json).

The selected SDK heartbeat, receive/transmit routines, standard event handler and exit/exception-wrapper function bodies are byte-identical across these two SDK commits. Bitcoin and Pearl's `app_main` bodies are also identical; command descriptors differ. Bitcoin's UI loop calls the standard heartbeat. Pearl adds its own guard around that event processing. Matching selected functions does not equate the entire SDKs or qualify the API27 retarget under Bitcoin's audit. Build features also differ, including Pearl's disabled Swap/library support; source-body equality is not compiled-binary equivalence.

| Boundary | Bitcoin / standard SDK | Held Pearl behavior |
| --- | --- | --- |
| Nested APDU during review | Reply `6901` using `os_io_tx_cmd`; retain original review | Same seven packet types and low-level busy reply; new command is never dispatched |
| Original command ownership | Direct low-level send leaves saved app media/reply state intact | No original APDU-buffer, media, dispatcher or consent-latch mutation; observable identity preservation tested |
| Invalid PIN during review | Heartbeat chooses `5515` for a nested reply; OS owns lock UI | Deliberate stronger policy: terminate before/after processing if PIN becomes invalid |
| Negative review receive/transmit return | Heartbeat does not terminate on negative receive and ignores send result | Deliberate stronger policy: SDK-owned terminal app exit on negative receive or busy-reply transmit failure |
| Review/whole-command deadline | Existing processing/interruption timeouts; no Pearl review budget | Retain 1200/3000 tick budgets and checks after busy transmission; nested commands do not restart them |
| Known UX / power / redisplay | SDK handles UI events | Existing bounded event handling retained; power event follows SDK UX handling; redisplay tested during account review |
| Other events / pairing changes | SDK event forwarding and transport policy | Bounded framing, known-tag and narrow ITC policy retained; new pairing/session mutations and unknown tags remain terminal |

`os_io_tx_cmd` returning zero is not universally a failure: the SDK's RAW/legacy paths can return nonnegative zero. Only negative returns trigger the extra error policy. `io_exchange` or `io_legacy_apdu_tx` must not send the busy reply because they release the original reply ownership. Private SDK reply-latch preservation is source-derived; simulator tests verify its observable consequences rather than instrumenting that private variable.

## Evidence scope

Focused tests use the existing `native-review-faults.ts`, public vector-one fixture and frozen ELF snapshots. Account/path and Receive/index replacement attempts must leave the original identity intact. A valid replacement transaction is rejected as busy; signatures obtained only after explicit approval must verify against the original transaction and fail against the replacement. Explicit rejection yields no signatures, and a fresh replacement operation requires new approval.

Some commitment tests deliberately route the known `6901` response away from the original test waiter. This is **synthetic host demultiplexing**, not normal production-client recovery. A separate unfiltered raw-protocol case observes `6901` ending its waiter while the device review remains open. It explicitly cancels the old device review and observes `6985` before starting another Verify. Neither busy status nor host cleanup acknowledgement is proof that the device review has been cancelled.

Same-process Verify tests start a different address index within the old cancellation-status interval, keep the new review pending beyond that status timer, and require a new explicit approval. They use the same emulator process and wire; they do not prove production HID-close/reopen behavior.

Negative TX, PIN changes and all packet/media combinations use the shared syscall-stubbed ASan/UBSan guard tests. They are not physical USB/BLE failures. Speculos uses SDK/UI code with an emulated platform; retail radio, OS protection/reset and every possible OS event remain outside this evidence. Tick deadlines are not a universal wall-clock guarantee under arbitrary scheduling or flooding.

## Error/exit clarification

Builds explicitly use `DEBUG=0 DEBUG_OVER_USB=0`. The SDK enables `HAVE_DEBUG_THROWS` through debug printing; it is not enabled here. The tested Gen5 image has no diagnostic trace wrapper or debug-assert exit display. The SDK's historical Nano X freeze comment describes its debug-exception display path, not ordinary `app_exit`, and is not evidence of this incident's cause.

No full upstream firmware build was needed to establish these selected source differences: the pinned function bodies are available and identical, and the changed Pearl behavior is exercised on its actual SDK/ELFs. This is not a claim that a retail Bitcoin application was simulated or physically tested.

An initial Gen5 setup attempt reused an older fixture helper with fixed regtest coin type1. Mainnet firmware rejected it with `6a82` before any fault injection. That failed setup is preserved locally. Final targeted results use the current network-aware helper and bind the harness/import graph hashes; no firmware correction was made for that expected rejection.
