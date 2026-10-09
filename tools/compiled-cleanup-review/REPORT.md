# Independent optimized ARM private-key cleanup crosscheck

Date: 2026-10-09. Read-only review of immutable development artifacts; no repository edits, builds, physical devices, accounts, funds, commits, or secret inputs.

## Result

**No counterexample to original-slot private-key cleanup found in the reviewed optimized code.** The five simnet pilots pass a fresh manual caller-address, branch, and zero-store review. A separate, bounded disassembly CFG/address check passes all 25 currently available model/network ELFs, and their actual Drop/zeroizer instruction shapes match the corresponding manually reviewed pilot.

This result is specifically about the original application private-key scalar and its meaningful metadata on success and ordinary returned errors. It is not a physical-memory-erasure guarantee, an all-copy guarantee, formal verification, or approval for production funds.

## Artifact identity and method

Source checked directly: `/workspace/scratch/5d237258d612/ledgerPRL/apps/ledger/src/crypto.rs` SHA256 `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

ELFs/manifests: `/workspace/shared/pearl-lexical-requalification-20261009-1852/artifacts/pearl-{model}-{network}.{elf,build.json}`. All 25 ELF hashes were independently computed and matched their adjacent manifests; every manifest records the source hash above. `evidence/all-artifact-checks.json` records all ELF hashes. The five pilot hashes are:

| Model | Simnet ELF SHA256 |
|---|---|
| Nano S Plus | b4a0e2d8165d37a1a0a5bc31b5ae8ebd646ed5eb850d56b6d2edfd9961044835 |
| Nano X | 71920b16eaa629fd23b032756ae7dd0faecafab61da19ce40c4b5680433af568 |
| Stax | 5f6fbc9d7330992958afb8f875c48f8df9ecab1446d8ec4366f2016d0a2a7449 |
| Flex | d13e2224a766bcff9ccb5f0bc3d09ca59f686a9444092eb80ea594c0ba86e7f1 |
| Apex P | 98d624ac34120b70c2df7f5b3696fddef219f7d3aeee19e50e3f60590aae8959 |

I read the prior report as a claim to check, then independently disassembled the actual immutable ELFs. Findings below are based on those fresh disassemblies, not host tests, prior snippets, or the mere presence of a Rust Drop implementation. No host mock tests were run or used as proof in this crosscheck.

## Original object address and exact sites

S means the stable `sample_main` caller stack pointer in these regions. It is not the stack pointer inside a called function. All addresses in this table refer to **simnet only**. Per-network entry/drop addresses are separately in `evidence/cfg-results.json`.

| Model | Account object | Signing object | Account derive | Account success/error Drop | Identifier | RNG | Signing tweak | Sign syscall | Signing success/error Drop | Verify |
|---|---|---|---|---|---|---|---|---|---|---|
| nanosplus | S+10944 | S+10720 | c0de16fc | c0de1a20 / c0de1996 | c0de1a32 | c0de3486 | c0de34b0 | c0de3512 | c0de3532 / c0de3632 | c0de3562 |
| nanox | S+11224 | S+11000 | c0de1a10 | c0de1f0e / c0de1d60 | c0de1f24 | c0de3832 | c0de3854 | c0de38ac | c0de38c6 / c0de3994 | c0de38ee |
| stax | S+10936 | S+10712 | c0de16d4 | c0de1a32 / c0de1954 | c0de1a42 | c0de33ba | c0de33e4 | c0de3446 | c0de3466 / c0de3556 | c0de3498 |
| flex | S+10944 | S+10720 | c0de1754 | c0de1a78 / c0de19ee | c0de1a8a | c0de34de | c0de3508 | c0de356a | c0de358a / c0de368a | c0de35ba |
| apex_p | S+10944 | S+10720 | c0de1754 | c0de1a78 / c0de19ee | c0de1a8a | c0de34de | c0de3508 | c0de356a | c0de358a / c0de368a | c0de35ba |

### Address provenance, not just matching Drop names

- Account: each original 40-byte object is initialized directly in the listed slot, and that same address is passed as derive's r3. Derive preserves the pointer and forwards it as r3 to `cx_ecfp_init_private_key_no_throw`. The account public-key helper receives the same address in r1. Both account Drop sites receive that address in r0.
- Signing: the 40-byte object is initialized directly at the listed signing slot, passed as r1 to `tweaked_key`, as r1 to `public_key`, and as r0 to `cx_ecschnorr_sign_no_throw`. Both signing Drop sites reconstruct that same r0 address.
- Nano S Plus/Flex/Apex signing address arithmetic is S+32+10688 = S+10720. Stax is S+24+10688 = S+10712. Their account calculations are S+10944 and S+56+10880 = S+10936 respectively.
- Nano X uses literal pools. Account initialization/derive/public and cleanup load `0x2bd8` = 11224; signing initialization/tweak/sign/cleanup load `0x2af8` = 11000. Both constants were read from the ELF disassembly's actual pools, not inferred from the prior report.
- The public helper passes its borrowed key pointer to `cx_ecfp_generate_pair_no_throw`, with keepprivate=true. Its separate local public object is 76 bytes. Public-object moves do not change the private-key object's address.

### Why the rejected by-value Drop bug is absent here

On the signing success path there is a **76-byte public-key copy**, followed by Drop on the original 40-byte private object. Example Nano S Plus: the copy at c0de3528 is from S+10420 to S+10944, length 76; the Drop at c0de3532 is passed S+10720, which is the exact pointer passed to signing at c0de3512. These ranges do not overlap. Nano X similarly copies a public object from S+10700 to S+11224 while dropping the original private object at S+11000.

The same distinction holds in Stax/Flex/Apex. The account success path moves public data and then wipes its original account object. No moved private-key temporary is substituted for the original object at these Drop sites. The existence of memcpy near Drop was therefore examined, not assumed harmless.

## Ordinary control flow and sequencing

- Account derive failure branches to the error Drop. Public generation failure, malformed public length, or malformed public prefix returns an error that also reaches that Drop. Success reaches the success Drop before `os_perso_get_master_key_identifier`.
- Signing tweak failure, public-key failure/malformed public result, and returned signing failure all converge on the signing error Drop. Every ordinary return from `tweaked_key`, including derivation/init/hash/tweak comparison/subtract/add/zero-scalar errors, is handled by the same caller check.
- Signing success reaches the original-slot Drop before testing final signature length and before public-only Schnorr verification. A wrong signature length or false verification result happens after cleanup, not on a live-private-key path.
- On all five manually reviewed pilots, `cx_get_random_bytes` is called for 32 bytes, and its returned status is compared with zero immediately. The nonzero path goes to the signature-buffer cleanup/error block before private-key construction. Only zero status reaches the 40-byte private-key initialization and derivation. There is no unchecked void RNG wrapper here.
- Nano S Plus example: RNG c0de3486; compare/branch c0de348a/c0de348c to error c0de3638; only fallthrough reaches private-key clear c0de34a4 then tweak c0de34b0. Nano X's Thumb branch expansion uses eq to c0de383c and an unconditional nonzero jump to c0de397e; it has the same ordering.
- The raw 64-byte derivation buffer is cleared on both derive return outcomes. Nano S Plus uses derive-frame SP with a common 64-byte wipe at c0de0e74; Nano X uses derive-frame SP+12 and common wipe c0de0fa0. The normalized scalar and signing-only chain-code buffers also have cleanup in the inspected helper paths. These supporting checks do not imply that every lower-level SDK scratch/register copy was audited.

## Actual zero stores

All five pilots' PrivateKey Drop preserves its incoming pointer, adds 8 for the scalar, calls the 32-byte zeroizer, then executes a word zero store at key+4 (`d_len`) and a byte zero store at key+0 (`curve`). Scalar addresses key+8 through key+39 are covered by an explicit byte-store loop. The loop establishes an end pointer of start+32 and advances one byte after each zero store.

The meaningful fields occupy 37 bytes. The three ABI padding bytes at key+1..3 are initialized with the 40-byte object clear, but are **not explicitly overwritten by Drop**. Thus “scalar and metadata are wiped” is the precise claim; do not reinterpret it as an explicit 40-byte whole-struct wipe.

The actual zeroizer instruction shapes are retained in `evidence/wipe-shapes.json`; selected caller snippets are retained in `evidence/selected-pilot-snippets.txt`. The Nano X byte iterator uses its ARMv6-compatible instruction sequence; the other models use the paired-load/postincrement sequence. Both actually store zero through the entire scalar range.

## Reproducible extension to all 25 network/model ELFs

Networks present and checked: mainnet, simnet, regtest, testnet, testnet2 for each of five models.

`check_cfg.py` performs a bounded static check directly over the fresh disassembly. Starting after the account derive call and signing tweak call, it traverses **both outcomes of every conditional branch** and requires every path to hit a PrivateKey Drop before any identifier/verify call or unsupported exit. It independently traces the pointer argument to derive/tweak/sign and each reached Drop through the actual ARM caller instructions, including Nano X literal pools. All 25 pass. The trace visits 30–38 account instructions and 51–60 signing instructions per artifact before those Drop endpoints.

`check_wipes.py` compares the actual Drop, scalar32, buffer64, and iterator instruction sequences with each model's manually inspected simnet baseline. It normalizes relocation addresses/Rust symbol identity only; registers, offsets, immediate sizes, store widths, and local branch destinations remain. All 25 pass.

This extension demonstrates the same original-slot/ordinary-return cleanup property in those callers and the same zero-store routines. It does not certify whole-program code equivalence across networks: `sample_main` and helper raw byte hashes can differ from relocation/layout/network changes, and no such equivalence claim is made. The most detailed manual RNG and helper review was of the five simnet pilots.

## Limits and residual risk

1. Assumes ordinary ARM ABI behavior, valid pointers, adequate stack, and callee returns without memory corruption. The checks do not model power loss, fault injection, stack overflow, arbitrary jumps, panics/aborts, OS exceptions, reset/IO_RESET, or longjmp-style exits that bypass Rust cleanup.
2. Proves writes in the application instructions, not physical RAM remanence or visibility after resets. There was no physical-device execution.
3. Does not establish clearing of CPU registers, compiler spills elsewhere, SDK/OS-owned scratch, syscall internal copies, microarchitectural state, or every historical scalar copy. Those need separate platform-specific validation; `Zeroize`/Drop alone cannot establish them.
4. The static scripts are purpose-built bounded checks, not a complete disassembler, symbolic executor, emulator, or formal proof. Unsupported control flow fails the check. Manual instruction review anchors the five pilot results; assumptions are explicit.
5. Manifest/source matching establishes the recorded association with these exact ELFs; it is not an independently reproduced build.

## Portable replay and retained evidence

Use `README.md` and `replay.py` in this package. Replay requires explicit source-file, artifacts-directory, ARM-objdump, and separate output-directory arguments. It verifies all 25 ELF hashes, exact adjacent manifest hashes, expected source identity, and recorded source/SDK identity before launching disassembly; checks input identities again after replay; and writes generated full disassembly only to the separate replay output. It compares the CFG results and wipe instruction shapes with the retained independently reviewed results. This portable wrapper was initially packaged without rebuilding or rerunning disassembly. Subsequent independent replay on 2026-10-09 passed all 25 exact artifacts; `evidence/independent-replay.json` retains that result.

`identities.json` retains all 25 immutable ELF/manifest identities. `evidence/cfg-results.json`, `evidence/wipe-shapes.json`, and `evidence/all-artifact-checks.json` retain all 25 results and exact ELF/function-byte hashes. `evidence/selected-pilot-snippets.txt` is compact material selected from this independent review's existing disassembly. Full binaries, full disassembly, caches, and evidence from other audits are intentionally excluded.

The original environment paths above are provenance only. The portable checker does not depend on those absolute paths.
