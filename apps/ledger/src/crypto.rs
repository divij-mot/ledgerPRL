//! The sole application FFI boundary. All scalar and curve arithmetic is Ledger
//! SDK code. This module never calls the SDK's high-level ECDSA signing methods.
//!
//! Secret containers zeroize on every normal/error return. No secret is retained
//! while polling transport or showing UI. Fatal SDK/OS aborts tear down the app;
//! checking OS RAM cleanup on each supported physical device is a release gate.

use ledger_device_sdk::{
    hash::{HashInit, sha2::Sha2_256},
    sys,
};
use pearl_core::{AccountPath, AccountPublic, DerivationPath, Error, ReviewedTransaction};
use zeroize::{Zeroize, Zeroizing};

// SEC2 secp256k1 group order. Arithmetic uses SDK no-throw primitives.
const ORDER: [u8; 32] = [
    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe,
    0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2, 0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
];

struct PrivateKey(sys::cx_ecfp_private_key_t);
impl PrivateKey {
    fn new() -> Self {
        Self(sys::cx_ecfp_private_key_t::default())
    }
}
impl Drop for PrivateKey {
    fn drop(&mut self) {
        self.0.d.zeroize();
        self.0.d_len.zeroize();
        self.0.curve.zeroize();
    }
}
fn check(result: u32) -> Result<(), Error> {
    if result == sys::CX_OK {
        Ok(())
    } else {
        Err(Error::Crypto)
    }
}

// The function is compiled by the SDK's existing C bridge with SDK target
// flags. Only the checked Ledger wrapper crosses C's exception boundary.
unsafe extern "C" {
    fn pearl_scalar_is_zero(scalar: *const u8) -> bool;
    fn pearl_derive_bip32_no_throw(
        path: *const u32,
        path_len: usize,
        raw_private: *mut u8,
        chain_code: *mut u8,
    ) -> u32;
}

fn derive(path: &[u32], chain_code: &mut [u8; 32], key: &mut PrivateKey) -> Result<(), Error> {
    // All callers pass only checked AccountPath/DerivationPath components.
    // The OS load parameters separately restrict the coin/purpose prefix.
    let mut raw = Zeroizing::new([0u8; 64]);
    // SAFETY: valid initialized arrays, exact fixed lengths, secure-element seed only. C catches SDK exceptions
    // without unwinding across Rust; its return status is checked.
    let result = unsafe {
        pearl_derive_bip32_no_throw(
            path.as_ptr(),
            path.len(),
            raw.as_mut_ptr(),
            chain_code.as_mut_ptr(),
        )
    };
    if result != 0 {
        return Err(Error::Crypto);
    }
    // SAFETY: initialized 32-byte scalar and appropriately sized SDK structure.
    check(unsafe {
        sys::cx_ecfp_init_private_key_no_throw(
            sys::CX_CURVE_SECP256K1,
            raw.as_ptr(),
            32,
            &mut key.0,
        )
    })?;
    Ok(())
}

fn public_key(key: &mut PrivateKey) -> Result<sys::cx_ecfp_public_key_t, Error> {
    let mut public = sys::cx_ecfp_public_key_t::default();
    // SAFETY: typed SDK structs; keepprivate=true never replaces the scalar.
    // SDK generate_pair uses randomized fixed-base multiplication for secp256k1.
    check(unsafe {
        sys::cx_ecfp_generate_pair_no_throw(sys::CX_CURVE_SECP256K1, &mut public, &mut key.0, true)
    })?;
    if public.W_len != 65 || public.W[0] != 4 {
        return Err(Error::Crypto);
    }
    Ok(public)
}

fn tap_tweak(internal: &[u8]) -> Result<[u8; 32], Error> {
    let mut tag = [0; 32];
    Sha2_256::new()
        .hash(b"TapTweak", &mut tag)
        .map_err(|_| Error::Crypto)?;
    let mut hash = Sha2_256::new();
    hash.update(&tag).map_err(|_| Error::Crypto)?;
    hash.update(&tag).map_err(|_| Error::Crypto)?;
    hash.update(internal).map_err(|_| Error::Crypto)?;
    let mut tweak = [0; 32];
    hash.finalize(&mut tweak).map_err(|_| Error::Crypto)?;
    Ok(tweak)
}

fn tweaked_key(path: &DerivationPath, key: &mut PrivateKey) -> Result<(), Error> {
    let mut chain_code = Zeroizing::new([0; 32]);
    derive(&path.components(), &mut chain_code, key)?;
    let public = public_key(key)?;
    let tweak = tap_tweak(&public.W[1..33])?;
    // Public scalar comparison only; reject t >= n (never reduce it).
    if tweak >= ORDER {
        return Err(Error::Crypto);
    }
    let mut normalized = Zeroizing::new([0; 32]);
    if public.W[64] & 1 != 0 {
        // SAFETY: distinct 32-byte arrays. n-d implements BIP341 even-Y lift.
        check(unsafe {
            sys::cx_math_sub_no_throw(
                normalized.as_mut_ptr(),
                ORDER.as_ptr(),
                key.0.d.as_ptr(),
                32,
            )
        })?;
    } else {
        normalized.copy_from_slice(&key.0.d);
    }
    // SAFETY: initialized, distinct 32-byte input/output buffers; modulus n.
    check(unsafe {
        sys::cx_math_addm_no_throw(
            key.0.d.as_mut_ptr(),
            normalized.as_ptr(),
            tweak.as_ptr(),
            ORDER.as_ptr(),
            32,
        )
    })?;
    // SAFETY: valid 32-byte scalar. The C bridge binds cx_math_is_zero's fixed
    // full-length OR reduction with no throwing path. A short-circuit Rust
    // predicate would leak leading-zero information about this secret scalar.
    if unsafe { pearl_scalar_is_zero(key.0.d.as_ptr()) } {
        return Err(Error::Crypto);
    }
    Ok(())
}

