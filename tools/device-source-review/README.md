# PRL native signer: bounded independent source review

Date: 2026-10-09. Scope: static source/provenance review of
`apps/ledger-bitcoin-prl`, its declared Ledger baseline, and relevant checked-out
SDK/Pearl source. No build, native/emulator execution, capacity test, device
installation, seed handling, transaction broadcast, or native-source change was
performed for this review. The paused native-execution lane remains paused.

## Result

The fork substantially reuses official Ledger Bitcoin code and preserves an
on-device-only private-key signing design in the inspected production dispatch.
Two low-severity continuation-length validation gaps are source-confirmed below.
No private-key export path, approval bypass, or transaction-substitution defect
was established in this bounded review. This is not proof of their absence,
professional human audit, vendor approval, or a release recommendation.

## Findings requiring follow-up

### DSR-01: leaf-index continuation accepts trailing bytes (Low)

- Location: `apps/ledger-bitcoin-prl/src/handler/lib/get_merkle_leaf_index.c:33-38`.
- The parser reads `found` and CompactSize `index`, checks range and flag, but
  does not require `read_buffer.offset == read_buffer.size`. For example, an
  otherwise valid `found=1,index=0` reply with appended bytes follows the same
  success path if its subsequent proof is valid. The appended bytes are ignored.
- This is production-reachable through
  `src/handler/lib/get_merkleized_map_value.c:27-28`, its hash counterpart, and
  streaming counterpart. The dispatcher validates continuation CLA/INS/P1/P2
  and envelope length, not helper-specific consumption
  (`src/boilerplate/dispatcher.c:121-129`).
- Impact established by source: incomplete strict protocol validation and an
  overbroad README claim. The following leaf-hash proof and comparison remain
  present (`get_merkle_leaf_index.c:50-61`), so trailing bytes do not by themselves
  let a host substitute committed key/value contents. No financial-loss or
  key-disclosure exploit is claimed, and no native reproduction was run.
- Follow-up when native work is authorized: reject unconsumed bytes after the
  two fields and add both found/not-found trailing-byte rejection coverage.

### DSR-02: signature-yield acknowledgement accepts a nonempty body (Low)

- Location: `apps/ledger-bitcoin-prl/src/handler/sign_psbt/sign_input.c:81-87`.
- After yielding a signature, `yield_signature` calls `process_interruption`
  and accepts success without checking for an empty acknowledgement payload.
  Thus an otherwise valid `f8/01/00/01` continuation can contain ignored data.
- Impact established by source: another exception to strict body consumption.
  It does not independently bypass approval or change the already committed
  transaction. The signature has already crossed the device boundary when the
  acknowledgement is received; rejecting that acknowledgement cannot revoke it.
  Host recovery must continue treating yielded signatures as consequential even
  if the final status/acknowledgement is lost.
- Follow-up when native work is authorized: require an empty acknowledgement
  and add a negative test. Do not represent this as cancellation of an already
  released signature.

The application README was narrowed to state these exceptions. Native C and
native tests were not edited. These findings remain unfixed in source.

## Provenance established

- `UPSTREAM_TREE.txt` exactly equals `git ls-tree -r` for declared Ledger commit
  `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a` using the available upstream Git
  objects. That commit and declared master
  `da3c8c9d1cab91a7614efe6cadf197c5cc7c3b50` resolve to the same tree,
  `f55a8a554c73a31b241cf527e67f90a7c6a0a1ff`.
- Of 132 files under the app's `src`, 99 are byte-identical to the pinned
  upstream blobs, 27 differ, and six are added. No upstream `src` file is removed.
  Counts measure files, not security coverage. In particular, dispatch,
  preprocessing, Schnorr signing and trusted-review integration are changed.
  `source-inventory.json` records exact per-file hashes and classifications.
- Important unchanged files include `src/crypto.c`, `src/secp256k1.c`, the
  PSBT transaction-hashing implementation, wallet parser, script/address codec,
  and several Merkle helpers. Their upstream origin does not validate the
  changed paths or new integration.
