# Initial Ledger connection cleanup: independent HOST review

Date: 2026-10-10 UTC. Target: `apps/companion/src/ledger.ts:169–223` and the
actual caller in `apps/companion/src/main.ts:1080–1149`.

## Result

No newly demonstrated approval bypass, signing-after-cancel, indefinitely
accumulating global HID listener, or surviving usable DMK session was found in
the tested initial-connection paths. No production source was changed.

The final strengthened 34-case host matrix, standalone strict probe typecheck,
and standalone companion typecheck all completed successfully at approximately
01:42 UTC. This fresh verification
is bound to local commit `b9e09b7ecdeca6da5d41a938202092392124d101`; its production,
harness, test, and installed-package hashes match the original review inventory
exactly. The existing seven Ledger adapter tests also have an earlier complete
7/7 passing log. This is targeted host evidence, not an aggregate build or
browser/physical-device qualification pass.

An earlier interrupted repeat remains preserved separately and is not counted
as a completed run. The new complete logs close its strengthened-test and
typecheck evidence gaps without rewriting that history.

The CLI source remains bound to the unchanged SHA-256
`556ed61699371f1696c265f00356ac30447e95f84ff181ab1206765bae26893c`.

## Method and boundaries

`harness.ts` bundles and evaluates the actual production `ledger.ts`, actual
installed DMK **1.11.0**, actual installed WebHID transport **1.2.4**, and RxJS.
The DMK builder is subclassed solely to observe calls and inject explicitly
named faults. Normal paths retain real DMK discovery, connection, session,
public ping, and factory teardown code. The WebHID factory retains its actual
implementation with an observed `destroy()` call.

The browser boundary is a synthetic `navigator.hid` EventTarget and a synthetic
HIDDevice. Successful connection replies only to the ordinary DMK
`b001000000` public app/version ping, using public dummy app metadata. No
signing endpoint, key, hardware device, firmware build, native emulator,
browser/profile, deployment, real transaction, or live account was used.
Unexpected application APDUs make the fixture fail. Global fetch is prohibited
by the harness; no test intentionally requests an external endpoint.

Cancellation integration evaluates actual `main.ts` with only DOM,
BroadcastChannel, and storage boundaries replaced. The real production
`connectLedger` remains underneath that caller. This establishes host control
flow, not real-browser event/unload semantics or physical-device behavior.

## Coverage

### Supported library paths

- Chooser rejects with a synthetic `NotFoundError`, or resolves to no selection.
- Chosen device disappears from enumeration before connection.
- HID enumeration rejects; unsupported product/model rejects before open.
- HID open rejects with a synthetic `NetworkError`.
- First discovery result unsubscribes immediately and opens only one session.
- Successful connection, repeated idempotent close, and terminal APDU rejection.
- Discovery times out at 60 seconds; late chooser completion does not open a
  session or contaminate a fresh later connection.
- Thirty alternating chooser failures/successful connections do not accumulate
  global HID listeners or DMK sessions.
- Twenty failed opens followed by a successful connection retain only one
  overwritten `oninputreport` property on the same synthetic device.
- Actual main caller's Cancel and unload handler at chooser, open, and DMK
  public-ping boundaries discard late connection completion before any Pearl
  application APDU. A second connect attempt is blocked by the actual busy guard.
- Actual main caller's cancellation during discovery timeout never opens a
  session or emits any APDU.
- Physical disconnect of an already returned transport remains terminal after
  a subsequent synthetic HID connect event and after the SDK grace timer expires.

Known live resources are checked via Node's EventTarget listener inventory,
observed RxJS subscription teardown, synthetic device open state, and actual
`dmk.listConnectedDevices()` inventory. These are explicit resource checks,
not a complete heap/garbage-collection proof.

### Explicit defensive injections, not asserted real-world failures

The suite separately injects synchronous start failure, discovery observable
error/empty completion, synchronous/asynchronous stop failure,
synchronous/asynchronous connect failure, and a rejection after a real session
was initialized. It also makes DMK close and factory destroy throw **after**
their actual cleanup ran. These verify the production catch/finally behavior;
they do not prove such failures naturally arise from the pinned implementation.

In particular, the pinned WebHID `stopDiscovering()` is a no-op. A delayed or
throwing stop is an adversarial scheduler model. DMK's `DevicePinger.ping()`
swallows ping errors and returns null rather than propagating a connect
rejection; that behavior has its own characterization. The injected
post-session rejection must not be mistaken for a reproduced SDK ping-failure
path.

## Observations and impact

### Cancellation intent is safe but cleanup is deferred

`connectLedger` accepts no AbortSignal. Actual `main.ts` sets its abort signal,
then checks it immediately after the pending connection resolves and closes
the returned transport before issuing capabilities or account export.

