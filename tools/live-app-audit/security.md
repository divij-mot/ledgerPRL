# Bounded security review of the Pearl Live App

Reviewed on 10 October 2026 by an independent AI review agent in the same working session. This is **AI source review and host-test evidence**, not a human audit, external assurance, Ledger approval, or release certification. No hardware access, installation, seed access, network probe, broadcast, or funded transfer was performed by this reviewer.

## Result and source identity

No reproducible security or transaction-correctness blocker was identified in the reviewed scope. This does not establish absence of vulnerabilities or readiness for funds. In particular, approximately 10 PRL is the owner's intended trial size, not an enforced wallet cap or an amount this review certifies as safe.

The working tree was based on `96aa2e09a7f87ffbb8474c6825c575fa8cec0a27` and contained substantial uncommitted changes. Git HEAD alone therefore does not identify the reviewed implementation. [The source digest inventory](security-source-sha256.txt) records the final reviewed source checkpoint; inclusion in that inventory does not imply every inherited line was audited. Later code changes require checking which review conclusions and tests remain applicable. The initial review had no separate source digest snapshot.

## Initial review

The initial pass examined the following security boundaries independently of earlier pass/fail summaries:

- Native C signer: the closed PSBTv2 profile, network/genesis binding, fixed BIP86 account paths, input and change ownership, duplicate outpoints, amount/aggregate bounds, default sighash restrictions, device review fields, signature generation and final signature-yield acknowledgement.
- TypeScript adapter and SDK: strict PSBT maps, exact integer amounts, account snapshots, key/index/signature verification, final transaction comparison, terminal sessions, and retaining a complete verified transaction before acknowledging the final device yield.
- Companion: signing reservations, strict journal mutation and recovery, cancellation and stale-result boundaries, explicit broadcast approval, same signed-byte retries, fixed indexer destinations, bounded proxy reads, and native transport routing/cleanup.
- Physical pilot runner: opt-in execution, private output permissions, status-word retention, synthetic transaction construction, durable-before-ACK handling, and evidence identity limitations.

The reviewer ran 73 targeted tests: **73 passed, zero failed**. These were the adapter `client` and `psbt` tests, companion `wallet-api`, `device-routing` and `storage-integrity` tests, and wallet `journal-integrity` tests.

Two evidence limitations were reported to the implementation owner. First, the physical runner stores the caller-provided candidate hash and current Git HEAD; it does not independently attest the installed application or identify the dirty working tree. Separately recorded installation/hash verification and source provenance are necessary. Second, direct ledgerblue HID signing does not qualify the actual Ledger Wallet bridge's signing, cancellation, or reconnect behavior. Neither point was presented as a demonstrated signing vulnerability.

## Final change review

After the feature changes, the reviewer checked the final production paths and repeated an expanded set of targeted tests.

| Change | Boundary checked | Result |
| --- | --- | --- |
| Separate WebHID and Live bootstraps | Registration is one-time, missing/mismatched configuration fails before invoking a transport, pathname is checked per connection, and WebHID connector invocation remains synchronous | No fallback or activation regression identified; real router tests passed |
| Fee estimates | Only exact read-only `/api/v1/estimatefee/1`, `/10`, and `/25` routes are added; fixed HTTPS destinations, no redirects, existing origin/host checks, and 1 KiB fee response limit remain enforced | No arbitrary URL, command, address-key disclosure, or enlarged fee response boundary identified |
| Fee units and application | Decimal strings are parsed into integer grains; fees round upward by virtual size; the calculation is bounded, estimates expire after two minutes, network mismatch/future timestamps fail, reservations are refreshed, and applying a quote requires an explicit choice | Host tests passed; no silent automatic fee replacement or transaction authorization was added |
| Max | Chooses at most 16 eligible unreserved inputs, honors manual selection, keeps amounts above 2^53 exact, subtracts the explicit fee, and calls the existing preparation policy for ownership, relay minimum and dust checks | Tests verify exact conservation and no change output; no signing or broadcasting occurs from Max |
| New receive address and QR | Verification is cleared before advancing, refreshed journal high-water bounds are honored, index 979 is capped, and the recovery range is saved before device verification; QR and Copy require the exact verified address | Actual-main tests passed, including QR content, storage-before-device ordering, rejection, cancellation, cross-tab bounds and range exhaustion |
| Activity presentation | Pagination preserves underlying records; copied transaction IDs are exact; confirmation counts require confirmed state and the exact validated history tip | Tests passed; no journal release or broadcast authority added |