- The local secure SDK checkout is clean according to Git status and points to
  `6709cd2bdfebb224ee070f7c1211b54254262579`, as declared for v27.1.2/API27.
  `tools/bitcoin-prl-port/build.sh:12-15` checks that revision and clean status.
  Its before/after source snapshots and manifest are useful local attribution,
  not cross-machine reproducibility or proof of the installed device binary.
- Official GitHub pages independently confirm the pinned app commit's 2.5.1
  version bump and the Nano S Plus / Nano X deployment tags pointing at it with
  SDK v26.6.2, hash `22d1131a03fcd89c5d2e660de886c8b0417b0789`.
  The other three deployment-tag pages and SDK release page could not be
  retrieved through this review's web tool; their declarations were not
  independently reverified from those pages.

Primary references:

- [Ledger pinned commit](https://github.com/LedgerHQ/app-bitcoin/commit/44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a)
- [Nano S Plus deployment](https://github.com/LedgerHQ/app-bitcoin/releases/tag/nanos%2B_1.6.1_2.5.1_sdk_v26.6.2)
- [Nano X deployment](https://github.com/LedgerHQ/app-bitcoin/releases/tag/nanox_2.7.1_2.5.1_sdk_v26.6.2)
- [Declared secure SDK](https://github.com/LedgerHQ/ledger-secure-sdk/tree/6709cd2bdfebb224ee070f7c1211b54254262579)
- [Pinned Pearl source](https://github.com/pearl-research-labs/pearl/tree/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701)

## Production control flow and keys

`src/main.c:52-78` dispatches only network information, account xpub, wallet
address, PSBT signing and master fingerprint. Retained registration/message/
MuSig/legacy source is not itself an enabled command. The Makefile disables
Bluetooth, swaps and library permission; `src/prl.h` also refuses autoapproval
and swap compile flags. No seed import/export or private-key-return command was
found in that dispatch.

Account export requires `display=1`, the exact three-element BIP86 account path,
and exact request consumption (`get_extended_pubkey.c:36-70`), then approval
before responding (`:105-110`). Wallet-address requests accept an optional
display flag, so silent address retrieval remains intentional; this is not a
universal on-device address-verification guarantee. Fingerprint export is also
intentionally unprompted (`get_master_fingerprint.c:28-42`).

The signing handler preprocesses all inputs and outputs, computes transaction
hashes, and requires `display_transaction` success before invoking
`sign_transaction` (`src/handler/sign_psbt.c:43-71`). The reachable Schnorr path
derives the child scalar through the secure SDK, checks BIP86 path/tweak,
requests checked fresh auxiliary randomness, checks signing success, clears
the private-key structure, verifies the resulting signature, and clears the
signature workspace on ordinary success/error exits
(`sign_psbt/sign_input.c:139-238`). API27 uses that workspace for nonce-related
intermediates, which makes those wipes relevant. SDK `lib_standard_app/
crypto_helpers.c:25-101` also clears derivation and public-key-helper private
buffers on ordinary returns.

This supports the narrower statement that no inspected production response
exports a seed or private scalar. Child private keys do exist temporarily in
the application's secure-device memory. Source inspection cannot prove
physical extraction resistance, fault/exception cleanup, entropy quality,
compiler behavior, or that a particular connected device runs this source.

## Policy, transaction commitments and review

- Standard policy validation requires version 2, one authentic device account
  xpub/origin, ordinary `tr` with no script tree and branches 0/1
  (`src/handler/lib/policy.c:1392-1499`). Nonzero HMAC and named policies are
  rejected by the signing/address handlers. Accounts and address indices cover
  the non-hardened 31-bit domain; input and change derivations must be exact
  five-element BIP86 paths and reproduce the claimed internal public key
  (`sign_psbt/process_in_outs.c:79-84`).
- Global keys are a closed allowlist, with required PSBTv2, transaction version
  1, exact input/output counts, zero locktime/modification flags when present,
  and the compiled network ID plus genesis binding (`sign_psbt/prl_psbt.c`).
  Input/output maps are bounded before key traversal
  (`handler/lib/get_merkleized_map.c:37-43`) and sorted strictly to reject
  duplicate keys (`check_merkle_tree_sorted.c:40-43`).
- Inputs: one to 16 positive owned P2TR UTXOs, no duplicate outpoints, mandatory
  witness UTXO/internal key/derivation/final sequence, and DEFAULT-only sighash
  (`preprocess_inputs.c:56-70,176-188,294-338,344-360`). An omitted sighash is
  DEFAULT in the Taproot signing path (`sign_input.c:398-401`). Script-path,
  tapleaf hashes and MuSig are excluded by policy, allowlists and the signing
  handler's final key-expression checks.
- Outputs: exactly one positive external P2TR or 32-byte witness-v2 P2MR
  recipient and at most one positive verified BIP86 P2TR change output.
  P2TR recipient x-coordinates are range/lift checked. A false or incomplete
  change declaration is rejected rather than treated as verified change
  (`preprocess_outputs.c:159-205,233-260`).
- Each value and aggregate is bounded at 2.1e18 grains; checked accumulation
  occurs before addition. Fee is nonnegative; high-fee detection avoids
  multiplication overflow (`src/prl.h:52-61` and preprocessing).
- Review prepares the compiled network, full source account, recipient address
  and amount, explicit P2MR type if applicable, full verified change address/
  path/amount and fee (`transaction_display.c:196-203,260-273`;
  `ui/display_nbgl.c:160-177,330-407`). Amount formatting uses integer division
  and eight decimal places (`ui/display_utils.c:16-49`). This establishes data
  preparation, not physical-screen readability on every model.
- All-input/default BIP341 hashing includes prevouts, amounts, scriptPubKeys,
  sequences and outputs (`sign_psbt/txhashes.c:588-623`). Host-supplied fake
  witness amounts cannot independently yield a valid signature over different
  actual amounts, assuming the signature scheme/hash commitments work as
  intended. The signer does not independently discover chain UTXOs or prove
  chain validity/finality.

## PRL differences and remaining limits

The app's 1e8 grains/PRL, 2.1e18-grain maximum, mainnet coin type 808276,
test-network coin type 1, HRPs and displayed-order genesis hashes match the
inspected pinned Pearl `node/btcutil/const.go` and `node/chaincfg` source.
Regtest and Simnet genuinely share HRP/genesis while keeping distinct app IDs.
The app's xpub/tpub policy transport intentionally differs from Pearl's
zpub/vpub/spub textual versions; it must not be advertised as interchangeable
with every Pearl wallet export format.

P2MR support is payment-only. P2MR roots are opaque 32-byte values, matching the
pinned Pearl script shape; this cannot establish that a recipient knows a
spending path. No P2MR custody, XMSS signer or post-quantum key protection is
provided. The app's BIP341 digest contains no chain ID. PSBT genesis/network
metadata prevents workflow mix-ups but cannot create consensus replay
protection; compatible chains sharing keys, UTXOs and signing data can still
replay signatures.

The custom review heartbeat aborts on unrecognized/nested I/O, reported USB
power loss, PIN lock, malformed events and 1200 review ticks, with a separate
3000-tick whole-command budget (`boilerplate/prl_review_io.c:19-79`;
`dispatcher.c:41-46`). Physical-model compatibility and actual transport/ticker
behavior remain unverified here. Closing WebHID or aborting browser JavaScript
is not necessarily a device event; a host must discard uncertain sessions and
require app exit/reopen. Already yielded signatures remain usable if valid.

Before valuable funds: independently qualify the final source-linked build,
all supported physical models/OS combinations, full-screen review, denial and
session lifecycle, resource bounds, fault cleanup, host recovery, and release
permissions. Retain the explicit experimental/no-vendor-approval boundary.
The two continuation checks need authorized native changes and new evidence;
this static review does not satisfy those execution gates.
