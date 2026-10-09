# PRL Ledger release-path decision

Reviewed 2026-10-09 UTC against local HEAD
`ce97b530051179def6035a716afbaa076fb1d1b0` and the working-tree sources below.
This is an architecture recommendation, not a security audit or approval.
Only source/document reads and this report were performed: no builds, tests,
emulators, device operations, live wallet probes, installations, submissions,
external contact, secrets or broadcasts. Native execution remains paused.

## Recommendation

**Resolve Ledger's classification before investing further in the C release
route. Preserve the website and the strict PRL custody contract either way.**

- If Ledger expressly accepts this separate-chain C fork, retaining it is the
  lowest-rewrite route and preserves the most Bitcoin signing/parser machinery.
  Acceptance would not qualify the changes or the SDK retarget.
- Without that acceptance, plan for Rust. Start from the existing Rust app/core
  and the official Rust boilerplate/SDK; migrate the current security semantics
  deliberately. Do not translate the whole Bitcoin PSBT engine merely to keep
  Bitcoin-like internals.
- Historical PRL1 is a possible narrower first product only if P2TR-only
  recipients and a protocol-specific host are acceptable. It is not a drop-in
  replacement for today's companion and must not silently lose current recovery
  protections.

This is a conditional decision, not authorization to rewrite, contact Ledger,
change scope or distribute. Device-held keys and trustworthy PRL review matter
more than wire-protocol resemblance to Bitcoin.

## Why a vendor decision comes first

