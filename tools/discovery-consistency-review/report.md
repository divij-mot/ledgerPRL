# Independent discovery consistency review

Reviewed 2026-10-09. Result: no blocking defect found in the authorized discovery consistency correction. All **32 independent offline tests pass**, and the isolated TypeScript check passes.

Reviewed production file: `packages/wallet/src/discovery.ts`.

Final-source SHA-256: `4f003ef5792ef1088f5fcd60f895d0ae7c787e80e9276a1787dc194ba07df8a2`.

The final source differs from the initially reviewed `4885d5376549fced73aa5cbf5ad2b81419ab34e11b3f6c4fa145fb3d1f4bbfaf` only in a two-line comment clarifying that the zero-value binding checks concern remaining unspent candidates. Reversing that comment alone reproduces the original reviewed hash exactly; `source-binding.log` records that check. All 32 tests and the isolated TypeScript check were replayed successfully against the final source above.

The independent reviewer made no production edits. Test artifacts are confined to this directory. The production correction was coordinated with the patch owner.

## What the correction establishes

- A listed history transaction must create the exact queried script, or reference a supplied previous output with that exact script. Merely involving another address in the same account no longer authenticates the address-history claim.
- Raw-script involvement is computed after all supplied transactions have been parsed, so transaction ordering does not break valid spent-only history.
- Inputs with unavailable unrelated prevouts are not fetched or rejected when other raw evidence already establishes the queried address's involvement.
- Every UTXO candidate's funding transaction must appear in that address's history.
- A positive confirmed output to a scanned owned script must have a UTXO candidate or a supplied parsed pending/confirmed spend. A contradiction rejects the scan instead of synthesizing a coin or publishing a completed zero balance.
- Pending outputs remain optional in the UTXO response. Supplied pending spends still remove stale confirmed candidates.
- Shared receive/change histories deduplicate transaction fetching/account totals without confusing per-address relevance.
- Zero-valued matching scripts still establish use. Remaining unspent zero-valued candidates undergo output-ownership and block-height checks, then are excluded from coins and validation.

## Independent test coverage

The suite covers:

1. Honest empty-account gaps and exact received values on both branches.
2. Cross-branch funding attribution, including repeated false use through index 979, must reject rather than return a poisoned checkpoint.
3. Spent-only address use, reverse transaction ordering, known matching prevouts with unrelated unknown inputs, and rejection of unknown/mismatched spent-only claims.
4. Complete and partial omitted positive confirmed outputs, including a second scanned branch, and candidates absent from address history.
5. Pending spends with and without stale UTXO entries, optional pending outputs, and reported pending outputs excluded from confirmed validation.
6. Overlapping receive/change histories, zero-only and mixed-value activity, zero candidates omitted from coins, and retained unspent-candidate ownership/height checks.
7. Inconsistent `used` metadata, changing tips, detached blocks, and contradictory confirmation counts.
8. No mutation of supplied account/options/history/source rows or local recovery-journal values on rejection; code after the failed scan is not reached. Detached-history construction leaves previous history unchanged.
9. Recovery bounds, 257-candidate rejection, 2,001-transaction rejection, aggregate 20,000-reference budget, per-transaction raw size, and 3 MiB aggregate raw-hex budget.
10. A consistently empty source remains accepted, explicitly demonstrating the remaining source-trust boundary.

Source review of `apps/companion/src/main.ts` additionally confirms that discovery must resolve before `store.mutate`, checkpoint assignment, snapshot/history replacement, and `syncComplete = true`. A discovery rejection therefore cannot persist that result's false high-water marks. The existing pre-scan journal refresh and `syncComplete = false` safety transition still occur. This is source inspection plus a host-side rejection/non-mutation test, not a browser/IndexedDB concurrency test.

## Trust boundaries and scope limits

This is **internal source-view consistency, not a proof of UTXO completeness, SPV, consensus validity, transaction inclusion, or valid signatures**. These public synthetic transactions have not been broadcast, signed, or validated against a chain.

A dishonest trusted indexer can still omit entire histories consistently, hide outputs beyond the bounded discovered range, or invent an unvalidated pending spend referencing a known owned outpoint. That fabricated supplied spend can suppress a candidate and satisfy the omitted-output consistency check. The parser establishes what those supplied bytes reference; it does not establish that the spender is valid, authorized, accepted, or actually in a mempool. Block hashes, confirmations, inclusion, and current unspentness continue to depend on the selected source. Stable start/end tips do not authenticate those claims.

Candidates already referenced by a supplied spend are deliberately discarded before their output ownership/height checks, preserving existing stale-endpoint handling. This also applies to spent zero-valued candidates. Discarded candidates cannot become selectable; validation-before-zero-skip applies to the remaining unspent candidates. This is inherited ignored-data behavior, not an identified custody exploit, and stricter stale-endpoint semantics were outside this correction.

No native builds, emulator/hardware execution, browser/live network use, installation, real transactions, or secrets were involved. Focused host tests are not full release qualification.

## Reproduce

From the repository root, using the already installed dependencies:

```sh
node --import tsx --test tools/discovery-consistency-review/discovery-consistency.test.ts
node node_modules/typescript/bin/tsc --noEmit --project tools/discovery-consistency-review/tsconfig.json
```

Evidence: `offline-tests.log` (32 passed, zero failed) and `typecheck.log` (empty output, exit 0).
