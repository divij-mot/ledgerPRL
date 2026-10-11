# PRL feature coverage and compatibility audit

Protocol audit: **2026-10-09**. Desktop parity and qualification update: **2026-10-10**. This is an implementation scope and acceptance-test document, not a claim of release readiness or a general security audit.

## Decision summary

An ordinary Pearl wallet can use the mature Ledger Bitcoin signing implementation for **BIP86 Taproot key-path custody**, with Pearl-specific derivation, network identity, monetary bounds, address display and transaction policy. The inspected Oyster wallet's default receive/change and ordinary transaction construction agree with this approach. [Default transaction fields/signing][S32] A useful wallet also needs discovery, history, spendability, recovery, fee handling and durable pending-payment state; these do not come from the hardware signer.

**“All PRL features are supported” is not an accurate claim for the restricted profile.** **P2MR recipient support is implemented** in the host and Bitcoin-derived signer. Owned inputs/change remain ordinary BIP86 P2TR; this does not add P2MR/XMSS custody. Qualification is bounded by the [current 0.1.4 review](../tools/ux-event-review/README.md) and [recorded Gen5/Nano S Plus physical operations](../tools/ux-event-review/physical-verification.json); earlier artifacts retain separate evidence. The most consequential everyday limitations are fragmented miner UTXOs, bounded account discovery, backend uncertainty and browser/device recovery. Message signing, advanced scripts and stateful XMSS require separate designs.

Recommended product description: **a development Ledger-backed Pearl wallet for ordinary Taproot accounts, with an explicit supported-destination and transaction-policy list**. The same interface supports local native SPV with desktop WebHID and hosted stateless Discover on desktop/iOS/Android; deployment and native Android qualification remain separately bounded. The optional MetaMask experiment does not establish availability in MetaMask's normal account/send interface.

## Current desktop/lite parity

This comparison uses the actual official desktop sources at the immutable pin below. A fresh 10 October source review verified all 130 desktop `src/` blobs against their Git object hashes. Desktop features are distinct from features available only through node/wallet RPCs or the script engine.

| Everyday feature | Official desktop behavior | Current companion |
| --- | --- | --- |
| Send and receive | Ordinary BIP86 account, one recipient in the desktop form [S2], [S35] | Implemented with Ledger approval and independent signature verification. P2TR and P2MR destinations; owned P2TR only. Real incoming-payment discovery/confirmations observed in the [local checkpoint](../tools/local-mainnet-review/README.md); later browser verification showed the outgoing entry confirmed in the sender’s synced view, without independent recipient-wallet observation. Current C regtest roundtrip passed 16 checks, including real node acceptance and confirmation |
| QR and fresh receive address | QR plus `getnewaddress` on entering Receive [S36] | Verified-only receive QR and explicit New address implemented. Send accepts camera/image QR locally with lazy jsQR and optional exact amount; scan only fills the form. New receive addresses retain durable ranges and require device approval |
| Send Max | Max control, recalculated around the selected fee [S35] | Exact-integer Max for ≤16 eligible unreserved inputs implemented. Manual or capped selection is labeled separately from the full account balance; the explicit fee and normal policy checks remain |
| Fees | Blockbook estimates for 1/10/25 blocks [S35], [S30] | Both modes use fresh 1/10/25-block quotes with Medium by default, automatic exact-size total fees, Max repricing and Custom total fees. Quotes expire after two minutes; visible unprepared Amount screens refresh at about 105 seconds. Short times derive from the 194-second block target, not live mining pace. Equal-priced options remain; unavailable quotes expose Standard relay-minimum fallback. No confirmation guarantee |
| Activity | Paginated history, timestamps, confirmations, fee, copy txid [S37] | Paginated display, copy txid and validated-tip confirmation counts implemented. History remains fully retained; timestamps and general transaction fees are not supplied by the current history schema |
| Pending payments | Rebroadcast and optional Remove [S37] | Explicit exact-byte retry and durable reservations. An unchanged current initial attempt can clear after the adapter unwinds with no complete verified app result. Complete results, recovery/historical ambiguity and broadcast uncertainty remain reserved; no arbitrary Remove action |
| Unconfirmed spending | Desktop sends with minimum confirmations 0 [S2] | Requires one confirmation for ordinary inputs and 100 for coinbase |
| Chain verification | Desktop starts the wallet with `--usespv` [S38] | Default mainnet account 0 uses pinned official Pearl wallet/Neutrino code in a native watch-only helper, linked with real XMSS/ZK verification libraries. Readiness requires completed canonical header/filter/wallet synchronization and coverage. Browser raw-transaction/ownership/consistency checks remain; this inherits upstream SPV assumptions and is not full-node validation. Optional public-indexer/node modes retain their distinct trust model |
| Software keys and password recovery | Software-wallet import and unlock [S2] | Intentionally excluded. Recovery phrases/private keys never enter the companion |

The local account is remembered as public metadata and resumes synchronization on reopening; device approval is never restored. Nonzero mainnet accounts require the explicitly consented public-source path because local synchronization currently supports account 0 only. The [final local reviews](../tools/final-local-audit/product.md) distinguish public-fixture tests, native sync evidence and remaining physical gates.

The current source adaptations preserve Ledger Wallet's modal and step structure; they are not the unmodified Ledger application. Remaining live-chain gates and the bounded owner-approved trial are documented in [mainnet testing](mainnet-testing.md). That trial amount is not a wallet cap.

Hosted release `fca78a8` is live at the Vercel Hobby project and passed [17 boundary checks and 15 public-file comparisons](../tools/hosted-wallet-review/release.md). The hosted Discover manifest was schema-verified and then imported with owner approval on desktop, opening the exact hosted Add account page; Android import remains untested, and source/mocked Wallet API and responsive-browser checks do not qualify native Android. Hosted functions keep no account database or server profile. The browser caches display data and journals locally; cached views cannot authorize spending. See the [current product review](../tools/hosted-wallet-review/product.md).

