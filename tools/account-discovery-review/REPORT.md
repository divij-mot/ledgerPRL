# Account discovery and recovery integrity review

## Outcome

Offline review identified and corrected two detectable source-consistency gaps. Neither establishes an ownership/signature bypass or removes the documented need to trust the indexer's chain view. The initial 15 local probes passed, including four probes demonstrating acceptance of inconsistent responses. The final 23 review probes, 99 standard wallet tests and wallet TypeScript check pass; a separate reviewer also passed 32 independent probes.

Scope: public-account import, Ledger-policy xpub decoding, receive/change derivation, bounded discovery, saved ranges, raw-output ownership, balance and selection. Reviewed baseline: `83be58f9288e35022b5cc43eff8288983ced5bc3`; exact source hashes are in `source-before.json`. There was no repository `AGENTS.md`; the task's supplied rules and execution limits were followed. No network, browser, native code/build/emulator, SDK change, physical device, installation, secrets, signing or broadcast was used.

## AD-01: unrelated per-address history can poison durable recovery ranges

**Impact: medium availability/integrity hardening; malicious or defective trusted indexer required.**

Baseline `packages/wallet/src/discovery.ts:125–146,230–242,279–293` records a derived script globally but loses its association with each address history. Raw transaction relevance is checked against *any* scanned account script, rather than the address whose `used` status extended the scan.

Reproduction: an ordinary transaction pays receive `/0/0`. The same ID is returned as the sole history for change `/1/19`, with matching confirmed counts and no change UTXO. Discovery accepts `lastUsed:[0,19]`. Returning the same record at change indexes `19,39,…,979` accepts `lastUsed:[0,979]` and coverage through 999. There is only one actual account transaction and no raw output or input involving those change scripts.

`apps/companion/src/main.ts:413–414` persists those maxima. `nextChangeIndex=980` survives a subsequent honest scan and public recovery export/import. `reservePayment` rejects older change indexes while the public UI permits only indexes below 980, so ordinary change-producing light-mode payments become unavailable. This does not produce attacker-owned change. Do not automatically lower previously stored maxima: an authentic issued address may legitimately require them.

Implemented correction: retain the requested script with each history and require each listed transaction to create that script or spend a matching previous output already present in the supplied raw history. Inconsistent usage fails before a discovery result can be persisted. Unknown external prevouts require no lookup when the transaction directly creates the queried script. There is no chain-inclusion claim.

## AD-02: complete-history and UTXO endpoints can contradict each other

**Impact: medium displayed-balance/selection consistency hardening; trusted indexer required.**

Baseline `discovery.ts:159–166,230–275` checks reported history counts and validates each returned UTXO, but does not cross-check their membership.

- A confirmed owned output appears in the supplied full history, with no supplied pending or confirmed spend. An empty UTXO response yields `complete:true`, a positive history receipt and zero available balance.
- A UTXO whose funding ID is absent from its address's purportedly complete history is added to the global transaction set and accepted. A response claiming one historical transaction can produce two history rows and two selectable outputs.

Implemented correction: require every candidate UTXO's funding transaction in the corresponding address history. For a positive confirmed owned output in supplied history, reject/retry if neither a supplied spend nor a candidate UTXO accounts for it. No inferred spendable coin is created. Parsed pending spends still override stale UTXO reports; pending outputs are not required to appear because endpoint inclusion semantics are uncertain. Reorg/tip-change checks remain required.

Related correction: genuine zero-valued owned outputs now establish address usage even when account received/spent totals are zero. A remaining unspent zero-value candidate must pass ownership and height checks, then is excluded from selectable coins. The inherited early exclusion of already-spent candidates is unchanged: their potentially stale UTXO metadata is ignored and they cannot create coins. Legitimate shared receive/change history and spent-only address history remain accepted.

## Verified boundaries and intentional limitations

- Public JSON imports reject unknown fields, invalid network/index, malformed chaincode/fingerprint and invalid compressed curve points. Ledger transport xpubs additionally require canonical Base58Check, exactly 78 decoded bytes, the selected xpub/tpub version, depth 3 and the hardened account index.
- Imported account/path/fingerprint labels cannot prove hardened ancestry. Changing those labels can preserve public child addresses. Matching device-account checks compare the network, account, fingerprint, public key and chaincode before signing/receive verification. This is expected watch-only behavior, not authenticated account import.
- An independent public CKD/TapTweak implementation matched branch 0 and 1 at indexes 0, 19, 979 and 2,147,483,647. No private material was used.
- Both branches scan through 20 unused addresses after observed or saved usage. A bare account correctly stops before funds at receive index 20 or change index 47 if no earlier usage exists. Saved high-water records recover both. Index 980 as a required used/issued bound fails closed because its trailing gap cannot fit below index 999. Account-number discovery and an extended scan are not implemented.
- Owned output scripts, exact raw amounts and txids are checked. Wrong network/genesis, a substituted raw transaction or wrong derivation path fails. Parsed pending spends exclude stale UTXOs and prevent their selection.
- A fully consistent fabrication of raw funding bytes, matching hashes, alleged inclusion, confirmations and unspent status can still pass discovery and input freshness. That is explicitly within `SECURITY.md` and `docs/companion.md`'s trust model: there are no authenticated headers/Merkle proofs, independent consensus or proof of complete history/mempool. These corrections do not change that boundary.
- `complete:true` means the bounded scan completed consistently against the chosen source. It is not proof that all account funds exist in the result. Local-node mode checks imported outputs; it does not discover missing addresses. Public-account-only recovery does not restore reservations or signed bytes; full wallet backups are necessary for that purpose.

## Reproduction and evidence

From the repository root, using already-installed dependencies:

```
node --import tsx --test tools/account-discovery-review/account-discovery.test.ts
node node_modules/typescript/bin/tsc -p tools/account-discovery-review/tsconfig.json
```

`before-fix-tests.log`, `before-fix.test.ts.txt` and `discovery.before.ts.txt` preserve the original reproduction and original discovery source. The four `GAP` probes intentionally assert baseline acceptance; after correction, their maintained equivalents assert rejection. Tests call production `BlockbookSource` with an in-memory response function, never global network fetch.

The standard wallet runner includes the 13 new tests in `packages/wallet/test/discovery-integrity.test.ts`; this protection is not limited to the review directory.

- `offline-tests.log`: 23/23 final review probes
- `wallet-tests.log`: 99/99 standard wallet tests, including 13 added regressions
- `targeted-regressions.log`: 52/52 existing discovery, watch, recovery, Blockbook and mocked browser-source tests
- `typecheck.log` and `wallet-typecheck.log`: successful TypeScript checks
- `../discovery-consistency-review/report.md`: separate independent review, 32/32 probes and isolated TypeScript check
- `discovery.patch`, `source-before.json`, `source-after.json` and `results.json`: exact changes and verification identities

## Correction status

The only production file edited by this review is `packages/wallet/src/discovery.ts`, final SHA-256 `4f003ef5792ef1088f5fcd60f895d0ae7c787e80e9276a1787dc194ba07df8a2`. Standard and review tests are frozen for the parent's combined verification. No stored high-water marks are lowered or mutated by discovery before full validation.

This review did not edit `apps/companion/src/main.ts`, SDK or native sources. The parent independently changed main.ts during the review; its initial hash was `a1bfd6960626b1d397ffa4db5366da7633af6a47f656392319da650823bf12b7` and its observed final hash is recorded separately in `source-after.json`. Native/browser/live-service and physical-device qualification remain out of scope and unrun. The focused checks here do not replace the parent's whole-repository validation.
