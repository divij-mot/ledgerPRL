# Source-only parser correction status

Status: implemented in source, awaiting independent static review and future authorized native qualification. No compilation, native test, emulator, device operation, capacity test, or native harness was performed or created. This document does not claim the firmware builds or that executable behavior has passed.

The parent explicitly authorized the two bounded corrections after the static findings in `REPORT.md`. The exact production diff relative to `03112c09890fb08c48a83e743d842fdbd791c29c` is preserved as `source-only.patch`. The pinned SDK checkout remains at `6709cd2bdfebb224ee070f7c1211b54254262579` with no working-tree changes. No global macro replacement, runtime feature, policy expansion, or dependency modification was made.

## Exact production files

All paths below are under `apps/ledger-bitcoin-prl/src/`:

1. `common/buffer_ext.c`: add the app-local canonical single-buffer decoder, with a temporary buffer descriptor and encoded-length equality against `varint_size`. The original offset and output are assigned only after success. Empty/exhausted/invalid-offset buffers are rejected before calling the SDK reader.
2. `common/buffer_ext.h`: declare and document the unchanged-offset/output failure contract.
3. `common/parser_ext.c`: change the two-buffer reader to return `-1/0/1`; decode through temporary descriptors, reject nonminimal encoded width, and commit both offsets/output only on canonical success.
4. `common/parser_ext.h`: document the tri-state result and unchanged-offset/output failure contract.
5. `common/wallet.c`: use canonical decoding for descriptor length and key count; initialize the xpub/checksum decode destination and require exactly its full byte size before checksum access.
6. `handler/lib/get_merkle_leaf_index.c`: canonical leaf-index response decoding.
7. `handler/lib/get_merkle_preimage.c`: canonical Merkle preimage length decoding.
8. `handler/lib/get_merkleized_map.c`: canonical committed-map size decoding.
9. `handler/lib/get_preimage.c`: canonical wallet/descriptor preimage length decoding.
10. `handler/lib/psbt_parse_rawtx.c`: update all six two-buffer reader callers, retaining `int` status; the four length/count steps execute their existing state/hash logic only under `result == 1`, while the two witness steps return any non-1 result immediately. Existing parser and callback error propagation remains intact.
11. `handler/lib/stream_preimage.c`: canonical streamed preimage length decoding.
12. `handler/sign_psbt/init_global_state.c`: canonical APDU global-map size and input/output count decoding.

This accounts for ten reachable single-buffer call sites. The SDK reader itself remains unchanged. The only direct production uses of the permissive SDK reader outside the new wrapper are in REGISTER_WALLET and SIGN_MESSAGE, neither of which is in the current command table. Enabling either command in a future profile requires revisiting that assumption.

The implementation preserves the output on failure rather than clearing it. This is the parent's explicit no-offset/output-commitment requirement; every changed caller checks status before use, and no caller relies on a newly cleared output value. Failed incomplete/malformed reads cannot consume bytes and later reinterpret a replacement as the same field. Negative results are never coerced to `bool` at the six rawtx call sites.

## Source inspection performed

- Inspected the entire scoped diff and all CompactSize call sites in production source.
- `git diff --check -- apps/ledger-bitcoin-prl/src` reported no whitespace errors. This is a text/diff check, not a compiler or test run.
- Searched production and test source for reader references to identify stale boolean/negation callers. The six production two-buffer uses are all in `psbt_parse_rawtx.c` and have explicit tri-state propagation.
- Re-read the SDK varint read/write/size implementation and Base58 decoder source; the app wrapper's encoded-length check relies only on the pinned SDK's existing shortest-width `varint_size` behavior.
- Inspected `git status --porcelain` and the revision of the SDK checkout; no SDK modifications were present.
- Left unrelated companion/browser review changes untouched.

## Future tests remain unexecuted

The regression requirements in `REPORT.md` remain pending. In particular:

- Canonical integer boundary values and every nonminimal wider encoding.
- Every byte split for one/two-buffer reads, unchanged sentinel outputs/offsets on incomplete or malformed input, and successful decoding only after a complete canonical value.
- Malformed bytes followed by valid-looking bytes must remain a fatal rawtx error, rather than a retry on the later bytes.
- All ten APDU/Merkle/wallet boundaries and all six rawtx integer positions.
- A recomputed valid Merkle commitment containing the normalized-previous-tx counterexample must be rejected.
- Full-size valid xpubs retain acceptance; short successful Base58 decodes are rejected before fixed-size checksum access.
- Later native builds and regression/capacity/hardware checks must use the final reviewed source and newly attributed binaries. Earlier firmware/test evidence does not qualify this changed source.

No executable artifacts or test results were regenerated or relabeled by this task.
