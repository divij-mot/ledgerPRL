# Pearl Ledger protocol v1

Development protocol; no release or hardware validation is implied. All multibyte integers in the bundle and APDU command data are little endian. No padding, optional fields, or trailing bytes are allowed. The maximum input count is 16, a development cap pending measured hardware memory and latency evidence. Accounts and indexes are 0..2^31-1; branches are 0 or 1. Mainnet derivation is m/86'/808276'/account'/branch/index; all other networks use coin type 1.

## Canonical signing bundle

Header: magic ASCII PRL1 (4 bytes), network u8 (0 mainnet, 1 testnet, 2 testnet2, 3 regtest, 4 simnet), account u32, transaction version i32 (must equal 1), locktime u32 (must equal 0), input count u8 (1..16), output count u8 (1..2).

Each input in signed order: outpoint transaction hash 32 bytes in wire/internal order, output index u32, previous-output amount u64 (1..2100000000000000000 grains), previous-output script 34 bytes (0x51 0x20 then x-only output key), sequence u32 (must equal 0xffffffff), derivation branch u8, derivation index u32. Duplicate outpoints are forbidden. Every script must equal the device-derived empty-tree BIP86 output for the selected account/path.

Each output in signed order: amount u64 (1..2100000000000000000), script 34 bytes (same P2TR format), role u8 (0 recipient, 1 change), branch u8, index u32. Exactly one recipient must be present. Recipient branch/index must both be zero and are not key origins. At most one change is allowed, with branch exactly 1 and a valid index; its script is independently derived on device. An external recipient key can commit to an opaque tree; its address cannot reveal that policy.

Size is 19 + 87*inputs + 48*outputs, at most 1507 bytes. Checked aggregate input/output sums must each be <= MAX_GRAINS and outputs <= inputs. Fee is their exact difference. SIGHASH_DEFAULT only, epoch zero, key-path spend, no annex. Device computes BIP341 digest from these signed fields, shows the network, full recipient address, amount, fee and change, and signs only after physical approval. No command accepts a precomputed signing digest.

## APDU commands

CLA 0xe0; P1/P2 must both be zero. INS 0x00 capabilities, 0x01 export account, 0x02 verify address, 0x10 begin signing, 0x11 append signing, 0x12 review/sign, 0x13 fetch signature, 0x14 abort. Short APDUs only, length must match exactly.

Capabilities response: protocol u8=1, app semver 3 u8 bytes, network u8, max inputs u8=16, max bundle u16=1507. Export account request: account u32; confirmed response: master fingerprint 4 raw BIP32 bytes, compressed account public key 33, chaincode 32, network u8, account u32 (74 bytes). Verify address request: account u32, branch u8, index u32; confirmed response: ASCII address only.

Begin data: total size u16 plus SHA256(bundle) 32 bytes. Append data: offset u16 plus next bytes; contiguous offsets only, no empty chunk, no extra bytes. Review/sign has no data; it requires the complete payload and matching hash, performs full validation and user review, and returns signature count u8 plus bundle hash 32 bytes after approval. Fetch signature data: next sequential input index u8; response 64-byte BIP340 signature. Once all signatures have been fetched, wipe session state. Abort has no data and wipes state. All malformed/unexpected commands, failures, rejection, disconnect, timeout or app exit must wipe the session; an active transfer cannot be silently replaced. No account/address command may be used during signing.

Status words: 0x9000 success; 0x6700 wrong length; 0x6985 user rejected; 0x6986 wrong state; 0x6a80 invalid data/policy; 0x6b00 wrong P1/P2; 0x6d00 unsupported instruction; 0x6e00 unsupported class; 0x6f00 internal/crypto failure. Host must treat every failure as terminal for that session and explicitly start over, never downgrade to blind signing.

The host independently validates returned metadata and signatures, displays the same transaction, finalizes exact 64-byte witnesses and requires a separate explicit broadcast action. Node/backend information is untrusted and cannot prove chain truth to the device. No software seed/signing fallback exists.
