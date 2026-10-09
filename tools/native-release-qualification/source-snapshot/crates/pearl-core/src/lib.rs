//! Strict, allocation-free Pearl transaction policy for a native Ledger adapter.
//!
//! This crate holds only public data. Device keys, BIP32 derivation, BIP86
//! elliptic-curve tweaks, trusted-screen UI and BIP340 signatures belong to the
//! native adapter, implemented through [`Device`]. Host bytes are never accepted
//! as a signing digest. See `docs/protocol-v1.md` for the exact wire format.
#![no_std]
#![forbid(unsafe_code)]

mod address;
mod amount;
mod error;
mod network;
mod session;
mod transaction;

pub use address::{Address, ADDRESS_CAPACITY};
pub use amount::{Amount, GRAINS_PER_PRL, MAX_GRAINS};
pub use error::Error;
pub use network::{AccountPath, DerivationPath, Network, HARDENED};
pub use session::{AccountPublic, Device, Response, Session, SessionState};
pub use transaction::{
    parse_bundle, Input, Output, OutputRole, PublicKeyProvider, ReviewedTransaction, Transaction,
    ValidatedTransaction, MAX_BUNDLE_SIZE, MAX_INPUTS, MAX_OUTPUTS, MIN_BUNDLE_SIZE,
};

/// SHA256 commitment to the exact canonical transfer payload.
pub fn bundle_hash(bytes: &[u8]) -> [u8; 32] {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).into()
}
