# Amount and recipient display boundary review

Source-only checkpoint: 2026-10-10, branch `ledger-bitcoin-prl`, commit
`219a039cb4d2b46abf3e1757e810546c2c126a96`. The worktree was clean when inspected.
No additional repository `AGENTS.md` was found. This review made no production
changes and ran no project code, tests, builds, native/emulator execution,
browser automation, network requests, package tools, or transactions.

## Result

No new material amount/unit/recipient substitution or approval-binding defect
was established in the inspected ordinary-payment path. Exact integer grains
remain consistent from companion preparation through PSBT, host verification,
and the C device's display inputs. This is a bounded static result, not native
qualification or a claim of overall wallet security.

One informational host/device warning-policy difference is detailed below. It
does not suppress a device warning that the companion requires. The previously
documented device high-fee wording caveat remains unchanged.

## Informational: different low-value exemptions for high-fee warnings

- Companion `apps/companion/src/main.ts:500-506`: warn when
  `fee > 100_000 && fee * 10 >= totalInputs` (bigint arithmetic).
- Native `apps/ledger-bitcoin-prl/src/prl.h:59-61`, used at
  `src/handler/sign_psbt/transaction_display.c:295-296`: warn when
  `totalInputs > 100_000 && fee >= ceil(totalInputs / 10)`.

A valid one-input/no-change payment with 200,000-grain input, 180,000-grain
recipient and 20,000-grain fee has no companion high-fee banner but does meet
the native warning predicate. These are respectively 0.002, 0.0018 and 0.0002
PRL. This example is evaluated from the source, not an executed reproduction.

The native warning set is a strict superset over valid bundles: a companion
warning implies `totalInputs >= fee > 100_000`, and its multiplication test is
equivalent to the native ceiling comparison. Thus no reverse case exists in
the accepted profile. Exact recipient and fee values are displayed either way.

`docs/companion.md:63` accurately documents the companion predicate; it does
not explicitly promise matching native warning semantics. `main.ts:506` tells
the user to review the fee on Ledger. This is a minor predictability difference,
not a mandatory security fix. If the policies are unified later, retain the
more conservative device warning and add threshold boundary tests.

The separate native wording issue was already recorded in
`tools/device-approval-review/README.md:381-391`: large-screen text refers to
10% of the amount being sent, whereas the predicate uses total inputs and has
the low-total exemption. It is not a new finding from this pass.

## End-to-end source trace

### Input, units and preparation

- `packages/sdk/src/amount.ts:2-45` defines 100,000,000 grains/PRL and maximum
  2,100,000,000,000,000,000 grains. Decimal parsing splits whole/fraction text,
  pads to eight fractional digits and uses bigint. Formatting uses exact
  division/remainder; aggregate addition rechecks the monetary maximum.
- `packages/wallet/src/watch.ts:151-211` derives imported amounts from parsed
  raw previous outputs and checks txid, ownership and aggregate range.
  `apps/companion/src/bridge.ts:226-252` deliberately avoids floating RPC value
  fields. No floating-point amount conversion was found in the payment path.
- `watch.ts:285-350` parses amount and fee once, bounds the selected input
  total, derives change as `inputs - amount - fee`, and constructs recipient
  and owned branch-1 change scripts. `:363-374` applies fee/dust policy without
  repricing. Zero change is omitted; positive dust is rejected, not added to
  the fee. The SDK/device enforce the supported signing profile; the companion
  adds relay-policy gates. Direct raw signing need not meet the companion's
  positive-fee/dust policy.
- `apps/companion/src/main.ts:923-954` snapshots the request before storage;
  `:500-506` renders the canonical saved bundle's recipient script, amount,
  change and recomputed fee, rather than retaining a separate address label.
  `:1178-1200` validates that bundle and its reservations before signing.

### Host PSBT and signed-byte binding

- `packages/sdk/src/bundle.ts:54-146` enforces positive bounded values, bounded
  sums, one recipient, at most one branch-1 change, owned input/change scripts,
  unique inputs and outputs no greater than inputs.
- `packages/sdk/src/keys.ts:93-144` accepts only curve-valid P2TR or opaque
  32-byte P2MR external scripts, enforces the network HRP, and reconstructs
  addresses from witness version and all program bytes. Ownership uses the
  exact independently derived BIP86 script at `:163-172`.
