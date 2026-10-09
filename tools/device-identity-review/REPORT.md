# PRL host device identity and session review

Date: 2026-10-09 UTC. Scope: host protocol/version binding, network/account
checks, receive verification, and transport/session lifecycle. Native C was
read only where needed to identify a trust boundary. No native build, emulator,
physical device, live node/indexer, browser, installation, user secret or
broadcast was used. Host tests used existing dependencies, in-memory bundles,
explicit substitutes, and published public fixtures.

## Result

No host signing bypass was demonstrated for wrong-app, unknown-protocol,
wrong-network, account-change, device-rejection, cancellation or reconnect
cases. One low-impact stale-session UI defect was reproduced and corrected:
previous receive verification could outlive a failed session after a valid
signed result. The address itself remained the same previously verified public
address; no recipient substitution, new signature authorization or fund loss
was demonstrated.

The checks establish compatibility with device-provided assertions, **not
cryptographic firmware identity, Ledger authenticity, an approved app build,
or proof of a physical approval**. App release-version enforcement is absent.
These remain assurance limitations, not a finding that the strict PRL protocol
gate silently accepts ordinary Bitcoin or the legacy PRL1 protocol.

## D1: stale receive verification after terminal signing result (fixed)

### Reproduction and impact

1. Approve and verify a receive address in a ready session.
2. Sign the frozen public payment and receive the complete independently valid
   signature set; persist the exact signed bytes under existing reservations.
3. Lose the final continuation acknowledgement, receive a rejected ACK, or
   fail durable storage after the signatures exist.
4. The adapter correctly becomes `failed` and closes transport. After a final
   ACK failure it deliberately returns the valid signed transaction with
   `completionWarning`, rather than discarding spendable bytes.

Before this correction, `run()` only cleared `verifiedReceive` in its exception
handler. A returned warning bypassed that cleanup. After completion the receive
screen could still show “Verified on device” with “Copy verified address”
enabled, although the client was failed. The client still rejected every new
operation without sending an APDU. Exact signed bytes and both input locks
were retained; nothing was broadcast.

An independent timing review also found two intermediate-display variants:
`markPendingRecoveryFailed()` renders the failed recovery state before outer
cleanup, and a final ACK failure can leave the previous DOM in place if the
subsequent journal refresh stalls. During those pending flows the Copy control
was disabled by the existing busy state, but the label could remain stale.

### Correction

Only `apps/companion/src/main.ts` changes production behavior:

- The centralized `render()` entry clears receive verification whenever the
  current client is failed.
- The operation finalizer renders a failed-session view before any journal
  await, while its controls are still busy.
- The catch-only assignment is removed. Error explanation is preserved.

This covers both exception and valid-result-with-warning paths, including
intermediate recovery warnings and stalled journal reads. Normal successful
signing keeps same-session verification. The patch does not alter account
keys, APDUs, signature checks, signed recovery bytes, payment states,
reservations, or broadcast permissions.

References:
- `apps/companion/src/main.ts:152-184`: operation wrapper and finalizer
- `apps/companion/src/main.ts:291-294`: centralized render invalidation
- `packages/bitcoin-prl-adapter/src/client.ts:583-592`: complete signed-result
  warning/error semantics
- `main-session-fix.diff`: exact production diff
- `pre-fix-receive-session-regression.log`: passing characterization of the
  old defect, not evidence that the old behavior was correct
- `receive-session-regression.test.ts`: six fixed-behavior/control tests against
  actual `main.ts` and the actual PSBT adapter
- `../device-session-review/README.md`: independent review and expanded timing
  coverage, maintained by its reviewer

## Verified gates and remaining trust boundaries

### Protocol, network and version

Every account export, address operation and signing operation first sends
`E1 06 00 01 00`. `parseNetworkInfo()` requires exactly 58 response bytes:
`PRLB`, schema 1, selected network ID, exact coin type, genesis, maximum amount,
limits 16/2, and capability flags 3. Unsupported fields, lengths, statuses,
interruptions and legacy capability payloads fail terminally before a display
or signing command. Each operation repeats this check even with a cached policy.
Same-HRP testnet and testnet2 remain distinguished by network ID and genesis.

- Host: `packages/bitcoin-prl-adapter/src/policy.ts:42-85`
- Rechecks: `packages/bitcoin-prl-adapter/src/client.ts:357-365,405-415,447-449,491-493`
- Device declaration, source only:
  `apps/ledger-bitcoin-prl/src/handler/get_network_info.c:11-26`

There is no application semantic version, source/build hash, certificate,
attestation signature or challenge in this response. The reviewed host does
not enforce a minimum app release or pin an approved firmware artifact. A
compliant old or malicious endpoint can repeat the same public tuple. Any DMK
app-information traffic is not used here as an authenticated release gate.
Do not describe the connection as “firmware authenticated” or claim that it
rejects an old vulnerable build which advertises this same protocol/profile.

### Account and address

Fresh export requests displayed BIP86 account derivation and validates xpub
encoding, network transport version, depth 3, hardened account index, valid
public key and chain code. An uncached policy compares network, account number,
master fingerprint, public key and chain code with the approved account.
Every receive response must exactly equal independent public derivation, and
the request always sets display=1.

- `packages/bitcoin-prl-adapter/src/policy.ts:94-170`
- `packages/bitcoin-prl-adapter/src/client.ts:370-476`