Ledger's current policy says, “Rust is mandatory for all new device app projects.”
C is retained for existing-app maintenance. Its Bitcoin clone guide describes
Layer-2 Bitcoin extensions; the linked template signs specialized Bitcoin
transactions through a Bitcoin base and hooks. Neither establishes that a new
separate-chain PRL fork qualifies for an exception. **Inference:** eligibility
cannot be settled by renaming this fork a clone. Tool support for C is not
publication permission.
[Getting started](https://developers.ledger.com/docs/device-app/getting-started),
[clone guide](https://developers.ledger.com/docs/device-app/integration/how-to/clone),
[Bitcoin extension template](https://github.com/LedgerHQ/app-btcext-boilerplate).

## Three practical routes

| Route | What is reused | Main cost and release condition |
| --- | --- | --- |
| **A. Ledger accepts the C fork** | Current PSBTv2/Merkle protocol, upstream policy/derivation/hash/UI machinery, exact-integer host adapter and website. | Smallest architectural rewrite, but a substantial changed security boundary. Obtain explicit classification; then qualify every current source correction and the change from upstream SDK 26.6.2 to API 27. Existing Bitcoin audits and deployment tags do not cover PRL. |
| **B. Rust with current strict semantics** | Existing Rust platform/UI/crypto work and `pearl-core`; current policy specification, vectors, host transaction checks, wallet and website. A wire-compatible implementation could also retain the complete PSBT host adapter. | Best alignment with published new-app policy. Exact PSBT/Merkle compatibility requires a new bounded Rust device parser/state machine or a separately evaluated approved reusable component; the SDK is not evidence of a ready PRL/PSBT signer. Highest new implementation/requalification cost if wire compatibility is mandatory. |
| **C. Revive historical Rust PRL1** | Existing bounded bundle parser, review tokens, signing/session logic, `LedgerPearlClient`, UI and retained emulator evidence. | Least new device parsing among the Rust choices, but narrower functionality and companion integration work. P2MR payment is absent; capabilities bind a network ID, not the current genesis-bearing schema. Old evidence is historical and source-bound. Current host lifecycle/recovery behavior must be deliberately ported and tested. |

For B, separate **semantics** from **wire format**. A compact, explicitly
versioned Rust protocol can enforce the same transaction restrictions without
recreating all Bitcoin machinery. Host-side PSBT import may remain an input
format, but native code must still independently enforce every signing-critical
rule. Preserve exact PSBT device compatibility only if it provides a concrete
product/integration benefit or Ledger requires it. A Rust wrapper around the C
engine is not an established policy exception or memory-safety migration.
[Official Rust boilerplate](https://github.com/LedgerHQ/app-boilerplate-rust),
[official Rust SDK](https://github.com/LedgerHQ/ledger-device-rust-sdk).

## Concrete reuse and gap map

1. **Keep the product shell:** `packages/wallet`, companion discovery, storage,
   payment reservations, recovery and public-backend checks are largely
   protocol-independent. DMK/WebHID already supports both command families in
   [`ledger.ts`](../../apps/companion/src/ledger.ts) (lines 15–42). The actual
   [`main.ts`](../../apps/companion/src/main.ts) currently selects the C/PSBT
   client (lines 1083–1110), so changing firmware alone cannot work.
2. **Keep public-data and transaction primitives:**
   [`packages/sdk`](../../packages/sdk/src) provides bigint grains, derivation,
   canonical transaction handling and independent signature verification.
   [`pearl-core`](../../crates/pearl-core/src) already has checked amounts,
   bounded parsing, ownership/change validation and an approval-token boundary.
   These are locally implemented components needing review, not automatically
   audited professional libraries.
3. **Keep custody inside Ledger:** historical
   [`crypto.rs`](../../apps/ledger/src/crypto.rs) derives through Ledger syscalls,
   uses SDK curve/scalar/BIP340 primitives, checks randomness and signatures, and
   limits private-key lifetimes. Reuse its design and reviewed lessons; recheck
   emitted code after any SDK/compiler change. Rust still crosses unsafe FFI
   and OS-exception boundaries.
4. **Port the current contract:** fixed network/capabilities, 16 owned BIP86
   inputs, one recipient/optional verified change, exact amounts, DEFAULT
   sighash, no script path, complete trusted review and terminal-session rules.
   Current [`prl.h`](../../apps/ledger-bitcoin-prl/src/prl.h) and
   [`prl_psbt.c`](../../apps/ledger-bitcoin-prl/src/handler/sign_psbt/prl_psbt.c)
   make network/genesis and monetary rules explicit. Preserve payment-only P2MR
   support only through a reviewed protocol/UI change; neither route supports
   XMSS custody or claims quantum resistance.
5. **Do not regress signed recovery:** today's
   [`client.ts`](../../packages/bitcoin-prl-adapter/src/client.ts) persists the
   complete verified signature set before the final ACK and preserves signed
   bytes through ambiguous completion (lines 160–167, 529–590). Historical
   [`device.ts`](../../packages/sdk/src/device.ts) has a different `signBundle`
   contract and no equivalent persistence hook (lines 270–349). Carry the safety
   property across, not an inapplicable ACK sequence.

PRL1 explicitly rejects non-P2TR outputs; see `device.ts` lines 284–286 and the
[historical protocol](../../docs/protocol-v1.md). Its fixed network ID still
separates configured networks; absence of genesis metadata is a capability
difference, not proof of an exploitable flaw.

## Security and requalification costs

No route is currently ready for valuable funds. C's latest canonical-parser,
post-approval reauthentication and continuation corrections are uncompiled and
unexecuted. Rust's retained 25-build/five-model evidence describes earlier exact
sources, not a revived app with today's host. See the
[C status](../../apps/ledger-bitcoin-prl/README.md) and
[historical qualification](../native-release-qualification/README.md).

The historical Rust app also carries a
[local SDK transport/FFI patch](../../apps/ledger/patches/strict-transport.patch).
Its [official workflow gate record](../../apps/ledger/publication/official-gates.json)
is inactive: pinned-build integration, test-framework acceptance, privileges
and vendor workflow compatibility remain unresolved. Reusing it avoids starting
over; it does not mean adopting an unmodified vendor template.

For the selected final artifact: qualify parser/adversarial cases, native
ownership and digest equivalence against Pearl, full trusted-screen snapshots,
cancel/lock/disconnect/timeout/restart and partial-signature races, exact
signed-byte recovery, maximum-value arithmetic, physical memory/latency/fault
behavior, reproducible packaging and model/OS permissions. Re-run applicable
tests for the exact source and dependency pins; no historical pass transfers
automatically. No schedule or audit price can be responsibly inferred here.

Publication requires Ledger functional validation and its partner-audit/review
process, including responsible human sign-off. A My Ledger signer listing does
not itself add Pearl asset management inside Ledger Wallet. Confirm the full
device matrix and retail Nano X testing/distribution route. See
[audit requirements](https://developers.ledger.com/docs/device-app/submission-process/deliverables/security-audit)
and the [distribution review](../ledger-distribution-review/README.md).

## Why the existing Bitcoin app cannot simply label PRL as BTC

Compatible BIP340/BIP341 mathematics does not make the chains or approvals
interchangeable. PRL uses its own network/genesis, `prl`/`tprl`/`rprl` address
HRPs, mainnet coin type 808276 and maximum 2.1e18 grains. Current support also
includes PRL-specific payment-only P2MR outputs. A Bitcoin device review cannot
be made into a correct PRL review by changing website labels or address prefixes;
the trusted device must enforce the intended derivation, amounts, destination
encoding and transaction policy. Allowing a signature to be mathematically
valid on PRL is insufficient.

Reusing Bitcoin derivation paths would also give up the intended mainnet key
separation. Even PRL's PSBT genesis field is application policy, not a chain ID
inside the BIP341 signature: identical signing data/keys on compatible chains
can retain replay risk. Never hide this with BTC display or blind signing.
[Local network definitions](../../packages/sdk/src/network.ts),
[current signer contract](../../apps/ledger-bitcoin-prl/README.md),
[Ledger protocol-aware clear-signing requirements](https://developers.ledger.com/docs/device-app/submission-process/deliverables/security-audit).

## Decisions still needed

- **Ledger:** Is this exact separate-chain C fork admissible, or is Rust required?
  If Rust, what SDK/template, narrow crypto FFI and protocol reuse are acceptable?
- **Ledger:** Which current model/OS matrix, coin/path registration, workflow
  integration, patch policy and Nano X access/distribution arrangement apply?
- **Owner/product:** Is P2MR payment required for the first release? Is exact
  PSBT device interoperability valuable enough to justify its Rust cost?
- **Owner/vendor:** Select licensing, authorized source disclosure, audit budget
  and maintenance obligations before any submission or contract.

Until those decisions, preserve both implementations as development references;
do not fund test addresses, relabel prior evidence, or claim an approved route.
