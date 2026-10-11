# Independent fault-parity review — held candidate

Reviewed 2026-10-11. No additional blocker was found in the reviewed software changes and focused evidence. This does **not** resolve the [physical incident](../gen5-reset-incident/README.md), approve hardware use or authorize release promotion. This reviewer inspected source, test design and retained results, independently checked their bindings, and wrote only this report; no hardware or test execution was performed by this reviewer.

## Device findings

The [source comparison](source-comparison.json) correctly separates Bitcoin `44ecd041…`/SDK26.6.2 from Pearl's SDK27.1.2/API27. I independently checked the downloaded source hashes and equality of the selected heartbeat, receive/transmit, event and exit/exception-wrapper bodies. The status and packet-definition headers also match. Bitcoin/Pearl `app_main` bodies match; command descriptors and the full applications do not. Matching source bodies are not compiled equivalence: Swap/library feature settings differ.

The new branch returns SDK busy status `6901` for the same seven nested-APDU packet types. It uses `os_io_tx_cmd`, not a function that releases the original reply ownership, and does not dispatch the new request or overwrite the original app buffer/media/consent state. Nonnegative transmit results, including zero, are accepted; a reported negative result remains terminal. PIN and deadlines are checked after transmission. Private lower-level channel state is inherited from the SDK, not independently instrumented here.

[Native evidence](evidence.json) binds **18 focused cases**: 10 on Gen5 mainnet and eight on Nano S Plus regtest. It verifies original account/address identity, signatures valid for the original transaction and invalid for a proposed replacement, rejection without signature yields, and fresh explicit approval of a replacement. Same-process Receive tests start a new index within the old cancellation-status interval and keep it pending beyond that timer before approval. Flex/Stax/Nano X are build-only in this campaign. Four sanitizer configurations cover busy-response types/media, original buffers, transmit failures and PIN/deadline boundaries.

Some device-state cases deliberately filter the known busy response to keep the original test waiter pending. That is synthetic demultiplexing, not production host recovery. The separate unfiltered raw-protocol case requires explicit device Cancel and `6985` before a fresh request. **Busy status and host cancellation are not proof that the original device review ended.** Pearl still deliberately differs from upstream on invalid PIN, deadlines, receive/transmit errors, malformed framing and non-allowlisted UX/pairing events.

## Host findings

The desktop correction uses public DMK/WebHID constructor/lifecycle hooks, retaining SDK framing and state-machine code. Normal close is shared and memoized per ownership generation; reopening waits for the observed raw close. Exact-handle event filtering prevents an unrelated disconnect from ending the selected operation. Pre/post-open guards prevent a stopped generation from becoming usable, and old close callbacks cannot start a second close on a reused handle.

The SDK's physical-disconnect handler bypasses the sender close hook. The affected exact handle therefore remains quarantined for the page; logical cleanup is not reported as raw-close acknowledgement. Failed/timed-out owned cleanup or uncertain SDK teardown blocks reconnect until reload. Cleanup attempts the owned raw close even after teardown errors. No browser HID method override, private SDK-field access, new APDU driver or dependency migration was introduced.

I reviewed and hash-checked the [21 focused tests, five preserved disconnect histories and typecheck logs](host-results.json). The additional refresher-fixture correction now invokes the public transport factory and retains the actual session, queue and connection state machine. Its five disabled-model cases, two enabled controls, historical capture and queue assertions pass, including one physical-close call per scenario. These tests use actual pinned SDK code with synthetic HID objects. They establish modeled ownership/order behavior, not real OS close completion or physical device cancellation. Reloading the page is an availability boundary, not a command to cancel hardware review. The normal full-repository check is recorded separately by the root agent.

## Binding and remaining limits

Current native/host source graphs, official source copies, host logs and both raw native result files match the frozen evidence. Public fixtures only were used. No physical BLE/USB failure, retail Bitcoin firmware or reset/protection behavior was reproduced. The API27 retarget does not inherit Bitcoin's audit qualification. Tick budgets are not universal wall-clock guarantees under arbitrary scheduling. Version and `release.json` remain unchanged; the candidate is not a registered replacement release. Hardware and release remain held while the physical incident is unexplained.

| Reviewed source/evidence | SHA-256 |
| --- | --- |
| `apps/ledger-bitcoin-prl/src/boilerplate/prl_review_io.c` | `3616650ffa71a92e6131c20e2e192ebbefb6b1fb4d027bcdf3210f2cf5317aad` |
| `apps/companion/src/ledger.ts` | `d4b6cb7bc45aaa61359053fa296be4cf44c3fc53d80cf26ef5604fb79a16973d` |
| `apps/companion/test/ledger.test.ts` | `cb361cfc71fd90b44cf3589692cdafdb357adb00c4fdc0f36a60dde8f1717083` |
| `apps/ledger-bitcoin-prl/prl-tests/native-review-faults.ts` | `ade616748b698563b28fdf43267aea1218e2a6d3310047c7e6c1ab9b293dcb23` |
| `tools/bitcoin-fault-parity/source-comparison.json` | `322ae39d58bd1f2d42d17f0d3b63b120494003faf7bb8d6a223cf1394fa81554` |
| `tools/bitcoin-fault-parity/evidence.json` | `3e21f35615eb3ef1ef17bf4f8f9d89117b96e3c743a976f4166a3ac08f60c160` |
| `tools/bitcoin-fault-parity/host-results.json` | `f35eaf8f505e52609edbcd0e27fb607bc2f63a587f86fa398dd0803992275bdf` |
| `apps/ledger-bitcoin-prl/release.json` | `f3cc4ad53db1e2d3eee7be321bf260d00a391edd1aa2c91a40c4fd576633a603` |

The refresher fixture is bound separately at `apps/companion/test/dmk-refresher.mjs` SHA-256 `00a561862e790abc81c1acaffa88fe9218f54a32dd2d00c2b53302d75dc0d2d1`; this last update changes test setup only, not production transport behavior.