The tests prove no Pearl account/signing APDU is issued after cancellation in
these modeled phases. A normal public app/version ping may still occur while
DMK finishes the connection. The chooser can remain pending until the existing
60-second discovery timeout; the app remains busy while waiting. An injected
never-settling HID open keeps the app busy even after 120 seconds of virtual
time, but sends no APDU. Eventual open rejection cleans everything checked.
Real indefinite HID-open reachability was not established. No speculative
production cancellation change is recommended from this evidence alone.

### Pinned WebHID retains one report-handler property

The installed `WebHidApduSender.setupConnection()` assigns
`device.oninputreport` before awaiting `device.open()`. Its cleanup does not
clear that property, including after an open error. Repeated attempts on the
same device overwrite the prior callback; no global connect/disconnect
listeners or DMK sessions remain, and recovery succeeds.

This is observed library-level callback retention, not demonstrated listener
accumulation, heap growth, sensitive-data exposure, or a usable session. It
would be inaccurate to claim every possible callback reference was erased.

### Pinned SDK reconnect retention is bounded

A synthetic physical-disconnect event can start the installed state machine's
6,000 ms reconnect timer before terminal teardown finishes. The factory's
listeners and DMK session inventory are cleared, and the public transport is
terminal. Timer instrumentation observed that timer expire, no new APDU or
device reopen, and zero remaining tracked timers. The residual timer is not an
indefinite session leak. See `timer-characterization.log`.

## Evidence and verification status

### Fresh final-source verification, 01:42 UTC

- `approved-final-matrix.log`: final strengthened matrix, **34/34**, complete
  terminal summary and exit 0.
- `approved-probe-typecheck.log`: standalone strict probe typecheck, exit 0.
- `approved-companion-typecheck.log`: standalone companion typecheck, exit 0.
- `approved-source-commit.txt`: local commit
  `b9e09b7ecdeca6da5d41a938202092392124d101`.
- `approved-source-sha256.txt`: production, harness, test and package bindings;
  an exact comparison with `source-sha256.txt` completed successfully with no
  differences. No production source or test assertions changed during this
  fresh verification.

The completed commands used only already-installed tools:

```sh
node node_modules/typescript/bin/tsc -p tools/connection-cleanup-review/tsconfig.json
node --import tsx --test tools/connection-cleanup-review/connection-cleanup.test.ts
node node_modules/typescript/bin/tsc -p apps/companion/tsconfig.json --noEmit
```

No package installation, wallet-network request, native execution, or physical
device operation was requested or performed by these checks.

### Preserved earlier evidence

- `initial-matrix.log`: complete initial 21/21 pass.
- `expanded-matrix.log`: complete expanded 31/31 pass.
- `completed-34-run-summary.txt`: retained terminal summary from the separate
  completed 34/34 run at approximately 00:34:29 UTC. Its standalone strict probe
  typecheck also completed with no diagnostics and exit status 0.
- `final-matrix.log`: a later, interrupted rerun contains 34 individual passing
  case lines but **no terminal summary**. It is not claimed as a completed run.
  Between the completed run and this rerun, only the injected-fault assertions
  were strengthened to check exact errors and reached phases; production and
  harness source were unchanged.
- `existing-ledger-tests.log`: complete existing Ledger adapter 7/7 pass.
- `timer-characterization.log`: complete timer expiration observation,
  including `timers: []`, `sessions: [0]`, one original report and one open.
- `typecheck.log`: no diagnostics, but this file was overwritten during the
  interrupted combined command. This historical file alone does not establish
  a completed typecheck; fresh completion is recorded above.
- `companion-typecheck.log`: npm header and tsc invocation only. Final command
  status is not established; do not claim a new companion typecheck pass here.
- `source-sha256.txt`: current production, harness, test, and installed-package
  bindings. `ledger.ts` is
  `e6f6599e650f0f61038319f582aa611bc4b3461315b9d3e26ca0c31da9df8207`;
  `main.ts` is
  `ce0b26e6520f210bf57f633469da5ab1821f18e423926422ffc5c4568cce3292`.

### Historical interrupted repeat

An earlier combined run was interrupted before process completion. Its logs
contain passing individual cases without a terminal summary; that repeat and
its package-script typecheck remain incomplete evidence. The final test source
had strengthened injected-failure assertions compared with the preceding
completed matrix, while production source and the synthetic harness were
unchanged. The fresh 01:42 UTC run completes validation of those strengthened
assertions and both typechecks. Original partial logs are preserved and are
not relabeled as complete.

## Recommendation

Retain this bounded startup-failure regression coverage. No production fix is
proposed because no new actionable host security defect was demonstrated.
Real-browser chooser/unload and physical-device qualification remain separate
release gates. The interrupted checks are not counted as passed; any later verification must retain its own final-source identity and complete result.
