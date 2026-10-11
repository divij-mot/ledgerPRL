# Independent static review of canonical parser hardening

## Result

No correctness defect or missing reachable call-site conversion was found in the reviewed patch. The source changes implement canonical CompactSize reads transactionally, preserve malformed versus incomplete raw-transaction results through all six callers, and reject short Base58 xpub decodes before checksum use.

This is a bounded **static source review**, not a runtime-test pass, firmware qualification, or security certification. No compiler, build, native executable, harness, emulator, device, network request, or native test was run. Only source/text inspection and this report were performed; the reviewer made no production changes.

## Reviewed snapshot and scope

- Local baseline and current `HEAD`: `03112c09890fb08c48a83e743d842fdbd791c29c`.
- App: `apps/ledger-bitcoin-prl` (`APP` below).
- SDK: `apps/ledger/vendor/ledger-secure-sdk` (`SDK` below), at `6709cd2bdfebb224ee070f7c1211b54254262579`. Its working tree was clean.
- Reviewed app diff: 12 files, 85 insertions, 40 deletions. SHA-256 of `git diff 03112c09890fb08c48a83e743d842fdbd791c29c -- apps/ledger-bitcoin-prl`: `87288ad757c30b0dd0fbbaa4ae8de01efbcbe97ed0de74add84034b5178b461d`.
- The implementing reviewer confirmed the production edits were ready and no further production changes were planned. `tools/native-parser-review/REPORT.md` was read as a proposal, then checked independently against the actual source and SDK APIs.
- The remote revision supplied in the handoff was not resolvable in this local object database. No fetch was attempted under the no-network constraint; remote-tree equivalence is not independently asserted by this review.
- `git diff --check -- apps/ledger-bitcoin-prl` returned no whitespace errors. This is a text check, not a native test.

### Final attribution-only source update

After the semantic review, a separately authorized attribution pass prepended one 68-byte C comment line to 33 app C/header files, including all 12 parser-patch files. Its per-file before/after hashes and exact original-suffix checks are recorded in `tools/dependency-supply-review/source-notice-transformation.json`. The final diff was inspected again: the parser changes are unchanged, and the additional edits are modification notices.

Final app diff versus the same baseline: 33 files, 118 insertions, 40 deletions; SHA-256 `2aaebf5901f50b010e6766fe498bd177101c1787cc5e9b93a5ef333fa5f2848e`. The final text whitespace check also returned no errors. No native execution was added.

Source line references below describe the pre-notice reviewed snapshot. Add **1** to line numbers for app files listed in the transformation mapping. SDK, host TypeScript, CMake, and other unlisted files did not shift. The earlier semantic diff hash and this final diff hash deliberately identify different source snapshots; neither is presented as a tested binary.

## 1. Single-buffer canonical reader

`APP/src/common/buffer_ext.c:30-45` defines the new app-local wrapper; its declaration and failure contract are in `buffer_ext.h:10-14`.

The source establishes these properties:

1. An empty/exhausted descriptor, including an offset beyond size, returns false before pointer arithmetic or SDK decoding.
2. Decoding occurs against a copied `buffer_t` and a local `uint64_t`. Neither caller offset nor caller output is written by the SDK call.
3. SDK `buffer_read_varint` uses `varint_read`, then checked `buffer_seek_cur` (`SDK/lib_standard_app/buffer.c:130-140`). On success, the offset difference is exactly the consumed prefix-selected width; on failure, short-circuit evaluation prevents use of the local decoded value.
4. Comparing that difference to `varint_size(decoded)` rejects every overlong form. SDK `varint_size` returns 1 for values through 252, 3 through 65535, 5 through 4294967295, and 9 thereafter (`SDK/lib_standard_app/varint.c:25-40`). Successful checked seeking prevents wrapping subtraction in the wrapper.
5. Only canonical success commits the offset and output. The final requested behavior is **unchanged output on failure**, matching the header. The proposal's earlier suggestion to clear the output was not the final contract. No converted caller consumes a failed read's output.

### Complete reachable conversion inventory

| Input boundary | Canonical reader site | Failure behavior |
|---|---|---|
| SIGN_PSBT global-map size | `src/handler/sign_psbt/init_global_state.c:69` | Send `SW_WRONG_DATA_LENGTH`, return false |
| SIGN_PSBT input count | Same file, `:83` | Same; existing positive/count cap remains |
| SIGN_PSBT output count | Same file, `:97` | Same; existing positive/count cap remains |
| Wallet descriptor-template length | `src/common/wallet.c:120` | Return wallet parse error before using length |
| Wallet key count | Same file, `:146` | Return parse error; existing `<=252` cap remains |
| Committed map size | `src/handler/lib/get_merkleized_map.c:40` | Return -1; map remains unvalidated |
| Plain preimage length | `src/handler/lib/get_preimage.c:33` | Return -2; public wrapper clears output |
| Merkle preimage length | `src/handler/lib/get_merkle_preimage.c:41` | Return -2; public wrapper clears output |
| Streamed preimage length | `src/handler/lib/stream_preimage.c:35` | Return -2 before length/data callbacks |
| Merkle leaf index | `src/handler/lib/get_merkle_leaf_index.c:35` | Return `MERKLE_LEAF_ERROR`, not NOT_FOUND |

