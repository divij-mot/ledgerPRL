# Native explicit-denial boundary review

10 October 2026. The reviewed Pearl C signer supports a narrow distinction: an **actual bare `0x6985` response within the current SIGN_PSBT request, before any raw signature yield**, proves that this reviewed signing attempt stopped at its pre-signing review. It does not justify releasing a previous uncertain attempt, and it is not equivalent to a cancellation, generic transport error, status-like exception or on-device text saying “rejected”.

No production firmware or application file was changed by this reviewer. The parent owns the typed adapter proof and atomic journal correction.

## Source evidence

- `src/handler/sign_psbt.c:54–67` performs initialization, input/output validation and transaction hashing, then calls `display_transaction`. A false review result jumps directly to cleanup; `sign_transaction` is called only after successful review. Cleanup clears transaction/cache/signing state.
- `src/handler/sign_psbt/transaction_display.c` contains every reachable SIGN_PSBT `SW_DENY` branch: warning rejection (174, 180, 187), output/review rejection (66, 315, 374, 391, 408). Each returns false before the signing call. Unsupported legacy/external/MuSig paths are already excluded by the narrow Pearl profile. `src/boilerplate/sw.h:23` binds `SW_DENY` to `0x6985`.
- `src/handler/sign_psbt/sign_input.c:191–235` creates/verifies the Schnorr signature only in the signing phase, zeroes the private scalar, and yields the signature. There is no `SW_DENY` emission in this file. Cryptographic failures use `SW_BAD_STATE`.
- `sign_input.c:80–91` releases signature bytes in a `CCMD_YIELD` response with `0xe000` **before** receiving its continuation acknowledgement. A failed continuation uses `SW_BAD_STATE`; nonempty acknowledgement data uses `SW_INCORRECT_DATA` (`0x6a80`). Neither can revoke bytes already sent.
- `src/ui/display_nbgl.c:688–695` can display the transaction-rejected status after signing fails. This display callback only updates UI state; it does not emit `0x6985`. Therefore rejected-looking UI is not proof that no signature exists. The generic `send_deny_sw` definition has no call sites in the checked source.
- `src/boilerplate/prl_review_io.c:19–33` handles review timeout, lock and invalid session events by exiting the application. A browser cancellation is not a device rejection event. Transport cancellation/disconnection therefore remains uncertain to the host.

The denial is commonly returned on a **FRAMEWORK CONTINUE** APDU (`CLA 0xf8`, instruction `0x01`) while the enclosing request is SIGN_PSBT (`0x04`). Both native denial frames in the replay have this continuation instruction. Classification must use the enclosing SIGN_PSBT context, rather than requiring the last wire instruction to equal `0x04`.

## Fresh real-firmware replay

The test ran the unchanged **Pearl Reg 0.1.0 Nano S Plus** C ELF in **Speculos 0.27.1** using the published BIP32 vector-one seed. Firmware SHA-256: `77e2dc35fed3443440a1393c42ed6cf03fad13ecf5532a84dab7de014890ce14`. All **167** source files in the recorded ELF build manifest match the current firmware tree; see `source-build-check.json`.

1. After **304** valid Merkle continuations, the driver pressed both buttons on the actual **Reject transaction** screen. The terminal APDU was exactly `6985`: zero payload bytes and **zero raw signature yields**.
2. The next capability command returned `0x9000`, showing clean protocol termination. A fresh, explicitly approved review then produced two signatures and `0x9000`; both signatures were independently verified against the exact fixture transaction.
3. Another approved review received a deliberately nonempty acknowledgement immediately after its first signature yield. Firmware returned **`0x6a80`**, while the host retained **one independently valid signature**. This demonstrates the partial-signature boundary directly.
4. A subsequent explicit rejection returned bare `0x6985` with zero new yields. The **previous partial signature and previous complete signed transaction remained valid**. A later denial therefore cannot clear an earlier attempt's uncertainty or reservations.

Evidence: `result.json`, `frames.json`, `screens.json`, `native-replay.txt` and the three selected PNGs. `native-denial.ts` replays these cases. The source/ELF/image identities and test outputs are bound by `evidence-sha256.json`.

The owned container used a read-only root, dropped capabilities, no-new-privileges, a read-only public ELF bind and only a loopback-published Speculos API. It mounted no physical device, user home or Docker socket. No Pearl node was started; no mainnet request, real wallet state or broadcast was used. The owned containers were stopped and a scoped container check returned no remaining test container.

## Required host restrictions

- Accept only the adapter's internally established wire-denial proof: exact status-only response, enclosing SIGN_PSBT, no prior raw yield in that request. Count a raw yield before parsing or verifying it. Do not classify an arbitrary thrown error by numeric status/message alone.
- Apply release only to the same **initial** attempt still owned by the active attempt ID, with no signed bytes/txid and `recovery === false`. Reset-to-draft and discard must occur in the same atomic journal mutation. A competing tab, persisted signed result or changed attempt must defeat release.
- Keep reservations for recovery attempts, browser cancellation, timeout, disconnection, malformed responses/yields, any partial yield, complete-signature/acknowledgement failures and storage failures. A fresh denial cannot erase prior evidence.
- Do not retroactively manufacture the proof from an old error string, a cached “rejected” label or a currently unspent indexer response. This review does not establish new evidence for historical uncertain records.

These conclusions apply to the reviewed Pearl firmware/protocol. They are not a universal interpretation of `0x6985` across arbitrary Ledger apps or future firmware, nor a physical-device test.
