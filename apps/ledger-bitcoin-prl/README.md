# Experimental Pearl native signer

This is a restricted PRL adaptation of Ledger's deployed Bitcoin 2.5.1 source,
not a Ledger-approved application. Use public test seeds and emulator-only funds.
No physical-device qualification or independent professional audit is claimed.
The previous Rust prototype remains at `../ledger` for reference.

## Provenance and retained machinery

Official upstream: <https://github.com/LedgerHQ/app-bitcoin>, commit
`44ecd0410dcd6ca2f4728cf3c1b49800c30ca74a`. Five official device deployment tags
for app 2.5.1 / SDK 26.6.2 point to this commit; its source tree equals upstream
master `da3c8c9d1cab91a7614efe6cadf197c5cc7c3b50`. Exact tags, commits and the
inspected-but-unused develop revision are in `UPSTREAM.json`. The public GitHub
Releases page alone was not used to infer the deployed version.

`LICENSE`, original copyright notices, `UPSTREAM_README.md`,
`UPSTREAM_CHANGELOG.md`, and `UPSTREAM_TREE.txt` preserve attribution/provenance.
The original PSBTv2/Merkle interpreter, wallet-policy parsing and derivation,
transaction serialization/hashing, BIP341 digest, secure SDK cryptography,
trusted UI framework, buffers and dispatcher are retained where compatible.
Unreachable Bitcoin-specific source remains for reviewability; its presence is
not an enabled feature. Existing upstream test fixtures are reference material,
not evidence that unmodified Bitcoin tests validate PRL.

The port explicitly retargets **unmodified Ledger secure SDK v27.1.2 / API 27**,
commit `6709cd2bdfebb224ee070f7c1211b54254262579`, from the deployment tags' SDK
26.6.2. API27 BIP340 signing supplies fresh checked auxiliary randomness, checks
tweaking/signing/verification results, and wipes sensitive intermediate buffers
on ordinary success and error exits. Review-session I/O adds bounded review
expiry and rejects unexpected concurrent APDUs. These are local changes outside
upstream's security/distribution claims.

## Deliberately supported profile

- Ordinary classical BIP86 P2TR custody: unnamed version-2 `tr(@0/**)` policy,
  one authentic account xpub, no HMAC or registration.
- Mainnet account path `m/86'/808276'/account'`; other networks
  `m/86'/1'/account'`. Account/index accept the full non-hardened 31-bit range;
  branch is exactly 0 or 1. Full account/change/receive paths are displayed.
- Account public-key export always requires device approval. Fingerprint and
  fixed public capability metadata do not. Address verification supports the
  normal protocol's optional display; the supported host always requests it.
- One to 16 positive owned P2TR inputs; exactly one positive external recipient,
  optionally one positive device-verified BIP86 P2TR change output. Duplicate
  outpoints, foreign inputs and incomplete/forged change metadata are rejected.
- External recipient: canonical valid P2TR (`51 20 <x-only key>`) or PRL P2MR
  (`52 20 <32-byte opaque root>`). P2MR is **payment-only**: no P2MR custody,
  XMSS signing, recovery material or post-quantum security claim.
- Transaction version 1, locktime zero, explicit final `ffffffff` sequences,
  Taproot DEFAULT sighash only, no script path, annex, tapscript or MuSig.
- Every amount and aggregate is at most 2,100,000,000,000,000,000 grains;
  100,000,000 grains = 1 PRL. Checked sums and overflow-free fee thresholds are
  enforced on the device. The host must retain bigint values throughout.
- Review includes fixed network, source account, full destination and amount,
  P2MR type where relevant, full verified change address/path/amount, and fee.
  High fees receive an explicit warning.

Legacy/P2WPKH, multisig, OP_RETURN, arbitrary PSBT signing, message signing,
registration, swaps/library signing, Bluetooth, and auto-approval are disabled.
This subset cannot spend every possible Pearl output or construct every valid
Pearl transaction. Unsupported UTXOs and transactions must be explained by the
host, never silently converted into a different policy.

## Network and protocol binding

Each binary fixes its network at build time. IDs 0..4 identify Mainnet, Testnet,
Testnet2, Regtest, Simnet; `src/prl.h` pins HRP, coin type, and genesis. Regtest
and Simnet share a genesis/HRP but retain distinct IDs. Policy xpub transport
versions are conventional xpub/tpub (`0488b21e` / `043587cf`); they are not a
claim about Pearl's other textual extended-key conventions.

Standard app-bitcoin CLA `e1`, protocol version/P2 `01`, P1 `00` is used for
GET_EXTENDED_PUBKEY (`00`), GET_WALLET_ADDRESS (`03`), SIGN_PSBT (`04`) and
GET_MASTER_FINGERPRINT (`05`). Merkle continuations use CLA `f8`, INS `01`.
All request bodies must be consumed exactly.

Custom GET_NETWORK_INFO (`e1 06 00 01 00`) returns 58 bytes:

| Offset | Encoding |
|---|---|
| 0 | ASCII `PRLB` (4 bytes) |
| 4 | schema 1 (u8) |
| 5 | network ID (u8) |
| 6 | coin type (u32 BE) |
| 10 | genesis (32 bytes, displayed hash order) |
| 42 | maximum grains (u64 BE) |
| 50 | maximum inputs, 16 (u16 BE) |
| 52 | maximum outputs, 2 (u16 BE) |
| 54 | flags 3 (u32 BE): bit 0 strict profile; bit 1 external P2MR |

Every signed PSBTv2 includes global proprietary key `fc0350524c01` with value
`01 || network_id || genesis_display_order_32`. Other global/input/output keys
are closed allowlists in `src/handler/sign_psbt/prl_psbt.c` and preprocessing.
The native adapter's policy ID commits the authentic account xpub and origin.
Map commitments must be consumed exactly and contain at most eight entries
before any key traversal. Preimages/proofs reject empty continuation chunks and
trailing bytes; optional previous transactions are capped at 65,536 bytes.

**The metadata binding is application policy, not consensus replay protection.**
BIP341 signatures do not acquire a chain ID. Identical keys, UTXOs and signing
data on another compatible chain can still create replay risk.

## Review cancellation and transport limits

An unexpected APDU during trusted review, reported USB power loss, PIN lock,
malformed/unexpected review event, or 1200 SDK ticker events causes fail-closed
application exit. A final approval callback is checked again against expiry and
PIN state. No private scalar is live across review.
An additional immutable 3000-tick whole-command deadline is checked at public
I/O/UI boundaries; each Merkle continuation cannot restart that budget.

Closing a browser WebHID handle or aborting JavaScript is **not necessarily a
device event**. It does not prove that an already displayed review was cancelled.
After cancellation, timeout or uncertain transport failure the host must discard
the session, ignore late results, and require app exit/reopen before retrying.
An app restart also invalidates any old Merkle/signing conversation. The host
must preserve already verified signed transaction bytes before the final ACK,
because a final response can be lost after valid signatures were returned.

## Build and test

See [`../../tools/bitcoin-prl-port/README.md`](../../tools/bitcoin-prl-port/README.md)
for build-only commands, replay instructions and evidence boundaries. The tested
models are Nano S Plus (`nanos2` / Speculos `nanosp`), Nano X, Stax, Flex and
Apex P. Nano S is not supported. Generated ELF/HEX files are ignored and must
not be committed or installed as a consequence of running the test scripts.