These ten sites retain their existing numeric bounds, capacity checks, and exact-consumption checks. Short-circuit conditions prevent uninitialized temporary values being evaluated after a failed read.

The remaining direct SDK reader sites in app production source are the wrapper itself and the REGISTER_WALLET / SIGN_MESSAGE handlers. Those commands are absent from the dispatch table (`APP/src/main.c:52-78`), so their omission is consistent with the requested reachable strict-profile scope. This review does not claim that every inherited command was converted.

## 2. Two-buffer reader and partial-input behavior

`APP/src/common/parser_ext.c:68-120` and `parser_ext.h:91-101` consistently declare an `int` tri-state result: 1 canonical success, 0 incomplete, -1 nonminimal/malformed.

- Prefix peeking does not advance either original descriptor. For reachable calls, the first descriptor is the bounded carry buffer and the second is the current bounded preimage chunk; they are distinct descriptors with valid offsets.
- The complete prefix-selected width (1, 3, 5, or 9 bytes) is required before decoding begins. A partial FD/FE/FF encoding returns 0 with both offsets and output unchanged.
- Each descriptor is then copied. Byte reads advance only the copies. The existing `dbuffer_read_bytes` exhausts the first buffer before consuming the second, so prefix and payload can cross any split boundary without changing their concatenated byte sequence.
- Payload lengths are only 2, 4, or 8; the zero-initialized 8-byte array is read little-endian using `read_u64_le`. This preserves the existing interpretation at every width, with no narrowing or signed payload arithmetic.
- `1 + len` is at most 9 and is compared with the SDK's canonical width. A complete overlong encoding returns -1 without committing either offset or output. Full-width FF values above UINT32_MAX, including UINT64_MAX, remain valid reader results; individual callers can still reject them under their width caps.
- Success commits both copied offsets and the decoded value. Reader failure does not rewind earlier successfully parsed fields, nor is it intended to; the transaction boundary here is the integer read.

The SDK buffer helpers assume valid buffer descriptors. The two-buffer helpers also assume valid offsets and bounded total lengths. The actual rawtx callback constructs distinct valid descriptors over a 32-byte carry array and bounded preimage data (`psbt_parse_rawtx.c:545-546`; `stream_preimage.c:77,117`). This patch does not add a general-purpose defense for arbitrary corrupted descriptors or aliased descriptor pointers, and none is needed to establish the reviewed reachable behavior.

### Boundary reasoning (not executed cases)

| Decoded value | Required width | Source-derived result for canonical form |
|---|---:|---|
| 0, 252 | 1 | Success |
| 253, 65535 | 3 | Success |
| 65536, 4294967295 | 5 | Success |
| 4294967296, UINT64_MAX | 9 | Success at reader level |

For any FD value below 253, FE value below 65536, or FF value below 4294967296, the encoded width differs from `varint_size`, producing malformed rather than incomplete. This includes zero encoded at every wider width. A truncated wider encoding remains incomplete until all selected bytes arrive; that distinction is intentional.

## 3. All six rawtx callers and fatal propagation

The six production calls to `dbuffer_read_varint` all occur in `APP/src/handler/lib/psbt_parse_rawtx.c`:

| Field | Reader call | Result handling |
|---|---:|---|
| Input scriptSig length | 105 | `int result`; use/hash only under `result == 1`; return result |
| Output scriptPubKey length | 200 | Same |
| Input count | 345 | Same |
| Output count | 392 | Same |
| Witness stack-element count | 458 | `int result`; return immediately unless 1 |
| Witness element length | 477 | Same |

No caller stores the tri-state return in `bool`, checks it with logical negation, or treats -1 as a successful parse. All six preserve existing UINT32_MAX checks before narrowing values to the parser's counters. The first four do not hash a malformed integer; witness state flags/counters are not set from failed reads.

Nested input/output parsers preserve non-1 results (`psbt_parse_rawtx.c:372-378,418-424`). `parser_run` returns results <=0 without advancing the step (`parser_ext.c:149-157`). The stream callback handles 0 by consolidating remaining bytes into its bounded carry storage, but handles a negative result by latching `parser_error` (`psbt_parse_rawtx.c:550-561`). Later callbacks return immediately once that latch is set (`:540-543`). Thus malformed bytes cannot be skipped and replaced by later valid-looking bytes for the same field.

