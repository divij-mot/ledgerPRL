# Source-file modification notices

Inspection and authorized comment-only correction, 2026-10-09. This is a technical notice-presence and byte-transformation assessment, not legal certification or a choice of project license. No native build, C execution, firmware, emulator or device was used.

## Result

Comparison against the recorded Git blobs for LedgerHQ/app-bitcoin commit `44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a` identified **34 modified upstream C/header files**. Only `src/ui/menu_nbgl.c` already had an explicit early `Pearl adaptation` statement. Three other files had incidental/deep Pearl policy comments, which did not clearly function as prominent file-modification notices. The remaining changed files had no such local-change statement.

All six copied TypeScript host modules already begin with the exact pinned upstream origin and `local changes recorded in provenance/upstream.patch`. Their byte/patch/license provenance verifier passes. **They were not edited.** The existing `menu_nbgl.c` notice was retained unchanged.

The coordinator then specifically authorized adding this exact single line to the other **33** C/header files:

```c
/* Modified for Pearl (PRL). Upstream provenance: UPSTREAM.json. */
```

The 68-byte line, including its LF, was prepended to each file. **Every original byte is preserved as an identical suffix**, including all existing copyright/license bodies. There were no other source changes by this attribution update. The independent canonical-parser reviewer was notified immediately before and after the update, so its final source inventory can use post-notice hashes.

## Traceability and verification

- `source-notices.json`: frozen pre-notice inventory, upstream blob identities, inspected file SHA-256 values and original notice observations.
- `missing-source-notices.txt`: exact frozen list of the 33 files corrected.
- `source-notice-transformation.json`: exact notice bytes, per-file before/after SHA-256, before/after byte lengths, and explicit comment-only transformation checks.
- `source-notices-current.json`: separate post-change inspection, preserving the pre-change evidence.
- `verify-source-notices.py`: a read-only check that every current file matches its recorded post-notice hash and that stripping exactly the prefix restores its original recorded hash/length.
- `add-source-notices.py`: retained one-time transformation implementation. It refuses changed/already-noticed inputs and is not a build or CI step; do not rerun it to apply additional edits.

Run the read-only checks from the repository root:

```sh
python3 tools/dependency-supply-review/verify-source-notices.py
python3 tools/dependency-supply-review/inspect-source-notices.py
python3 packages/bitcoin-prl-adapter/provenance/verify_upstream.py
```

All 33 exact prefix/removal-equality checks and `git diff --check` passed. The post-change inspection finds no missing early change notice among the 34 modified upstream C/header files. All original line numbers in the 33 edited files shift by **+1**. Source hashes changed; comments/line-number changes are not a claim of equal rebuilt binaries or a reason to inherit prior native qualification. No native rebuild was attempted.

## Exact changed-file list

All paths below are relative to `apps/ledger-bitcoin-prl/`:

- `src/boilerplate/dispatcher.c`
- `src/commands.h`
- `src/common/buffer_ext.c`
- `src/common/buffer_ext.h`
- `src/common/parser_ext.c`
- `src/common/parser_ext.h`
- `src/common/wallet.c`
- `src/constants.h`
- `src/handler/get_extended_pubkey.c`
- `src/handler/get_master_fingerprint.c`
- `src/handler/get_wallet_address.c`
- `src/handler/handlers.h`
- `src/handler/lib/get_merkle_leaf_hash.c`
- `src/handler/lib/get_merkle_leaf_index.c`
- `src/handler/lib/get_merkle_preimage.c`
- `src/handler/lib/get_merkleized_map.c`
- `src/handler/lib/get_preimage.c`
- `src/handler/lib/policy.c`
- `src/handler/lib/psbt_parse_rawtx.c`
- `src/handler/lib/stream_preimage.c`
- `src/handler/sign_psbt.c`
- `src/handler/sign_psbt.h`
- `src/handler/sign_psbt/extract_bip32_derivation.c`
- `src/handler/sign_psbt/init_global_state.c`
- `src/handler/sign_psbt/preprocess_inputs.c`
- `src/handler/sign_psbt/preprocess_outputs.c`
- `src/handler/sign_psbt/process_in_outs.c`
- `src/handler/sign_psbt/sign_input.c`
- `src/handler/sign_psbt/transaction_display.c`
- `src/main.c`
- `src/ui/display.c`
- `src/ui/display.h`
- `src/ui/display_nbgl.c`

## Scope distinctions

`src/ui/menu_nbgl.c:18` already explicitly states a Pearl adaptation. `src/boilerplate/prl_review_io.c` is a new path with an explicit early SDK-adaptation/Pearl-change notice. `src/prl.h` is a new path with an early Pearl-adaptation notice. No additional notice was added to those files.

The other newly introduced paths are `src/boilerplate/prl_review_io.h`, `src/handler/get_network_info.c`, `src/handler/sign_psbt/prl_psbt.c`, and `src/handler/sign_psbt/prl_psbt.h`. They have no same-path upstream app-bitcoin blob, so this narrow comparison does not classify them as modified copies requiring the above correction. This does not prove entirely original authorship or resolve their existing license declarations.

The six already-noticed host modules are `buffertools.ts`, `clientCommands.ts`, `merkle.ts`, `merkleMap.ts`, `policy.ts`, and `varint.ts` under `packages/bitcoin-prl-adapter/src/upstream/`. Their existing top-of-file notices already explicitly identify local changes and recorded provenance, so a redundant comment would only churn their source hashes.

The retained Apache-2.0 file's section 4(b) is the local source of the modified-file-notice requirement. The repository's root license and provenance records are useful but do not themselves place an explicit change statement inside each modified source file. This check addresses that concrete documentation gap only.