For fee-unit verification, the reviewer read the locally retained official Pearl source used by the parity review: `node/mempool/estimatefee.go` uses `GetTransactionVsize`, and its `ToPrlPerKb` conversion multiplies grain/vB by 1000 and 1e-8. The official desktop Blockbook client uses `/api/v1/estimatefee/{target}`. This supports the conversion used here; it does not establish that today's remote endpoints return a usable quote. Source provenance is described in [the independent parity review](lean-parity.md#source-basis).

The final expanded run passed **113 tests, zero failed** using the bundled Node 24 runtime. The UI test wrappers execute mocked DOM/storage/source/device scenarios against the actual companion controller; they are not browser or physical-device qualification.

```sh
node --import tsx --test \
  packages/bitcoin-prl-adapter/test/client.test.ts \
  packages/bitcoin-prl-adapter/test/psbt.test.ts \
  apps/companion/test/wallet-api.test.ts \
  apps/companion/test/device-routing.test.ts \
  apps/companion/test/storage-integrity.test.ts \
  packages/wallet/test/journal-integrity.test.ts \
  apps/companion/test/coin-selection.test.ts \
  apps/companion/test/fee-quotes.test.ts \
  apps/companion/test/fee-policy.test.ts \
  apps/companion/test/activity.test.ts \
  apps/companion/test/direct-wallet-ui.test.ts \
  apps/companion/test/public-lifecycle.test.ts \
  apps/companion/test/indexer-proxy.test.ts \
  apps/companion/test/public-source.test.ts \
  apps/companion/test/blockbook.test.ts
```

Subsequent presentation-only cleanup changes the blank-amount prompt, shows the minimum in PRL, and hides unsupported/empty estimate controls. It does not change quote, Max, signing, storage, or broadcasting policy. The fee-policy and direct-wallet-UI wrappers were rerun after that cleanup: **2 passed, zero failed**, including their 9 and 24 internal scenario checks. The 204-entry source/configuration digest inventory was then recorded.

## Remaining coverage and operating limits

- This reviewer did not rerun native compilation, emulator tests, physical-device tests, or independent consensus-oracle tests. Prior [native evidence](../live-app-native-review/README.md) and [physical evidence](../live-app-physical-review/README.md) are separate results, not newly established by this review.
- End-to-end signing, rejection/cancellation and reconnect inside actual Ledger Wallet remain distinct from direct HID and mocked host testing. Public-chain discovery, fee quotes, funded broadcast and confirmation are also not established by these host tests. The last reported public-service checks timed out before address disclosure.
- The public backend's chain and mempool view is trusted. Genesis binding, raw transaction parsing and consistency checks are not SPV or independent consensus validation. Backend omission/staleness and changing relay policy remain operational concerns.
- Browser storage can be lost through profile/origin/partition changes or user action. Local journal checks and signed recovery do not make browser storage an indestructible backup. Preserve the documented stable origin/manifest partition and exported recovery artifacts.
- No full formal verification, exhaustive inherited C/SDK/dependency audit, side-channel assessment, malicious firmware/host attestation, or future-network-upgrade qualification was performed. P2MR recipients do not imply P2MR/XMSS custody or script-path signing support.
- Root-level final build/typecheck/full-suite, supply inventory, source graph and final commit checks belong to the delivery checkpoint. They should not be inferred from this bounded review's targeted counts.