The stream may finish receiving/authenticating bytes because its callback has no error return; this does not undo the latch. `call_psbt_parse_rawtx` rejects either stream failure or a latched parser error before finalizing the txid (`:608-624`), and the amount helper returns before using parser outputs on failure (`src/handler/sign_psbt/amount_from_psbt.c:60-79`). Partial amount/script writes from earlier successful fields therefore do not become accepted output after a new canonicality error.

## 4. Base58 xpub decode length

`APP/src/common/wallet.c:373-379` zero-initializes the destination and requires `base58_decode` to return exactly `(int) sizeof(ext_pubkey_check)`. The function returns before hashing/comparing the checksum or assigning `out->ext_pubkey` for negative, zero, short, or unexpected larger results.

SDK `base58_decode` returns its actual decoded length and only writes those bytes (`SDK/lib_standard_app/base58.c:97-105`); it rejects output larger than capacity. The app's serialized xpub consists only of byte/byte-array members totaling 78 bytes, followed by four checksum bytes (`APP/src/crypto.h:21-33`), matching the established 82-byte representation on supported targets. The cast is safe for that small size and matches the decoder's `int` return type.

The exact-length check is the fix; zero-initialization is additional defense. Neither valid checksum verification (`wallet.c:381-389`) nor subsequent ownership checks is bypassed or weakened.

## 5. Type, include, link, and honest-host compatibility inspection

- All newly calling translation units include `buffer_ext.h`; `wallet.c` already did. The header includes bool, size, integer, and SDK buffer declarations. The single-buffer implementation already included `varint.h`; the two-buffer implementation now explicitly includes it.
- `dbuffer_read_varint` declaration/definition and all callers agree on `int`. Existing parser callbacks already return `int`, so there is no callback-signature change. No alternate app declaration or additional production caller was found by source search.
- The firmware Makefile includes `src` (`APP/Makefile:41`). SDK source discovery includes all app C files and app header directories (`SDK/Makefile.rules:91-137`), and SDK `lib_standard_app` already supplies `varint.c` (`Makefile.standard_app:259`). No new source file, SDK edit, global macro replacement, or build-list entry is required by the patch.
- Existing standalone buffer/parser CMake targets already link `buffer_ext`, `varint`, `buffer`, `read`, and `write` as appropriate (`APP/unit-tests/CMakeLists.txt:104-134`); Merkle and wallet test targets already include the affected libraries (`:293-297,343-345`). This is a source-level dependency check, not a successful compile/link claim.
- The honest adapter's `createVarint` chooses widths at the same thresholds (`packages/bitcoin-prl-adapter/src/upstream/varint.ts:50-66,108-127`). It encodes map commitments, preimage lengths, leaf indexes, and wallet header values (`upstream/merkleMap.ts:44-50`, `clientCommands.ts:82-100,226`, `policy.ts:51-72`).
- SIGN_PSBT input/output counts use the SDK's minimal `compactSize` encoder (`packages/bitcoin-prl-adapter/src/client.ts:516-526`; `packages/sdk/src/bytes.ts:66-75`).
- Optional previous transactions pass through `parseTransaction` before inclusion/acceptance (`packages/bitcoin-prl-adapter/src/psbt.ts:98-122,343`); that parser uses the already-canonical `Reader.compactSize` for all six corresponding fields (`packages/sdk/src/transaction.ts:171-206`; `bytes.ts:110-125`).
- Account xpub handling uses Base58Check, validates a 78-byte payload, and requires exact re-encoding (`packages/bitcoin-prl-adapter/src/policy.ts:110-113`). The native raw Base58 decoder includes the four checksum bytes, so 82 bytes is consistent rather than a host/native mismatch.

Accordingly, inspected honest-host serializers do not rely on the newly rejected forms. Uninspected external hosts and device behavior remain outside this compatibility conclusion.

## Remaining validation requirements

The following were **not run** and remain required for native/firmware qualification when authorized:

1. Canonical and nonminimal boundary vectors for both readers, including all seven major boundaries and UINT64_MAX; compare output sentinels and original offsets on every failure.
2. Every split point and every truncation length for 1/3/5/9-byte encodings, including nonzero initial offsets and an exhausted first buffer.
3. A complete malformed encoding followed by a valid-looking replacement in the same/later chunk; verify fatal latching and no same-field retry acceptance.
4. Each of the ten reachable single-buffer boundaries and all six rawtx fields, with otherwise valid Merkle commitments; include the prior transaction-normalization counterexample.
5. Valid xpubs and successful-short Base58 results, confirming no checksum use before the exact-length gate.
6. Firmware compile/link, warning checks, host/device interoperability, and compiled stack/size/resource qualification. Temporary descriptors add local storage; compiled impact was not measured.

No new blocker was substantiated by this independent static review. The patch is ready to be described as statically reviewed, with the native execution limits stated explicitly.
