# Secret lifecycle audit: final-source findings

Reviewed crypto SHA256: `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

## Corrections and rejected intermediate

1. **Checked RNG before key construction.** The original signer derived a private key before calling void `cx_rng_no_throw`. Pinned secure SDK `lib_cxng/src/cx_rng.c:28–36` calls `cx_get_random_bytes` then loops forever on a nonzero return. A separate original-wrapper host injection reproduced that behavior. This is a returned-error handling weakness, not demonstrated APDU-triggered key disclosure. While blocked, the caller cannot poll transport or run Rust drops. Final `apps/ledger/src/crypto.rs:195–203` checks the same underlying entropy syscall before constructing the key. It retains fresh auxiliary entropy, `CX_RND_PROVIDED`, nonce construction, length checks and self-verification; there is no fallback entropy source. EC blinding can independently require OS randomness, so this is not a general RNG-liveness guarantee.

2. **Shorter lexical key lifetimes.** Final account scope (`crypto.rs:163–174`) wipes the key before the master-identifier syscall. Signing (`202–222`) wipes its original key before length checking and public-only verification (`223–240`). The public key alone leaves each scope.

3. **Fixed regression caught in optimized code.** Rejected intermediate crypto SHA `7245b73f22769869bcd9440469a45adfce2b9878b9f5567bbad759742b38d1d9` used explicit `drop(key)` after signing. Optimized Nano S Plus mainnet ELF SHA `a6342ae7be6a3bfb30363b587bd5240859bf0aaf7616d2daf68300d64b5014dd` copied the 40-byte key from SP+10648 into SP+11160 at `0xc0de355e–356a`, then wiped only the copy at `0xc0de3570`. The original slot remained unwiped on success. This intermediate was rejected; it was not qualified for release. Earlier contents-only Drop tests passed it, demonstrating their limitation. The final lexical scope removes that move. The strengthened host observer checks original-slot address identity and rejects the same historical source (one targeted debug test, exit 101). Exact final optimized artifacts were reviewed independently, without host instrumentation.

## Final evidence

On 2026-10-09 the portable runner read the actual frozen source and live core dependency; all eight controls passed in debug and release with Cargo 1.99.0. A fresh output path containing spaces was used; source checks passed before and after. The tests cover fifteen named error/boundary scenarios, successful signing, 64 synthetic BIP86 comparisons, zero contents/metadata, original-slot identity, and key-wipe ordering. Only one post-wipe observer call is added to the generated crypto module.

Five exact optimized simnet pilot ELFs (Nano S Plus, Nano X, Stax, Flex, Gen5/apex_p) separately passed manual original-slot/control-flow review. On every model, account and signing success/error Drop pointers match the original key objects. Each 32-byte scalar wipe resolves to a byte-zero loop, followed by metadata zero stores. Account cleanup precedes identifier; signing cleanup precedes verify. Exact ELF hashes, addresses and short disassembly are retained in `evidence/final-elf-review.json` and `final-assembly.md`. All five final mainnet variants were additionally cross-checked against these simnet paths: 50 relocation-aware region comparisons passed, with original slot addresses and zero stores traced despite changed code addresses/helper instances. See mainnet-assembly.md and mainnet-elf-review.json. These address-specific observations do not automatically qualify other rebuilt or different-network artifacts.

## Ordinary errors versus OS exceptions

Normal returned errors execute Rust guards. The C BIP32 bridge (`ledger_secure_sdk_sys/src/c/src.c:406–414`) uses the standard checked derivation wrapper, whose local C catch wipes the required 64-byte raw buffer (`include/os_seed.h:91–115`). CX return values are checked. The raw derivation, normalized scalar and signature/nonce buffers are guarded; PrivateKey Drop is at `crypto.rs:29–35`.

The master-identifier wrapper uses `SVC_Call` (`src/syscalls.c:1230–1235`). `src/svc_call.s:7–15` converts OS-reported r1 exceptions into `os_longjmp`, without a local catch at this call. Final code removes the account private key before that boundary. No physical condition or adversarial APDU causing this valid fixed-size invocation to raise was established. Other reviewed app secret-bearing calls use checked CX APIs or the local C derivation catch; no additional expected throwing app call with a live private key was identified.

The Rust SDK outer C loop catches `EXCEPTION_IO_RESET` and restarts (`src/c/src.c:372–395`), while initial BSS clearing is outside that loop (`365–367`). Historical optimized disassembly confirms the restart edge has no explicit app-RAM/stack wipe. Such exceptions can bypass Rust destructors. Application-reported transport faults instead follow the explicit Session reset/app exit path. `panic=abort`, OS-owned scratch and nonreturning syscalls remain platform boundaries. The final module header accurately states these limits.

**Physical release gate:** establish each supported device/OS/API's checked-error, raised-exception, IO_RESET, panic/exit and RAM-cleanup behavior. Emulator restart and pending-session timeout do not prove physical RAM erasure, and cannot impose a timeout while blocked in a syscall. No speculative SDK reset patch was made.

## Remaining audit conclusions and limits

Checked paths use purpose 86, selected coin and bounded account/branch/index; the bridge permits only lengths 3/5 with no arbitrary seed/curve. Generated SDK bindings supply ABI/layout; fixed array sizes and returns are checked. BIP86 internal parity normalization, tagged tweak, t>=n rejection, zero-result rejection and BIP340 output parity behavior were reviewed. The scalar-zero helper uses SDK fixed-length OR reduction, not short-circuit secret equality. The five final simnet optimized artifacts also retain the full 32-byte OR loop; entry addresses and an example are recorded in final-assembly.md. OS-derived scalar validity remains a secure-OS trust boundary.

Owned inputs/change are derived independently. Immutable validated transactions and the post-review token bind displayed values to the same all-input/all-output SIGHASH_DEFAULT digest. All signatures must succeed before fetching. No further unauthorized-signing, transaction-substitution or secret-export defect was established in this review.

Host mocks do not execute Ledger CX or prove its side-channel/fault resistance. The original-slot check does not scan RAM/register copies or OS scratch. Instrumentation can alter optimization; only actual uninstrumented ELF review established the five compiled observations. Native/runtime and physical-device qualification remain separate. Original RNG experiments and rejected intermediate observations are preserved distinctly; none is represented as a final-source test.