## 1. Evidence and version boundary

| Evidence | Immutable reference / observation |
| --- | --- |
| Latest official release at the 9 October check | [v1.4.11][release], commit `2bb142f0f15d5aa929bf3a46d91d31ac6397e2c4`, published 2026-09-29 |
| Official source pin | [`2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`][current], verified as `master` at the 9 October check |
| FP8 proposal | [PR #311][fp8], head `684f7045f3b3b7c5b7598f46c06b7dceb506f74b`; open and unmerged during this audit |
| Existing local implementation baseline | Commit `7a332f6e2a8e654720c104a5c58ed65cf9414257`; the new Bitcoin-derived signer and MetaMask adapter were work in progress while this matrix was written |

Official repository tree metadata was retrieved independently. All **4,621 tracked file blobs** in the local current-Pearl source snapshot matched their Git object hashes. The audit examined actual node, wallet, CLI and desktop implementation, rather than treating README feature lists or inherited Bitcoin comments as proof of working behavior.

The release-to-current tree comparison shows no changes to the transaction signing, address, script-engine or ordinary transaction-author sources discussed here. There are changes in network configuration, SPV handling, CLI and desktop setup; consequently the entire application must not be described as byte-identical to v1.4.11. P2MR, optional XMSS commitments and the message-signing construction below are present in both inspected release/current sources.

FP8's inspected proposal changes block/certificate/header code. Its `wallet`, transaction signing, address, mempool and `node/wire/msgtx.go` sources match the current pin. The existing [three-reference compatibility evidence](fp8-compatibility.md) is applicable to its recorded ordinary-P2TR fixtures only. A later release, proposal update or activation is a new verification target.

### Terms used below

- **Required**: necessary for a useful, honest ordinary self-custody wallet, even if implemented in the host rather than firmware.
- **Optional / separate policy**: valid Pearl functionality which is not necessary for basic receiving and paying, but must be advertised as unsupported until implemented and tested.
- **Baseline**: the implementation at the original protocol audit; historical evidence does not automatically qualify later source or transports.
- **Supported destination** and **owned spend policy** are different. Paying an address does not require knowing its owner's witness script, private key or signature algorithm.

## 2. Ordinary-wallet coverage matrix

| Capability | Official Pearl behavior | Requirement and restricted-profile impact | Existing component to preserve / remaining gate |
| --- | --- | --- | --- |
| Connect hardware and identify account | Oyster is a software wallet; its secret storage is not a Ledger integration | **Required.** Pin app/network/path and bind public account to the connected device. An xpub supplied by a web page is not proof it came from Ledger | Account export, matching device address and explicit connect. Re-qualify against the Bitcoin-derived app; never fall back to the MetaMask seed or Oyster private keys |
| Receive ordinary PRL | `getnewaddress` defaults `pq` to false; desktop calls it without PQ arguments. BIP86 receive branch 0 is used [S1], [S2] | **Required.** `m/86'/808276'/account'/0/index` on mainnet; coin type 1 on the supported test networks. Full address/network must be verifiable on Ledger | SDK public derivation, receive review and issued-index journal. Earlier Nano S Plus and current Gen5/iPhone BLE address checks passed; device restoration and broader interoperability remain gates |
| Pay ordinary P2TR destinations | Node address decoder and `PayToAddrScript` recognize witness 1/32-byte Taproot. A recipient can have a hidden script tree [S3] | **Required.** The device does not need the recipient's tree. Only owned inputs/change must be proven empty-tree BIP86 | Preserve exact amount, recipient and fee display; independently re-derive owned change and verify signatures |
| Pay P2MR destinations | Witness 2/32-byte Merkle-root address is accepted by address/script and consensus validation [S3], [S4] | **Required for coverage of both genuine Pearl address types.** Implemented in the current restricted profile. Recipient-only support does not require XMSS or P2MR input signing | Current host/core/device code supports version 2 external recipients; retain exact address/display, malformed-change and independent-signature tests. Node compatibility and native qualification are separate evidence |
| Exact balance | 1 PRL = 100,000,000 grains; maximum transaction amount 21,000,000,000 PRL [S5] | **Required.** Integer grains throughout; values exceed JavaScript's safe integer range. A total balance is not the spendable balance | Portfolio headline uses total unspent owned outputs, including pending change, immature rewards and reserved inputs. Send/coin control separately enforce eligible unreserved availability. No optimistic balance subtraction. Reject overflow and rounded JSON numbers |
| UTXOs and coin control | Wallet selects eligible outputs, excludes locks and enforces account/maturity; CLI exposes lock/unlock [S6] | **Required.** Raw previous transaction, txid, vout, amount and script must agree. A bounded selection is acceptable if limits are visible | Existing exact raw-transaction checks, explicit selection and reservations. Preserve no-duplicate/no-foreign-input rules |
| Mining and pool receipts | Coinbase maturity 100; ordinary pool payments are not themselves coinbases [S6], [S7] | **Required for PRL mining users.** Identify coinbase from raw bytes, not amount/label. Recompute after reorg. Signing 16 inputs is a wallet limit, not a Pearl limit | Existing maturity split. Large payout accounts can exceed signer and scan limits; see §5 |
| History and payment details | Wallet RPC exposes transaction history/detail, pending balances and confirmation counts; desktop/CLI display them [S8] | **Required.** Account history must include fully spent addresses and both receive/change branches; pending and detached must remain distinct | Existing discovery/history and journal. Preserve pagination/count validation and show partial/unknown state instead of zero |
| Fees and dust | Node default 1,000 grains/kvB; vsize uses witness discount 4; P2TR/P2MR default dust boundary 333 grains [S9], [S10] | **Required.** Compute final shape's fee/vsize exactly; expose total fee and rate. A configured relay floor is not a confirmation forecast | Exact policy checks plus optional bounded Blockbook estimates. Unavailable estimates are labeled Standard at the relay floor; explicit stale targets fail closed. Fresh live fee reads were measured separately; automatic amount/Max repricing remains exact |
| Change | Ordinary author uses BIP86 branch 1 and passes `pq=false`; at most one change output; output position can be randomized [S11] | **Required.** Derive on-device from approved account; preserve durable high-water index; do not mistake “second output” for change | Existing independent ownership checks and journal. Both output orders must work; interrupted review must not reuse issued change |
| Recovery and gap discovery | Oyster recovery tracks receive/change horizons independently and expands after finding use [S12] | **Required.** Scan from a safe birthday, keep issued bounds, use historical activity rather than balance, and reveal incomplete coverage | Existing gap 20 and recovery backups. Explicit extended scan/import route needed outside current hard bounds |
| Confirmed spendability | Wallet can be configured with different minimum confirmations; desktop's send wrapper requests minconf 0 [S2], [S6] | **Required safety policy, not exact desktop parity.** This profile intentionally spends ordinary inputs only after ≥1 confirmation and coinbase after 100 | Existing host policy. No change to consensus; unconfirmed spending remains unsupported rather than falsely “invalid PRL” |
| Broadcast and exact rebroadcast | Node has raw broadcast; Oyster provides explicit rebroadcast including pending ancestors [S13] | **Required.** Persist signed bytes first; submission timeout is ambiguous; verify returned txid. Acceptance is not confirmation | Existing separate broadcast and durable `broadcast-unknown` state. MetaMask review must not silently broadcast |
| Reorgs and conflicts | Wallet rolls back history/credits on disconnected blocks, including tests for orphaned coinbases and stale blocks [S14] | **Required.** Revalidate block hashes, UTXOs and maturity; retain uncertain payments and avoid automatic input reuse | Existing rescan/reconciliation and reservations. New route needs identical interrupted/reorg tests |
| Account permissions and disconnect | Not a property of native Pearl consensus; needed when websites/MetaMask are involved | **Required for this integration.** Bind real caller origin, session, account, network/genesis and exact request. Expire/revoke without deleting financial history | Snap/companion permission layer. Device approval remains necessary; origin-bound Snap approval is not device provenance or chain validation |
| Public backup / device recovery | Oyster has software-wallet import/export capabilities; these are not the Ledger recovery model | **Required.** Public backup preserves account identifiers, issued bounds, reservations and exact signed bytes. Seed/passphrase restoration occurs only on supported hardware | Existing public/full watch backup. Never add seed entry, WIF export, software key import or web-based recovery as “feature parity” |

The baseline has substantial software coverage for these host responsibilities. Its recorded [implementation status](implementation-status.md), [recovery behavior](recovery.md) and [companion qualifications](companion.md#verification-and-remaining-qualification) remain the source of test scope. The existence of these modules is not evidence that a new transport/UI successfully calls them in every path.

## 3. What the restricted transaction profile genuinely excludes

The audited starting profile is: ordinary no-script BIP86 owned P2TR inputs/change; 1–16 inputs; exactly one recipient; ≤1 change; transaction version 1; locktime 0; sequence `0xffffffff`; SIGHASH_DEFAULT; 64-byte Schnorr witnesses; no annex or script path.

| Feature | Genuine upstream status | Why the profile excludes it / decision |
| --- | --- | --- |
| More than 16 inputs | Node standard transaction limit is 100,000 vB, not 16 inputs [S9] | Bounded hardware memory/time/review design. Do not silently drop inputs or turn a payment into several payments. Raise only after device measurements, or offer explicit separately reviewed consolidation/payment plans |
| Multiple recipients / `sendmany` | Implemented Oyster RPC accepts a map of destinations [S8], [S15] | One-recipient UI is a deliberate subset. Expanding outputs needs review-order, screen, fee, change classification and resource tests; not needed for basic send |
| Tx version 2 | Node's normal mempool is configured to admit versions 1–2 [S16] | Ordinary Oyster author still creates version 1. Version 2 exclusion blocks some advanced timelock transactions and virtual message formats, not ordinary transfers |
| Nonzero locktime / nonfinal sequences | Transaction wire and script engine support them; relay requires finalized transactions [S9], [S17] | Current policy fixes both. Adding CLTV/CSV/anti-fee-sniping behavior needs dedicated semantic display and tests; do not normalize imported fields to zero |
| RBF / fee replacement | Node implements opt-in replacement with sequence ≤ `0xfffffffd`, subject to node policy [S18] | Final sequence disallows profile-originated opt-in RBF. Higher-fee replacement is a new approved transaction with shared reservations, not a retry. RBF is not required to receive or make a normal send |
| CPFP / unconfirmed change spending | Chain can relay dependent transactions; Oyster pending rebroadcast handles ancestors [S13] | Current host minconf 1 excludes unconfirmed change even though firmware could sign its shape. Needs parent/child history, package-fee and conflict handling before enabling |
| Other sighash modes | Script/RPC supports ALL/NONE/SINGLE and ANYONECANPAY variants [S19] | SIGHASH_DEFAULT commits to the full ordinary payment. Other flags can leave outputs/inputs uncommitted and create serious review ambiguity. Keep disabled unless a separate protocol needs them |
| Taproot tree-committed owned input | Optional Oyster PQ receive addresses are P2TR with a nonempty root; ordinary spending uses a root-tweaked Schnorr key [S1], [S11], [S20] | Same derivation path plus an empty-tree tweak gives a different address. Arbitrary host-supplied roots cannot be treated as ordinary BIP86. Need authenticated policy registration and complete recovery metadata |
| Taproot/P2MR script-path spend | Actual script-engine support [S21] | Requires leaf/control-block validation, policy ownership, satisfaction review and potentially timelocks/multisig. No key-path witness can spend P2MR |
| XMSS signing / PQ-only custody | Opcode and crypto library exist; optional address commitments and test spends exist [S20], [S22] | Stateful signature allocation and rollback/restore safety are separate critical requirements; see §7. Keep disabled |
| Multisig | `OP_CHECKSIGADD` enables tapscript threshold policies. Legacy `OP_CHECKMULTISIG` is disabled; legacy wallet multisig RPC handlers are commented out [S8], [S23] | Inherited Bitcoin P2SH/P2WSH wallet policies are not PRL multisig support. Only a reviewed Pearl-compatible tapscript policy could be added |
| OP_RETURN outputs | Recognized in consensus; node permits at most one data output under standard policy [S4], [S9] | No ordinary recipient address represents it. Not needed for payments; arbitrary data outputs and zero-value outputs are outside current review rules |
| Signed messages | Oyster RPC/CLI implements a construction named BIP322 [S24] | Neither the restricted payment profile nor Bitcoin legacy message signing matches it; see §6 |
| Generic PSBT import/export | Oyster has library-level PSBT funding/signing helpers, but its inspected legacy RPC map exposes no `walletcreatefundedpsbt` or `walletprocesspsbt` [S8], [S25] | Ledger's PSBTv2 transport is an internal representation, not a new Pearl wire transaction format or proof of generic Oyster RPC interoperability. The pinned Pearl PSBT parser requires a global unsigned transaction, characteristic of PSBTv0 [S26] |
| Signet/custom signet | Configuration/source exists; official parameters say Pearl does not currently operate a signet [S27] | Not among this project's five-network profile. Do not invent public backend support or silently map to testnet/testnet2 |
| SPV/full-chain proof verification | Pearl contains separate node/SPV and certificate verification code | The hardware app signs transactions. Backend RPC consistency checks do not validate Pearl proof-of-work/proof certificates. This is a separate trust model, especially for FP8 |
| EVM accounts, ERC tokens, contract calls | No such wallet capability is established by the inspected PRL UTXO interfaces | Do not represent PRL as an ERC20 token or use Ethereum transaction/message encodings as a substitute. This integration uses PRL-specific methods |

Unsupported features must fail before private-key derivation/signing where possible, and again at the device boundary. Host-only filtering is insufficient because a hostile host can send APDUs directly.

## 4. Narrow P2MR recipient support

This recipient policy is implemented without broadening the custody algorithm. Current Nano S Plus mainnet/regtest emulator replays verify the full P2MR destination, label, amount, fee and returned signatures on the recorded ELFs. Physical P2MR display and live relay remain unqualified. See the [P2MR native evidence](../tools/live-app-native-review/p2mr/README.md).

### Exact representation

- Address: Bech32m, network HRP, witness version **2**, exactly **32 bytes** of Merkle-root witness program.
- Script: exactly 34 bytes: `52 20 <32-byte-root>`.
- Mainnet HRP `prl`; testnet and testnet2 `tprl`; regtest/simnet `rprl`. Network identity still requires configured network and genesis, not the HRP alone.
- The 32-byte root is **not an elliptic-curve point**. Do not apply Taproot `lift_x`/compressed-key validation to it. Reject wrong length, mixed-case encodings, wrong checksum type, unsupported witness versions, noncanonical script pushes and wrong HRP.
- The device must encode the recipient from the exact output bytes it hashes, using witness 2, and review its full address/amount. It must not label the recipient as change or as “quantum safe”.
- P2MR inputs/change and host-supplied scripts/control blocks remain rejected. A recipient's P2MR address commits to a tree which could use Schnorr, XMSS or another accepted script; the address alone does not identify its security policy.

Sources: [address decoder/constructor][S3], [standard output scripts][S28], [P2MR script-path validation][S21].

### Executed source-oracle check

A network-free probe against the verified current pin passed **39 cases**:

- 30 P2MR address roundtrips: lower/uppercase on five networks, with an all-zero root, all-`ff` root and a single-leaf Schnorr-script root
- 6 rejected root lengths: 0, 1, 20, 31, 33, 40 bytes
- 3 fully signed ordinary P2TR-input payments checked with the actual Pearl script engine, transaction sanity checks and mempool acceptance: a 332-grain P2MR recipient correctly failed dust; 333 grains with change and 99,000 grains without change passed

The two-output transaction was 154 vB; the one-output transaction 111 vB. Both used a 1,000-grain fee and an explicitly public deterministic test scalar. These checks establish node-side compatibility for the fixtures. They do not test the new host adapter, device parsing/display, live relay, XMSS or physical hardware. Never fund any fixture address.

Required integration tests: same recipient script/address on host and all device families; P2MR at both output positions; malicious P2MR “change”; foreign witness versions; invalid lengths/checksum/network; output mutation after review; exact final witness verification; and the same Pearl oracle checks on the final generated transaction.

## 5. Ordinary-wallet limits that must stay visible

### Large mining histories and fragmented balances

At the audited baseline, discovery stops safely at index 999, 256 candidate UTXOs, 2,000 unique history transactions, 20,000 address-history references and 3 MiB aggregate raw-history hex. The address gap is 20 per branch. A miner can exceed these bounds while every individual payment remains entirely ordinary PRL.

Do not claim the scanner covers arbitrary PRL accounts. A scan reaching a bound is **incomplete**, not an empty or fully discovered wallet. The signer cap must also be distinct from the watch-account cap: the wallet can show many coins while selecting only up to 16 for one signing request.

A safe improvement is resumable, bounded extended discovery with explicit coverage, persistent issued-index bounds and stable chain checkpoints. Increasing a number without controlling API pagination, memory, work and reorg consistency is not sufficient. Explicit consolidation can help fragmentation, but every consolidation is a real transaction with a new fee and on-device review. Never consolidate automatically or use an external address as hidden change.

### Recovery is not just restoring a seed

Keep both receive and change high-water marks, account/network/genesis, public key metadata, transaction journal, reserved outpoints and exact signed bytes. A fresh wallet must scan beyond every address ever issued, even if it has no current balance. A Snap API that derives an arbitrary index must not expose it as a safely issued receive address without updating recovery coverage; an address near the maximum derivation index is not discoverable using the default index 999 bound.

The existing public recovery record and full watch-wallet backup have different scopes. A public-key-only export does not preserve payment ambiguity. Restoring old data must not downgrade `signing` or `broadcast-unknown`, reuse change or unlock reserved inputs. Independent browser profiles/devices do not automatically coordinate payment reservations.

### Backend truth, maturity and fees

- The node's `gettxout(includeMempool=true)` explicitly does **not** exclude confirmed outputs spent by mempool transactions [S29]. Preserve the existing bounded raw-mempool conflict check; do not “simplify” it to one RPC.
- Blockbook address pagination and pending-history omissions are deployment-specific. Preserve the [documented deployed-source safeguards](backend-evidence.md), including exact count/category reconciliation and fail-closed limits.
- Raw transaction bytes establish the transaction's contents and owned script, not its inclusion, unspent status or complete account history. The chosen backend remains a trust dependency.
- Coinbase maturity is 100 blocks across the supported network definitions, not a fixed number of hours. The current wallet uses a conservative 100-confirmation spendability threshold matching Oyster's wallet filter. Reorgs can remove a coinbase or make it immature again.
- Use exact grains for accounting and fee calculation. At default relay policy, minimum fee is `floor(vsize*1000/1000)` with upstream's nonzero-rate fallback/overflow behavior, and P2TR/P2MR dust is 333 grains. A 16-input/two-output payment is 1,017 vB, so a fixed 1,000-grain fee is insufficient at that declared floor.
- A backend estimate is a quote in a documented unit, not a fee amount. Oyster desktop fetches estimates from Blockbook and uses floating PRL values [S30]; that implementation should not be copied into this exact-integer wallet.

### Ambiguous sends and “remove pending”

Oyster exposes “remove pending transaction”; its implementation warns that the network is not consulted and a peer may still mine the forgotten transaction [S13]. Copying that action to erase reservations would worsen this wallet's safety. Preserve exact-byte rebroadcast and conflict/reorg visibility. Unlocking uncertain inputs, replacing a payment or declaring a cancellation requires a separately specified workflow and evidence. A disappearing mempool entry is not proof that a signature or payment is harmless.

## 6. Signed-message interoperability is a distinct unresolved feature

The official `signmessage` handler is real and limited to Taproot addresses. Its helper is named `BIP322SignMessageSimple`, but the inspected implementation differs materially from the [BIP322 specification][bip322]:

- It constructs version 2 virtual transactions with default final input sequences.
- Its virtual funding input has an empty scriptSig; it does not insert the BIP322 tagged message hash there.
- It places the plaintext message into the virtual spending transaction's OP_RETURN output using `NullDataScript`, whose helper limit is 80 bytes.
- It returns a base64-encoded witness stack; its companion verifier reconstructs this same construction.

Standard BIP322 instead commits a tagged message hash in the virtual funding input and uses an empty OP_RETURN in the spending output. Bitcoin's legacy compact-ECDSA message format is also different. Thus **renaming Ledger Bitcoin's legacy command to PRL, or implementing generic BIP322 and assuming Oyster interoperability, would be incorrect**. [Oyster source][S24], [Bitcoin specification][bip322].

The ordinary payment signer deliberately rejects the necessary version/zero-amount/data-output shapes. Do not weaken its rules to smuggle virtual transactions through an ordinary-payment review. Any future message feature needs an explicitly named/versioned protocol, independent vectors against the intended verifier, complete message display, origin/purpose and anti-replay context where relevant, clear device approval and protection against payment/message confusion. Opaque hash signing is not an acceptable substitute.

Message verification could be added as a host-only, bounded feature sooner, clearly identifying which protocol is verified. It must not imply the Ledger signed it, prove current funds, or treat a signature as durable transaction authorization.

## 7. XMSS, script policy and quantum-resistance boundary

The inspected Pearl code supports these different cases:

1. **Ordinary empty-tree P2TR:** conventional BIP86/Schnorr custody, the current supported owned policy.
2. **P2TR with optional XMSS leaf:** Oyster can derive a separate purpose 222 key and commit an XMSS script. The P2TR output still has a classical key-path spend. Ordinary wallet signing uses the tree-root-adjusted Schnorr key. The `pq=true` flag is not equivalent to PQ-only custody. [S1], [S11], [S20]
3. **P2MR:** script-path only, no internal key or key-path spend. Its security depends on the actual script. A P2MR destination is not necessarily an XMSS destination. [S21]
4. **XMSS script execution:** `OP_CHECKXMSSSIG` verifies a 64-byte public key and a 2,340-byte signature split into five 468-byte chunks, using the tapscript SIGHASH_DEFAULT digest. [S22]

Pearl's XMSS library accepts a caller-supplied signature index and permits only 32 signatures per key. Reusing an index for different messages enables forgery; the library API itself is not an anti-rollback wallet state manager. The current Go source search found no production `xmss.Sign` caller outside tests. Ordinary signing and available address-generation helpers therefore do not establish a safe operational XMSS wallet. Builds without the `xmss` tag use a failing stub. [S31], [S34]

A Ledger XMSS design would need, at minimum:

- On-device monotonic reservation of each key/index **before** releasing any signature; interrupted signing burns an index rather than reusing it
- Power-loss, reinstall, app-upgrade, firmware-rollback, seed/passphrase restoration and simultaneous-clone protections
- An explicit recovery model that never reconstructs keys while silently resetting used indices; a host/indexer cannot certify an index was never signed offline
- Separate purpose 222 derivation semantics and a rule never exposing its corresponding EC public key [S33]; complete policy/tree metadata for address recovery
- Measured keygen/signing memory, latency, NVM endurance and exhaustion handling on each supported device family
- Fault-injection and repeated-message/different-message index-reuse tests, plus a cryptographic and state-machine audit

None of that should be replaced with localStorage, Snap encrypted state, a database counter, “ask the user not to restore twice”, or an inherited Bitcoin wallet policy. Keep XMSS signing disabled and describe the ordinary wallet as classical secure-element custody.

## 8. Reuse boundaries for Ledger Bitcoin and MetaMask

### Preserve mature mechanisms, narrow the accepted policy

Reuse Ledger Bitcoin's well-tested PSBT/Merkle transport, signature implementation, key-origin handling, review mechanisms and platform integration where applicable. Do not inherit its accepted currencies, script families or advanced commands wholesale. Pearl's consensus rejects legacy P2PKH/P2SH and witness 0 outputs [S4]; the familiar Bitcoin labels do not make those useful PRL options.

Apply Pearl-specific monetary bounds, HRP/coin type and explicit network display. Reject unsupported wallet descriptors, external inputs, script paths, tree roots, sighash flags, arbitrary message signing, legacy address types and mutable transaction fields before signing. Keep capability negotiation explicit so an older host/app cannot interpret a newly accepted script as a different type.

The device must independently enforce the meaningful spend policy. The host's PSBT generator should be a deterministic adapter from the already validated canonical payment, followed by independent verification that returned signatures and finalized bytes correspond to that payment. A permissive PSBT parser must not become an alternate arbitrary signing API.

### Reuse the existing watch-wallet lifecycle

The companion remains responsible for the backend, discovery, raw UTXO checks, policy/fee preview, recovery journal, device connection and explicit broadcast. A Snap should not duplicate these into a second divergent wallet state machine. It can authorize an exact origin/account/network request, present it, and independently verify/finalize returned signatures within its restricted method surface.

Required permission properties:

- Derive caller origin from MetaMask's invocation context, not request parameters; no wildcard/suffix origin matching
- Bind session/request to full public account identity, network and genesis; fingerprints alone are insufficient identity
- Exact request schema, byte/work limits, nonce/sequence/expiry and one outstanding request; stale network/account results must not revive a previous request
- Disconnect/revoke/expire cancels future authority without deleting existing signed transactions or financial reservations
- Signing approval is per exact recipient, amount, fee, change and inputs; a connect permission is not standing spending permission
- Never request MetaMask entropy, private keys, mnemonic or generic signing privileges as a fallback
- Clearly distinguish host-derived from device-verified receive addresses and backend-reported from independently validated chain data

The ordinary-send acceptance gate must exercise the actual sequence: connected MetaMask origin → exact request review → existing wallet freshness/reservation checks → Bitcoin-derived Ledger review/sign → independent signature/final-byte verification → durable storage → separate explicit broadcast. Unit tests of any one layer are necessary but insufficient.

## 9. Priorities and acceptance gates

### P0: honest, useful ordinary wallet

1. Preserve ordinary BIP86 custody and all existing fail-closed watch/journal/recovery semantics through the new signer and MetaMask route.
2. Preserve the implemented P2TR and P2MR **external destination** support and its exact display/host/oracle checks. Continue rejecting P2MR-owned inputs/change; extend qualification to remaining devices and live relay.
3. Publish an exact capability list and actionable unsupported errors, including input/scan caps, no message signing, no XMSS and no arbitrary scripts.
4. Run end-to-end synthetic ordinary sends, receive verification, rejection, transport interruption, account/network switching, stale-backend rejection, fee/dust boundaries, backup/restore and reorg reconciliation on the final integrated source.
5. Keep physical hardware, device restoration, human security review and distribution/vendor gates explicit. Passing an emulator does not retire them.

### P1: practical everyday improvements after the base works

- Resumable extended discovery and recovery coverage for mining-scale accounts
- Safe bounded coin selection and exact “send maximum” calculation; coin controls must preserve reservations
- Clearly unit-labelled fee-rate selection, optional verified fee estimates and explicit high-fee warnings
- Manual, separately reviewed consolidation guidance when fragmentation exceeds 16 inputs
- Account naming/selection and a documented recovery path for nonzero account indices
- Bounded host-only signed-message verification with protocol-specific labeling, if users need it

These can improve usefulness without enabling new cryptographic spend policies. Whether to increase signer input/output limits is a separate measured engineering decision.

### P2: separate designs, never silent scope expansion

- Version 2/timelock/RBF/CPFP or multi-recipient policies
- Tree-committed P2TR custody, script-path signing and Pearl-compatible tapscript multisig
- An interoperable signed-message device command
- XMSS/PQ-only signing and anti-rollback recovery
- Independently validating Pearl SPV/certificate verification, including final FP8 activation rules

### Minimum regression matrix

| Area | Positive cases | Negative / interrupted cases |
| --- | --- | --- |
| Network/account | Every supported network, nonzero account, receive/change branches, high-water restore | Wrong genesis/HRP/coin type/account, testnet versus testnet2, regtest versus simnet, old session reply |
| Amount/fees | 1 grain parsing, 333-grain ordinary output boundary, exact values above 2^53 and at max, 1/16 inputs | Negative/overflow/rounded-number amounts, 332-grain dust, 1,000-grain fee on 1,017-vB transaction, excessive-fee review |
| Destinations | P2TR plus P2MR, both output orders, one/two outputs | P2MR masquerading as change, wrong version/checksum/length, legacy/witness 0, output substitution after review |
| Owned input policy | Derived BIP86 script and exact raw previous output | Wrong path/amount/script/outpoint, duplicates, tree commitment, P2MR/script-path/annex/non-default sighash |
| Discovery/history | Fully spent used address, receive/change gaps, pending input spends, previously issued unused indices | Missing pages/raw bytes, drifting counts/tip, oversized account, pending-history truncation, false empty response |
| Maturity/reorg | Mature coinbase and ordinary pool payout, confirmation progression | Immature coinbase, orphaned coinbase, detached spend, stale archival claim, reorg reducing maturity |
| Request lifecycle | Explicit connect, review, verified signature completion, disconnect/reconnect | Origin spoof, replay, expiry, concurrent request, approval rejected, different account/device after reconnect |
| Payment lifecycle | Persisted signed bytes, exact explicit rebroadcast, fresh confirmation reconciliation | Crash before/after signature persistence, partial signature fetch, broadcast timeout, old backup downgrade, cross-tab race |
| Capability boundary | Supported transaction accepted on final app/host | Direct unsupported APDU/PSBT commands, unknown descriptors/fields, Bitcoin message command, hot-key fallback |

The original 9 October protocol audit executed the 39-case P2MR node-side probe and verified source provenance/compatibility; it did not use physical devices or execute the entire integration matrix. The later emulator and physical checkpoints linked above have their own artifact identities and narrower test scopes. None establishes funded broadcast, confirmation or production readiness.

## Primary sources

The immutable current source links below identify the actual inspected implementation. Relevant transaction/address/script files also match v1.4.11 as described above.

[release]: https://github.com/pearl-research-labs/pearl/releases/tag/v1.4.11
[current]: https://github.com/pearl-research-labs/pearl/tree/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701
[fp8]: https://github.com/pearl-research-labs/pearl/pull/311
[bip322]: https://github.com/bitcoin/bips/blob/master/bip-0322.mediawiki
[S1]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/legacyrpc/methods.go#L671-L730
[S2]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/main/services/wallet-service/wallet-rpc-methods.ts
[S3]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/btcutil/address.go#L79-L151
[S4]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/blockchain/validate.go#L192-L299
[S5]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/btcutil/const.go
[S6]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/createtx.go#L363-L432
[S7]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/chaincfg/params.go
[S8]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/legacyrpc/methods.go#L64-L141
[S9]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/mempool/policy.go
[S10]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/blockchain/vsize.go
[S11]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/createtx.go#L454-L498
[S12]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/recovery.go#L258-L373
[S13]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/pending.go#L35-L129
[S14]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/reorg_stale_block_test.go
[S15]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/legacyrpc/methods.go#L1360-L1556
[S16]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/server.go#L3087-L3105
[S17]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/wire/msgtx.go#L17-L49
[S18]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/mempool/mempool.go#L589-L674
[S19]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/legacyrpc/methods.go#L1615-L1631
[S20]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/waddrmgr/scoped_manager.go#L500-L552
[S21]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/txscript/engine.go#L525-L600
[S22]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/txscript/opcode.go#L2020-L2104
[S23]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/txscript/opcode.go#L2119-L2203
[S24]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/rpc/legacyrpc/bip322.go
[S25]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/psbt.go#L24-L50
[S26]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/btcutil/psbt/psbt.go#L183-L231
[S27]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/chaincfg/params.go#L36-L61
[S28]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/txscript/standard.go#L249-L285
[S29]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/node/rpcserver.go#L2824-L2937
[S30]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/main/clients/blockbook-client.ts
[S31]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/xmss/xmss.go#L18-L64

[S32]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/wallet/txauthor/author.go
[S33]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/wallet/waddrmgr/xmss_keys.go#L17-L66
[S34]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/xmss/README.md
[S35]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/renderer/src/pages/send-transaction/SendTransaction.tsx
[S36]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/renderer/src/pages/ReceiveTransaction.tsx
[S37]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/renderer/src/pages/ActivityPage.tsx
[S38]: https://github.com/pearl-research-labs/pearl/blob/2f8b770cac8f8b74be05c1fc51c2baeb76ce0701/apps/apps/pearl-desktop-wallet/src/main/services/wallet-process.ts#L91

## Appendix: retained P2MR probe

The following source and result are retained here so this audit does not depend on temporary workspace files. Execution used Go 1.26.6, linux/amd64, the pinned current source, default build tags (no XMSS), offline module resolution, and the already retained current-policy dependency lock from `tools/fp8-compatibility/locks/current/policy/`. The ledger implementation and host adapter are not imported by this probe. It uses synthetic chain/UTXO/sequence-lock context, not a synchronized node.

To reproduce, save the Go block as `main.go` in a new temporary directory, copy that retained `go.mod` and `go.sum` into the directory, and point its sole Pearl replacement at a clean, independently verified checkout/archive of `2f8b770cac8f8b74be05c1fc51c2baeb76ce0701`. With that release's dependencies already available, run:

```sh
GOTOOLCHAIN=local GOWORK=off go mod edit -replace=github.com/pearl-research-labs/pearl=/absolute/path/to/verified/pearl
GOTOOLCHAIN=local GOWORK=off GOPROXY=off go run -mod=readonly .
```

Recorded output:

```text
P2TR input -> P2MR recipient amount=332 dustThreshold=333 vsize=154 accepted=false
P2TR input -> P2MR recipient amount=333 dustThreshold=333 vsize=154 accepted=true
P2TR input -> P2MR recipient amount=99000 dustThreshold=333 vsize=111 accepted=true
PASS: 39 address/length/transaction cases; P2MR recipient prl1zwclfmgryh8wqgu0mpu7glgkgfd9cf5k2nyjf0sfdyf6rseu4428qgg8snh; no live network or XMSS enabled.
```

Probe source (public deterministic test key; never fund its addresses):

```go
// Public deterministic fixtures only. No network, device, credentials, or funds.
package main

import (
	"bytes"
	"fmt"
	"github.com/pearl-research-labs/pearl/node/blockchain"
	"github.com/pearl-research-labs/pearl/node/btcec"
	"github.com/pearl-research-labs/pearl/node/btcec/schnorr"
	"github.com/pearl-research-labs/pearl/node/btcutil"
	"github.com/pearl-research-labs/pearl/node/chaincfg"
	"github.com/pearl-research-labs/pearl/node/chaincfg/chainhash"
	"github.com/pearl-research-labs/pearl/node/mempool"
	"github.com/pearl-research-labs/pearl/node/txscript"
	"github.com/pearl-research-labs/pearl/node/wire"
	"strings"
	"time"
)

func must(e error) {
	if e != nil {
		panic(e)
	}
}
func check(b bool, s string) {
	if !b {
		panic(s)
	}
}
func main() {
	k, pub := btcec.PrivKeyFromBytes([]byte{1}) // Public test scalar: never fund.
	leafScript, e := txscript.NewScriptBuilder().AddData(schnorr.SerializePubKey(pub)).AddOp(txscript.OP_CHECKSIG).Script()
	must(e)
	root := txscript.NewBaseTapLeaf(leafScript).TapHash()
	tests := 0
	for _, p := range []*chaincfg.Params{&chaincfg.MainNetParams, &chaincfg.TestNetParams, &chaincfg.TestNet2Params, &chaincfg.RegressionNetParams, &chaincfg.SimNetParams} {
		for _, r := range [][]byte{make([]byte, 32), bytes.Repeat([]byte{255}, 32), root[:]} {
			a, e := btcutil.NewAddressMerkleRoot(r, p)
			must(e)
			s, e := txscript.PayToAddrScript(a)
			must(e)
			check(bytes.Equal(s, append([]byte{0x52, 0x20}, r...)), "script encoding")
			for _, input := range []string{a.String(), strings.ToUpper(a.String())} {
				d, e := btcutil.DecodeAddress(input, p)
				must(e)
				check(d.WitnessVersion() == 2 && bytes.Equal(d.WitnessProgram(), r) && d.IsForNet(p), "address mismatch")
				tests++
			}
		}
	}
	for _, n := range []int{0, 1, 20, 31, 33, 40} {
		_, e := btcutil.NewAddressMerkleRoot(make([]byte, n), &chaincfg.MainNetParams)
		check(e != nil, "root length accepted")
		tests++
	}
	owned, e := txscript.PayToTaprootScript(txscript.ComputeTaprootKeyNoScript(pub))
	must(e)
	a, e := btcutil.NewAddressMerkleRoot(root[:], &chaincfg.MainNetParams)
	must(e)
	dest, e := txscript.PayToAddrScript(a)
	must(e)
	point := wire.OutPoint{Hash: chainhash.Hash{1}, Index: 0}
	previous := wire.NewTxOut(100000, owned)
	for _, amount := range []int64{332, 333, 99000} {
		tx := wire.NewMsgTx(1)
		tx.AddTxIn(wire.NewTxIn(&point, nil, nil))
		tx.AddTxOut(wire.NewTxOut(amount, dest))
		tx.AddTxOut(wire.NewTxOut(100000-amount-1000, owned))
		if tx.TxOut[1].Value == 0 {
			tx.TxOut = tx.TxOut[:1]
		}
		fetch := txscript.NewCannedPrevOutputFetcher(owned, 100000)
		hashes := txscript.NewTxSigHashes(tx, fetch)
		tx.TxIn[0].Witness, e = txscript.TaprootWitnessSignature(tx, hashes, 0, 100000, owned, txscript.SigHashDefault, k)
		must(e)
		vm, e := txscript.NewEngine(owned, tx, 0, 0, nil, hashes, 100000, fetch)
		must(e)
		must(vm.Execute())
		must(blockchain.CheckTransactionSanity(btcutil.NewTx(tx)))
		pool := mempool.New(&mempool.Config{Policy: mempool.Policy{MaxTxVersion: 2, MinRelayTxFee: 1000, DisableRelayPriority: true, FreeTxRelayLimit: 15, MaxOrphanTxs: 5, MaxOrphanTxSize: 1000, MaxMempoolSize: mempool.DefaultMaxMempoolSize}, ChainParams: &chaincfg.MainNetParams, FetchUtxoView: func(*btcutil.Tx) (*blockchain.UtxoViewpoint, error) {
			v := blockchain.NewUtxoViewpoint()
			v.Entries()[point] = blockchain.NewUtxoEntry(previous, 1, false)
			return v, nil
		}, BestHeight: func() int32 { return 101 }, MedianTimePast: func() time.Time { return time.Unix(1700000000, 0) }, CalcSequenceLock: func(*btcutil.Tx, *blockchain.UtxoViewpoint) (*blockchain.SequenceLock, error) {
			return &blockchain.SequenceLock{Seconds: -1, BlockHeight: -1}, nil
		}, HashCache: txscript.NewHashCache(1000)})
		accepted, e := pool.CheckMempoolAcceptance(btcutil.NewTx(tx))
		if amount == 332 {
			check(e != nil && strings.Contains(e.Error(), "dust"), "dust not rejected")
		} else {
			must(e)
			check(accepted != nil && len(accepted.MissingParents) == 0, "missing acceptance")
		}
		fmt.Printf("P2TR input -> P2MR recipient amount=%d dustThreshold=%d vsize=%d accepted=%v\n", amount, mempool.GetDustThreshold(tx.TxOut[0]), blockchain.GetTransactionVsize(btcutil.NewTx(tx)), e == nil)
		tests++
	}
	fmt.Printf("PASS: %d address/length/transaction cases; P2MR recipient %s; no live network or XMSS enabled.\n", tests, a.String())
}
```