A cached policy rechecks the four-byte master fingerprint, **not a fresh full
account xpub**. That fingerprint is a convenient change detector, not a unique
or cryptographically authenticated device identity. Cached policies are keyed
by the full approved public account, cleared on failure/close, and not shared
between new clients. Native standard-policy code additionally compares its
locally derived complete xpub to the supplied policy
(`apps/ledger-bitcoin-prl/src/handler/lib/policy.c:1464-1485`, source only).
The host separately checks the returned address or signatures. The cached
fingerprint must not be promoted to an attestation claim.

A fully malicious endpoint can echo a known public address and advertise
matching capabilities without displaying anything. The mock trust-boundary
control intentionally demonstrates this limitation without a device or human.
The protocol success word and display flag are trusted device assertions about
UI behavior. They are not cryptographic proof that a person saw and approved
the address.

### Signing, rejection and cancellation

Signed results are checked against the exact snapshotted transaction, expected
input indices and output keys, and independently verified BIP340 signatures.
Missing, invalid, duplicate or foreign yields cannot become a complete signed
result. Device rejection or cancellation before a complete valid set is
terminal and cannot be turned into an address or signed transaction by a late
successful response. A pre-aborted request sends nothing and leaves the
otherwise-ready PSBT client usable.

The intentional exception is recovery of a **complete already-verified signature
set** after final ACK failure, cancellation or storage failure. Retaining those
bytes does not mean the failed device session is ready. It must not release
reservations, re-sign automatically or imply that no signature exists.

- `packages/bitcoin-prl-adapter/src/client.ts:246-324,486-593`
- Independent signature/final-transaction checks: same file, `verifyAndFinalize()`

Signature verification proves validity for the public keys and exact transaction
being checked. It does not authenticate firmware, the screen, a human click,
or live chain state. Ordinary Pearl transaction signatures do not add a network
identifier; native enforcement of the PSBT network binding remains important.

### Transport and reconnect

`DmkPearlTransport` latches closed before asynchronous cleanup, aborts pending
exchanges, rejects later APDUs, and does not reopen after a connect event. The
companion disconnect callback also clears the client/receive label and aborts
the current operation. Reconnecting constructs a new client and repeats
capability and displayed-account checks. Old operations cannot revive the old
transport. The PSBT transport preserves a response which already won a race,
so final signatures can be verified and saved; the terminal latch still forbids
the next command.

- `apps/companion/src/ledger.ts:63-166,170-225`
- `apps/companion/src/main.ts:1080-1142`

HID disconnect events are conservatively treated as terminal rather than
filtered to a device. This can close a valid session when another HID device
is removed, but it does not open a signing bypass. Closing the host connection
still does not prove that the powered device left its review UI. Physical
behavior and native lifecycle qualification remain unverified here.

### Legacy fallback

The companion explicitly selects `bitcoin-prl` transport and instantiates only
`LedgerBitcoinPrlClient`; the CLI also instantiates only that client. Separate
legacy PRL1 APIs still exist in the SDK. They are not selected after PSBT
handshake failure, and the explicit DMK protocol allowlists reject cross-protocol
commands. A caller explicitly constructing the historical client is outside
the companion/CLI PSBT path, not an automatic downgrade.

## Regression evidence

- `identity-gates.test.ts`: 29 tests. Includes 232 single-byte binding mutations
  (all 58 bytes across four operations), wrong app/legacy/status replies,
  same-HRP networks, cached-policy rechecks, full-account/fingerprint changes,
  malformed exported metadata, wrong receive index, rejected/cancelled UI,
  public-claim trust-boundary control and source-level no-fallback controls.
- `receive-session-regression.test.ts`: 6 tests. Lost/rejected final ACK,
  early review rejection, storage failure with stalled refresh, ordinary
  success, and lost final ACK with stalled refresh. Checks exact signed bytes,
  locks, disabled controls, rendered label and prohibition on further APDUs.
- `apps/companion/test/device-identity-boundaries.test.ts`: routine CI wrapper
  for all 35 tests. Removes `NODE_TEST_CONTEXT` before spawning the isolated
  child test process, checks child exit status and explicit test/failure counts.
- Existing targeted host checks: 56 tests passed, including actual DMK transport,
  SDK/PSBT client, disconnect, signing recovery, lifecycle and UI boundary suites.
- Existing DMK refresher check: one wrapper passed, covering five modeled
  device IDs plus read-only historical captures; it did not rerun native code.

Commands/logs are in this directory. Initial targeted results precede the final
render-timing refinement; the final wrapper and independent session suite cover
the final production hash below. All six workspace typechecks, 422 top-level workspace tests, both host builds,
code formatting and the tracked-file secret scan passed. Full workspace checks
were run while the
account-discovery worker was editing a separate source concurrently. They are
informational host-check results, not a claim that the entire checkout was
frozen. The parent owns final combined-tree validation and checkpointing.

## Source identity and verification limits

Original `main.ts` SHA-256:
`a1bfd6960626b1d397ffa4db5366da7633af6a47f656392319da650823bf12b7`

Final `main.ts` SHA-256:
`ce0b26e6520f210bf57f633469da5ab1821f18e423926422ffc5c4568cce3292`

`source-and-build-hashes.json` records the review inputs and host output hashes.
`docs/checkpoints.json` belongs to the parent and is not part of this worker's
edit scope. No commit, push, deployment or firmware execution was performed by
this worker. Successful host tests do not close native runtime, physical-device,
trusted-screen, transport authenticity, real IndexedDB/crash durability, vendor
review or independent human security-review gates.
