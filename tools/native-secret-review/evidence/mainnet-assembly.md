# Mainnet original-private-key slot review

Result: **PASS on all five exact optimized mainnet ELFs**. This supplements the manually reviewed simnet pilots. It does not assert that mainnet and simnet binaries or whole `sample_main` functions are byte-identical.

Final `crypto.rs` SHA256: `50203747bb0b6a5a5ba43d36e51b3369598df95c8d29702f8985956fe9ab7fa1`.

## Exact ELF identities

| Device | Mainnet ELF SHA256 |
|---|---|
| nanosplus | `734ad170d4621eb98b20809f548cacbe32e5409d158d3e2eea47a6736fbeb136` |
| nanox | `6221a610022e3684edf575f8a70c06eda86059ed995bc7a09038b178acfa811f` |
| stax | `bf137b68355f1efc8d54d9f4e6ea56179f956b9cc7b41dcfc0e18e91571b61b6` |
| flex | `7844ce075283c48f663477e7a2deb789a445879b78dfe3929fb918beec5d6103` |
| apex_p | `7cce99aaacc43c281c5cf99eec90587c32e636869ae59cedfc0da2b5c19dc852` |

All ten ELF hashes (five mainnet plus five simnet references) were checked against build manifests. Simnet hashes also match the prior manual review. Source hashes are provenance only; the verdict below comes from the compiled instructions.

## Mainnet slot and call addresses

SP is the unchanged caller `sample_main` frame SP, not a callee SP. All addresses below are hexadecimal.

| Device | Account / signing slot | Account success / error Drop | Identifier | Sign call | Signing success / error Drop | Verify |
|---|---|---|---|---|---|---|
| nanosplus | SP+10944 / SP+10720 | c0de1a30 / c0de19a6 | c0de1a42 | c0de3522 | c0de3542 / c0de3642 | c0de3572 |
| nanox | SP+11224 / SP+11000 | c0de1f22 / c0de1d74 | c0de1f38 | c0de38c0 | c0de38da / c0de39a8 | c0de3902 |
| stax | SP+10936 / SP+10712 | c0de1a42 / c0de1964 | c0de1a52 | c0de3456 | c0de3476 / c0de3566 | c0de34a8 |
| flex | SP+10944 / SP+10720 | c0de1a58 / c0de19ce | c0de1a6a | c0de354a | c0de356a / c0de366a | c0de359a |
| apex_p | SP+10944 / SP+10720 | c0de1a58 / c0de19ce | c0de1a6a | c0de354a | c0de356a / c0de366a | c0de359a |

## Pointer and control-flow findings

- Account: the 40-byte object initialized before `derive` is passed by its original address to `public_key`. Returned derivation errors and public-generation/shape errors converge on the account error Drop using that same address. The success path passes that original address to Drop before calling `os_perso_get_master_key_identifier`.
- Signing: RNG is called before key construction. The original 40-byte object is then passed to `tweaked_key`, `public_key`, and the Schnorr signer. A returned tweak/derive error, public-generation/shape error, or signing error reaches the shared signing error Drop with that original address. RNG errors skip it because the key has not yet been constructed.
- On signing success, the copy immediately before Drop is exactly 76 bytes from the public-key object. Drop still receives the original private-key address; no 40-byte private-key move-to-temporary is present. Signature length and verification errors occur after this wipe.
- Nano S Plus, Flex, and Apex P: account pointer is SP+10944; signing pointer is SP+32+10688 = SP+10720 at construction, signer, and both Drop calls.
- Stax: account pointer is SP+56+10880 = SP+10936; signing pointer is SP+24+10688 = SP+10712 at construction, signer, and both Drop calls.
- Nano X: account loads literal 0x2bd8 (11224), including pools at 0xc0de1d00 and 0xc0de2068; signing loads literal 0x2af8 (11000) at pool 0xc0de3a4c. These are added to SP consistently at construction, key uses, and Drop. The 76-byte public copy uses separate SP+0x29cc to SP+0x2bd8 slots.

## Actual zero stores

| Device | PrivateKey Drop | zeroize32 | Zero-store iterator |
|---|---|---|---|
| nanosplus | c0de0254 | c0de64a0 | c0de64c4 |
| nanox | c0de02c8 | c0de6870 | c0de6894 |
| stax | c0de0254 | c0de4924 | c0de6364 |
| flex | c0de0254 | c0de4a20 | c0de4a44 |
| apex_p | c0de0254 | c0de64ec | c0de6510 |

Drop retains the original pointer, passes key+8 to zeroize32, and then stores zero to the four-byte d_len at key+4 and curve byte at key+0. zeroize32 sets the end pointer to start+32; the iterator performs byte zero stores until the end. Thus scalar bytes key+8 through key+39 and the scalar-length/curve metadata are wiped. Structure padding is outside this claim.

## Comparison and layout differences

All ten selected regions per device match their simnet equivalents after relocation-aware normalization: account preparation/error/success through identifier; signing preparation through verify/error; PrivateKey Drop; zeroize32; zeroize iterator; derive; and public_key. Registers, immediates, memory offsets, branch conditions, and relative intra-function branch destinations are preserved. PC-relative loads are compared using their exact loaded words.

External target addresses and Rust crate-disambiguator hashes are normalized. Renumbered outlined helpers are compared by their actual called bodies, not by their labels. In Stax, mainnet zeroize32 calls a pearl_core iterator instance at 0xc0de6364; simnet calls the ledger_device_sdk instance at 0xc0de4950. Both have identical relocation-normalized instructions and actual zero stores. Function sizes from each ELF symbol table exclude non-executed alignment bytes (e.g. 0xd4d4 after a returning derive body).

Reproducible detailed evidence remains in the separate scratch review directory: compare.py, comparison.json, per-ELF disassembly/symbol dumps, and per-ELF snippets. Only this report and mainnet-elf-review.json are intended as compact portable supplements.

## Limits

This is static optimized-code review for normal success and ordinary returned errors. It does not validate OS-raised exceptions/panics, physical-device RAM after faults/reset, register copies, SDK-owned scratch, or release/hardware qualification. No production source edits, builds, artifact replacement, or commits were performed.