pub fn output_key(path: &DerivationPath) -> Result<[u8; 32], Error> {
    let mut key = PrivateKey::new();
    tweaked_key(path, &mut key)?;
    let public = public_key(&mut key)?;
    let mut output = [0; 32];
    output.copy_from_slice(&public.W[1..33]);
    Ok(output)
}

pub fn account_public(path: &AccountPath) -> Result<AccountPublic, Error> {
    let mut chain_code = [0; 32];
    let mut key = PrivateKey::new();
    derive(&path.components(), &mut chain_code, &mut key)?;
    let public = public_key(&mut key)?;
    // Use the OS identifier syscall; never request root derivation permission.
    let mut identifier = [0; 20];
    // SAFETY: 20 writable bytes, checked return, same usage as Ledger Bitcoin.
    let result = unsafe {
        sys::os_perso_get_master_key_identifier(identifier.as_mut_ptr(), identifier.len())
    };
    if result != 0 {
        return Err(Error::Crypto);
    }
    let mut master_fingerprint = [0; 4];
    master_fingerprint.copy_from_slice(&identifier[..4]);
    let mut compressed_public_key = [0; 33];
    compressed_public_key[0] = 2 | (public.W[64] & 1);
    compressed_public_key[1..].copy_from_slice(&public.W[1..33]);
    Ok(AccountPublic {
        master_fingerprint,
        compressed_public_key,
        chain_code,
    })
}

/// The input is an unforgeable core review token, never a host-provided digest.
pub fn sign_input(tx: &ReviewedTransaction, index: usize) -> Result<[u8; 64], Error> {
    let path = tx.input_path(index)?;
    let digest = tx.sighash(index)?;
    let mut key = PrivateKey::new();
    tweaked_key(&path, &mut key)?;
    let public = public_key(&mut key)?;
    let mut signature = Zeroizing::new([0; 64]);
    // SAFETY: 32 writable bytes. SDK RNG is infallible at the Rust boundary;
    // fatal hardware RNG failure aborts inside the OS rather than returning data.
    unsafe { sys::cx_rng_no_throw(signature.as_mut_ptr(), 32) };
    let mut length = signature.len();
    // SAFETY: correctly initialized SDK key, 32-byte digest, 64-byte output.
    // CX_RND_PROVIDED is essential: BIP340 consumes the fresh auxiliary random
    // bytes at sig[0..32], then computes its tagged deterministic nonce itself.
    // The SDK also normalizes the tweaked key's output parity as BIP340 requires.
    check(unsafe {
        sys::cx_ecschnorr_sign_no_throw(
            &key.0,
            sys::CX_ECSCHNORR_BIP0340 | sys::CX_RND_PROVIDED | sys::CX_LAST,
            sys::CX_SHA256,
            digest.as_ptr(),
            digest.len(),
            signature.as_mut_ptr(),
            &mut length,
        )
    })?;
    if length != 64 {
        return Err(Error::Crypto);
    }
    // SAFETY: public SDK key and fixed-size signature/digest. On-device
    // verification catches a signing fault before any signature leaves the app.
    let verified = unsafe {
        sys::cx_ecschnorr_verify(
            &public,
            sys::CX_ECSCHNORR_BIP0340,
            sys::CX_SHA256,
            digest.as_ptr(),
            digest.len(),
            signature.as_ptr(),
            length,
        )
    };
    if !verified {
        return Err(Error::Crypto);
    }
    Ok(*signature)
}

/// Validate an external x-only recipient key by lifting its even-Y point using
/// the SDK. A round-trip comparison also rejects any non-canonical reduction.
pub fn validate_output_key(output: &[u8; 32]) -> Result<(), Error> {
    use ledger_device_sdk::ecc::{CurvesId, EcPoint};
    const FIELD: [u8; 32] = [
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
        0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xfe, 0xff, 0xff,
        0xfc, 0x2f,
    ];
    if *output >= FIELD {
        return Err(Error::InvalidData);
    }
    let mut point = EcPoint::new(CurvesId::Secp256k1).map_err(|_| Error::Crypto)?;
    point
        .decompress(output, 0)
        .map_err(|_| Error::InvalidData)?;
    if !point.is_on_curve().map_err(|_| Error::Crypto)?
        || point.is_at_infinity().map_err(|_| Error::Crypto)?
    {
        return Err(Error::InvalidData);
    }
    let mut x = [0; 32];
    let mut y = [0; 32];
    point.export(&mut x, &mut y).map_err(|_| Error::Crypto)?;
    if x != *output || y[31] & 1 != 0 {
        return Err(Error::InvalidData);
    }
    Ok(())
}
