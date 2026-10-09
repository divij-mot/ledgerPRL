# pearl-core

Development-only, allocation-free `no_std` parsing, policy and signing-session
core. The crate has no secret-key representation, software signing fallback,
network code, raw-digest signing command or unsafe code. Do not use development
builds with valuable funds.

## Boundary

`parse_bundle(bytes, configured_network)` parses the exact `PRL1` format in
[`protocol-v1.md`](../../docs/protocol-v1.md). It rejects noncanonical lengths,
unsupported fields/scripts, duplicate outpoints, nonfinal sequence, nonzero
locktime, invalid paths and all invalid or overflowing amounts. Inputs are capped
at 16, outputs at 2, payload at 1,507 bytes. All values and sums are at most
2,100,000,000,000,000,000 grains, using checked integer arithmetic.

`Transaction::validate_ownership` rejects an invalid external secp256k1 x-only
recipient through `PublicKeyProvider::validate_output_key` and compares every
input/change script with an independently device-derived empty-tree BIP86 key.
The provider must use native, reviewed SDK curve/key APIs. A host-supplied script
is never evidence of ownership. Account/branch/index selection only permits
m/86'/coin'/account'/branch/index, with 808276 for mainnet and 1 otherwise.

`Session::handle_apdu` owns the bounded transfer buffer, commitment, physical
review callback, signing order and sequential signature export. The native
`Device` adapter receives `ReviewedTransaction` only after its trusted-screen
review returns success. The type has private fields and no public constructor
or mutators. Every APDU error, abort and explicit lifecycle reset clears the
session using `zeroize`. All inputs must sign successfully before any signature
is exported. Fetching the last signature destroys the session.

The adapter must implement real physical confirmation, SDK-only BIP32/BIP86 and
BIP340 operations, signature self-verification, and call `reset` on timeout,
disconnect and app exit. Core host tests cannot prove these native properties.
No external callbacks or host approval flags can be treated as physical approval.

Sighash construction uses RustCrypto SHA256 and BIP341's unmodified epoch-zero
`TapSighash` tagged hash, DEFAULT, no annex, key path. A network label does not
add consensus replay protection. Bech32m uses rust-bitcoin's `bech32` library.
The full network enum remains distinct even when HRPs are equal. Recipients can
commit to opaque Taproot trees; an address cannot reveal that policy.

## Verification

From the repository root:

```sh
cargo test -p pearl-core --locked
cargo clippy -p pearl-core --all-targets --locked -- -D warnings
cargo fmt -p pearl-core -- --check
rustup target add thumbv7em-none-eabi
cargo check -p pearl-core --lib --target thumbv7em-none-eabi --locked
```

Tests cover all canonical input/output counts, every truncation of a maximal
payload, every short-APDU chunk size, exact amounts including maximum-value and
five-/nine-input overflow attacks, malformed scripts/paths/roles, duplicated
outpoints, forged input/change ownership, invalid recipient points, lifecycle
resets, rejection, signing failure and signature-fetch order. Property tests
exercise arbitrary parser bytes, exact amount invariants and hostile APDU
sequences. Independent rust-bitcoin tests compare BIP341 sighashes over all
supported shapes and three amount ranges. The shared public TypeScript fixture
checks account-xpub public derivation, BIP86 tweaks, Bech32m, transaction IDs,
weight/vsize, digests and libsecp256k1 verification of its signatures.

The policy-test `MockDevice` intentionally returns public placeholder keys and
signature-shaped bytes. It is only test code; it is neither cryptography nor a
hardware implementation. The separate shared-fixture tests use real public
curve verification without any private keys in Rust.

Remaining release gates include independent security review, real Ledger SDK
build/Speculos and hardware approval/cancel/transport tests, measured worst-case
stack/RAM/time and supported-device coverage, and interoperability with the
pinned Pearl node. An embedded no_std compile is not hardware validation.