- `packages/bitcoin-prl-adapter/src/psbt.ts:125-189` encodes amounts as LE64,
  carries script bytes and derivation metadata, binds network/genesis, and
  compares the reconstructed bundle with the original. Its parser at
  `:252-383` enforces exact fields, values and derivations; a claimed change
  cannot bypass owned-script validation at the final `validateBundle`.
- `packages/bitcoin-prl-adapter/src/client.ts:595-615,625-640` snapshots caller
  data before asynchronous signing. `:93-157,529-544` verifies each DEFAULT
  signature against that bundle, then independently reparses final bytes and
  compares every output amount/script and every input/outpoint/witness.
- `packages/sdk/src/transaction.ts:19-81,114-140` binds all input amounts and
  scripts, outputs, outpoints, sequences, version and locktime in BIP341, with
  exact bigint serialization and a 64-byte signature requirement.

### Native validation, display and commitment

Paths in this subsection are under `apps/ledger-bitcoin-prl/`.

- `src/prl.h:11-13,51-61` bounds sums before addition, so uint64 accumulation
  cannot wrap and signed review subtraction stays below INT64_MAX.
  `src/handler/sign_psbt/preprocess_inputs.c:200-310` compares optional raw
  prevouts with witness data, counts each amount once, and rejects foreign
  inputs. `preprocess_outputs.c:153-263` validates positive values, checks
  recipient script type/curve validity, rejects forged/incomplete change,
  bounds total/change, rejects negative fee, and requires exactly one recipient.
- `src/handler/sign_psbt/process_in_outs.c:75-135` checks complete BIP86 paths,
  device-derived keys, account compatibility and exact reconstructed scripts;
  output ownership additionally requires branch 1. An output without change
  metadata stays visible as the recipient, even if it happens to be self-owned.
- `src/handler/sign_psbt/transaction_display.c:213-274,321-375` uses cached
  recipient script/amount, verified change and the checked totals. Exactly one
  recipient always fits the 8/16-entry cache/simplified review, so a separate
  streaming-display interpretation is not reachable in this profile.
- `src/common/script.c:86-107` and `segwit_addr.c:183-194` construct the full
  address using the compiled HRP and Bech32m witness version/program.
  `Makefile:57-92`, `src/prl.h:23-48` and SDK `network.ts:15-55` agree on the
  five network mappings. Network/genesis metadata is checked by
  `src/handler/sign_psbt/prl_psbt.c:55-89`.
- `src/ui/display_utils.c:17-47` formats amounts by integer division/remainder
  at the same 1e8 scale. Dropping fractional trailing zeros preserves value.
  The 28-byte output buffer (`display_utils.h:9`) accommodates the maximum
  PRL amount plus ticker and terminator. `display.c:44-47,295-304,358-405`
  checks copied-string capacity and prepares persistent recipient/change/fee
  buffers. `display_nbgl.c:161-178,331-408` includes fixed network, account,
  explicit P2MR type where applicable, amount, full recipient, verified change
  and exact fee before approval.
- `src/handler/sign_psbt.c:54-67` validates and hashes before review.
  `src/handler/sign_psbt/txhashes.c:109-281,575-666` hashes the committed output
  values/scripts and all input amounts/scripts into the same DEFAULT BIP341
  structure checked by the host. A false witness amount cannot independently
  yield a spendable signature for a different real prevout amount.

## Limits and remaining qualification

This pass did not establish current-source compilation, actual screen layout,
pagination, physical readability, touch/button behavior, maximum-resource
behavior, compiler/SDK correctness, Merkle cryptographic implementation
correctness, or runtime fault handling. Prior emulator screenshots and tests
belong to their recorded artifacts and were not rerun here. No full dependency,
browser/storage, optional Snap, hardware or consensus audit was performed.

Shared test-network HRPs and lack of consensus chain-ID replay protection are
already documented limitations, not newly discovered display defects. Device
network labels and host metadata checks do not authenticate chain state or
prevent replay between otherwise compatible chains. P2MR is a payment-only
opaque destination; neither its address display nor this review establishes
that a recipient can spend it. The companion's `Recipient P2TR address` label
at `main.ts:496` is narrower than the implemented P2TR/P2MR acceptance policy,
but the destination bytes and native P2MR label are preserved.

No production edit or new execution is proposed as a prerequisite to this
bounded review result. Final-source native and physical-device qualification
remain separate release gates.
