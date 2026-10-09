#![allow(non_snake_case, non_camel_case_types, dead_code)]
// HOST-ONLY AUDIT. Public synthetic scalars 1..=64. No device, credentials, or funds.
extern crate self as ledger_device_sdk;
use std::cell::RefCell;
#[derive(Default)]
struct State {
    calls: Vec<&'static str>,
    fail: Option<&'static str>,
    wrong_len: bool,
    drops: usize,
    drop_positions: Vec<usize>,
    original_scalar_address: Option<usize>,
}
thread_local! { static STATE: RefCell<State> = RefCell::new(State::default()); }
fn call(name: &'static str) -> bool {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        s.calls.push(name);
        s.fail == Some(name)
            || (s.fail == Some("second_public")
                && name == "public"
                && s.calls.iter().filter(|&&c| c == "public").count() == 2)
    })
}
fn observe_drop(d: &[u8], d_len: usize, curve: u32) {
    STATE.with(|s| {
        let mut s = s.borrow_mut();
        if let Some(original) = s.original_scalar_address.take() {
            assert_eq!(d.as_ptr() as usize, original,
                "private-key Drop must wipe the original initialized slot, not a moved copy");
        }
    });
    assert!(d.iter().all(|&b| b == 0));
    assert_eq!(d_len, 0);
    assert_eq!(curve, 0);
    STATE.with(|s| {let mut s=s.borrow_mut();s.drops += 1;let n=s.calls.len();s.drop_positions.push(n);});
}
pub mod hash {
    use ::sha2::{Digest, Sha256};
    pub trait HashInit {
        fn new() -> Self;
        fn hash(&mut self, x: &[u8], out: &mut [u8]) -> Result<(), ()>;
        fn update(&mut self, x: &[u8]) -> Result<(), ()>;
        fn finalize(&mut self, out: &mut [u8]) -> Result<(), ()>;
    }
    pub mod sha2 {
        pub struct Sha2_256(pub(super) ::sha2::Sha256);
    }
    impl HashInit for sha2::Sha2_256 {
        fn new() -> Self {
            Self(Sha256::new())
        }
        fn hash(&mut self, x: &[u8], out: &mut [u8]) -> Result<(), ()> {
            if crate::call("hash") {
                return Err(());
            }
            out.copy_from_slice(&Sha256::digest(x));
            Ok(())
        }
        fn update(&mut self, x: &[u8]) -> Result<(), ()> {
            if crate::call("hash_update") {
                return Err(());
            }
            self.0.update(x);
            Ok(())
        }
        fn finalize(&mut self, out: &mut [u8]) -> Result<(), ()> {
            if crate::call("hash_final") {
                return Err(());
            }
            out.copy_from_slice(&self.0.clone().finalize());
            if crate::STATE.with(|s| s.borrow().fail == Some("tweak_order")) {
                out.copy_from_slice(&[
                    0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
                    0xff, 0xff, 0xfe, 0xba, 0xae, 0xdc, 0xe6, 0xaf, 0x48, 0xa0, 0x3b, 0xbf, 0xd2,
                    0x5e, 0x8c, 0xd0, 0x36, 0x41, 0x41,
                ]);
            }
            Ok(())
        }
    }
}
pub mod sys {
    use secp256k1::{
        Keypair, Message, PublicKey, Scalar, Secp256k1, SecretKey, XOnlyPublicKey,
        schnorr::Signature,
    };
    pub const CX_OK: u32 = 0;
    pub const CX_CURVE_SECP256K1: u32 = 0x21;
    pub const CX_ECSCHNORR_BIP0340: u32 = 0;
    pub const CX_RND_PROVIDED: u32 = 0x800;
    pub const CX_LAST: u32 = 1;
    pub const CX_SHA256: u32 = 3;
    #[repr(C)]
    #[derive(Default)]
    pub struct cx_ecfp_private_key_t {
        pub curve: u32,
        pub d_len: usize,
        pub d: [u8; 32],
    }
    #[repr(C)]
    pub struct cx_ecfp_public_key_t {
        pub curve: u32,
        pub W_len: usize,
        pub W: [u8; 65],
    }
    impl Default for cx_ecfp_public_key_t {
        fn default() -> Self {
            Self {
                curve: 0,
                W_len: 0,
                W: [0; 65],
            }
        }
    }
    fn err(failed: bool) -> u32 {
        if failed { 0xdead } else { 0 }
    }
    pub unsafe fn cx_get_random_bytes(p: *mut core::ffi::c_void, n: usize) -> u32 {
        assert_eq!(n, 32);
        unsafe { std::ptr::write_bytes(p, 0xa5, n) };
        err(crate::call("rng"))
    }
    pub unsafe fn cx_ecfp_init_private_key_no_throw(
        c: u32,
        d: *const u8,
        n: usize,
        k: *mut cx_ecfp_private_key_t,
    ) -> u32 {
        assert_eq!(c, CX_CURVE_SECP256K1);
        assert_eq!(n, 32);
        unsafe {
            crate::STATE.with(|s| s.borrow_mut().original_scalar_address = Some((*k).d.as_ptr() as usize));
            (*k).curve = c;
            (*k).d_len = n;
            (*k).d.copy_from_slice(std::slice::from_raw_parts(d, n));
        }
        err(crate::call("init"))
    }
    pub unsafe fn cx_ecfp_generate_pair_no_throw(
        c: u32,
        p: *mut cx_ecfp_public_key_t,
        k: *mut cx_ecfp_private_key_t,
        keep: bool,
    ) -> u32 {
        assert_eq!(c, CX_CURVE_SECP256K1);
        assert!(keep);
        if crate::call("public") {
            return 0xdead;
        }
        unsafe {
            let s = SecretKey::from_slice(&(*k).d).unwrap();
            (*p).curve = c;
            (*p).W_len = 65;
            (*p).W = PublicKey::from_secret_key(&Secp256k1::new(), &s).serialize_uncompressed();
        }
        0
    }
    pub unsafe fn cx_math_sub_no_throw(r: *mut u8, a: *const u8, b: *const u8, n: usize) -> u32 {
        assert_eq!(n, 32);
        assert_ne!(r as *const u8, b);
        let _ = a;
        if crate::call("sub") {
            return 0xdead;
        }
        unsafe {
            let s = SecretKey::from_slice(std::slice::from_raw_parts(b, n))
                .unwrap()
                .negate();
            std::ptr::copy_nonoverlapping(s.secret_bytes().as_ptr(), r, n);
        }
        0
    }
    pub unsafe fn cx_math_addm_no_throw(
        r: *mut u8,
        a: *const u8,
        b: *const u8,
        m: *const u8,
        n: usize,
    ) -> u32 {
        assert_eq!(n, 32);
        assert_ne!(r as *const u8, a);
        let _ = m;
        if crate::call("addm") {
            return 0xdead;
        }
        if crate::STATE.with(|s| s.borrow().fail == Some("tweaked_zero")) {
            unsafe { std::ptr::write_bytes(r, 0, n) };
            return 0;
        }
        unsafe {
            let a = SecretKey::from_slice(std::slice::from_raw_parts(a, n)).unwrap();
            let t = Scalar::from_be_bytes(std::slice::from_raw_parts(b, n).try_into().unwrap())
                .unwrap();
            let s = a.add_tweak(&t).unwrap();
            std::ptr::copy_nonoverlapping(s.secret_bytes().as_ptr(), r, n);
        }
        0
    }
    pub unsafe fn os_perso_get_master_key_identifier(p: *mut u8, n: usize) -> u32 {
        assert_eq!(n, 20);
        unsafe { std::ptr::write_bytes(p, 0x77, n) };
        err(crate::call("fingerprint"))
    }
    pub unsafe fn cx_ecschnorr_sign_no_throw(
        k: *const cx_ecfp_private_key_t,
        mode: u32,
        h: u32,
        m: *const u8,
        n: usize,
        s: *mut u8,
        l: *mut usize,
    ) -> u32 {
        assert_eq!(mode, CX_ECSCHNORR_BIP0340 | CX_RND_PROVIDED | CX_LAST);
        assert_eq!(h, CX_SHA256);
        assert_eq!(n, 32);
        unsafe {
            assert_eq!(*l, 64);
            assert_eq!(std::slice::from_raw_parts(s, 32), &[0xa5; 32]);
        }
        if crate::call("sign") {
            return 0xdead;
        }
        unsafe {
            let secp = Secp256k1::new();
            let kp = Keypair::from_secret_key(&secp, &SecretKey::from_slice(&(*k).d).unwrap());
            let msg = Message::from_digest_slice(std::slice::from_raw_parts(m, n)).unwrap();
            let sig = secp.sign_schnorr_with_aux_rand(&msg, &kp, &[0xa5; 32]);
            std::ptr::copy_nonoverlapping(sig.as_ref().as_ptr(), s, 64);
            *l = crate::STATE.with(|s| if s.borrow().wrong_len { 63 } else { 64 });
        }
        0
    }
    pub unsafe fn cx_ecschnorr_verify(
        p: *const cx_ecfp_public_key_t,
        mode: u32,
        h: u32,
        m: *const u8,
        n: usize,
        s: *const u8,
        l: usize,
    ) -> bool {
        assert_eq!(mode, CX_ECSCHNORR_BIP0340);
        assert_eq!(h, CX_SHA256);
        assert_eq!(n, 32);
        assert_eq!(l, 64);
        if crate::call("verify") {
            return false;
        }
        unsafe {
            let p = XOnlyPublicKey::from_slice(&(&(*p).W)[1..33]).unwrap();
            let msg = Message::from_digest_slice(std::slice::from_raw_parts(m, n)).unwrap();
            let sig = Signature::from_slice(std::slice::from_raw_parts(s, l)).unwrap();
            Secp256k1::new().verify_schnorr(&sig, &msg, &p).is_ok()
        }
    }
}
pub mod ecc {
    pub enum CurvesId {
        Secp256k1,
    }
    pub struct EcPoint;
    impl EcPoint {
        pub fn new(_: CurvesId) -> Result<Self, ()> {
            Ok(Self)
        }
        pub fn decompress(&mut self, _: &[u8], _: u8) -> Result<(), ()> {
            Ok(())
        }
        pub fn is_on_curve(&self) -> Result<bool, ()> {
            Ok(true)
        }
        pub fn is_at_infinity(&self) -> Result<bool, ()> {
            Ok(false)
        }
        pub fn export(&self, _: &mut [u8], _: &mut [u8]) -> Result<(), ()> {
            Ok(())
        }
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn pearl_scalar_is_zero(p: *const u8) -> bool {
    unsafe {
        std::slice::from_raw_parts(p, 32)
            .iter()
            .fold(0, |a, b| a | b)
            == 0
    }
}
#[unsafe(no_mangle)]
unsafe extern "C" fn pearl_derive_bip32_no_throw(
    p: *const u32,
    n: usize,
    raw: *mut u8,
    chain: *mut u8,
) -> u32 {
    assert!(!p.is_null());
    assert!(n == 3 || n == 5);
    unsafe {
        let path = std::slice::from_raw_parts(p, n);
        assert_eq!(path[0], 86 | 0x8000_0000);
        std::ptr::write_bytes(raw, 0, 64);
        *raw.add(31) = if n == 5 {
            ((path[4] % 250) + 1) as u8
        } else {
            1
        };
        std::ptr::write_bytes(chain, 0x44, 32);
    }
    if call("derive") { 0xdead } else { 0 }
}
#[path = "crypto_instrumented.rs"]
mod crypto;

#[cfg(test)]
mod tests {
    use super::*;
    use pearl_core::*;
    struct Mock {
        fail: Option<&'static str>,
        wrong_len: bool,
        key: [u8; 32],
        signed: usize,
    }
    impl PublicKeyProvider for Mock {
        fn validate_output_key(&mut self, _: &[u8; 32]) -> Result<(), Error> {
            Ok(())
        }
        fn derive_output_key(&mut self, _: &DerivationPath) -> Result<[u8; 32], Error> {
            Ok(self.key)
        }
    }
    impl Device for Mock {
        fn account_public(&mut self, p: &AccountPath) -> Result<AccountPublic, Error> {
            crypto::account_public(p)
        }
        fn confirm_account(&mut self, _: &AccountPath, _: &AccountPublic) -> Result<(), Error> {
            Ok(())
        }
        fn confirm_address(&mut self, _: &DerivationPath, _: &Address) -> Result<(), Error> {
            Ok(())
        }
        fn review_transaction(&mut self, _: &ValidatedTransaction) -> Result<(), Error> {
            STATE.with(|s| {
                *s.borrow_mut() = State {
                    fail: self.fail,
                    wrong_len: self.wrong_len,
                    ..State::default()
                }
            });
            Ok(())
        }
        fn sign_input(&mut self, t: &ReviewedTransaction, i: usize) -> Result<[u8; 64], Error> {
            self.signed += 1;
            crypto::sign_input(t, i)
        }
    }
    fn apdu(ins: u8, d: &[u8]) -> Vec<u8> {
        let mut r = vec![0xe0, ins, 0, 0, d.len() as u8];
        r.extend(d);
        r
    }
    fn run(fail: Option<&'static str>, wrong_len: bool) -> (u16, Vec<&'static str>, usize, bool) {
        STATE.with(|s| *s.borrow_mut() = State::default());
        let path = DerivationPath::new(Network::Simnet, 0, 0, 0).unwrap();
        let key = crypto::output_key(&path).unwrap();
        let mut b = b"PRL1".to_vec();
        b.push(Network::Simnet as u8);
        b.extend(0u32.to_le_bytes());
        b.extend(1u32.to_le_bytes());
        b.extend(0u32.to_le_bytes());
        b.extend([1, 1]);
        b.extend([7; 32]);
        b.extend(0u32.to_le_bytes());
        b.extend(10u64.to_le_bytes());
        b.extend([0x51, 0x20]);
        b.extend(key);
        b.extend(u32::MAX.to_le_bytes());
        b.push(0);
        b.extend(0u32.to_le_bytes());
        b.extend(9u64.to_le_bytes());
        b.extend([0x51, 0x20]);
        b.extend(key);
        b.extend([0, 0]);
        b.extend(0u32.to_le_bytes());
        let mut d = Mock {
            fail,
            wrong_len,
            key,
            signed: 0,
        };
        let mut session = Session::new(Network::Simnet);
        let mut init = (b.len() as u16).to_le_bytes().to_vec();
        init.extend(bundle_hash(&b));
        assert_eq!(
            session.handle_apdu(&apdu(0x10, &init), &mut d).status(),
            0x9000
        );
        let mut chunk = 0u16.to_le_bytes().to_vec();
        chunk.extend(b);
        assert_eq!(
            session.handle_apdu(&apdu(0x11, &chunk), &mut d).status(),
            0x9000
        );
        let r = session.handle_apdu(&apdu(0x12, &[]), &mut d);
        let status = r.status();
        let (calls, drops) = STATE.with(|s| (s.borrow().calls.clone(), s.borrow().drops));
        if status != 0x9000 {
            assert!(r.data().is_empty());
            assert_eq!(
                session.handle_apdu(&apdu(0x13, &[0]), &mut d).status(),
                Error::WrongState.status_word()
            );
        } else {
            assert_eq!(
                session.handle_apdu(&apdu(0x13, &[0]), &mut d).data().len(),
                64
            );
        }
        (status, calls, drops, session.is_idle())
    }
    #[test]
    fn rng_error_is_returned_before_any_key_derivation() {
        let (s, c, d, idle) = run(Some("rng"), false);
        assert_eq!(s, Error::Crypto.status_word());
        assert_eq!(c, vec!["rng"]);
        assert_eq!(d, 0);
        assert!(idle);
    }
    #[test]
    fn success_preserves_aux_and_bip340_mode() {
        let (s, c, d, idle) = run(None, false);
        assert_eq!(s, 0x9000);
        assert_eq!(c[0], "rng");
        assert_eq!(c[1], "derive");
        assert!(c.contains(&"sign") && c.contains(&"verify"));
        assert_eq!(d, 1);
        assert!(idle);
    }
    #[test]
    fn all_modeled_returned_failures_zero_key_and_invalidate_session() {
        for f in [
            "derive",
            "init",
            "public",
            "hash",
            "hash_update",
            "hash_final",
            "addm",
            "sign",
            "verify",
        ] {
            let (s, c, d, idle) = run(Some(f), false);
            assert_eq!(s, Error::Crypto.status_word(), "{f}: {c:?}");
            assert_eq!(d, 1, "{f}");
            assert!(idle);
            assert_eq!(c.last(), Some(&f));
        }
    }
    #[test]
    fn wrong_signature_length_fails_before_verification() {
        let (s, c, d, idle) = run(None, true);
        assert_eq!(s, Error::Crypto.status_word());
        assert!(c.contains(&"sign"));
        assert!(!c.contains(&"verify"));
        assert_eq!(d, 1);
        assert!(idle);
    }
    #[test]
    fn bip86_secret_tweak_matches_public_tweak_for_both_parities() {
        use ::sha2::{Digest, Sha256};
        use secp256k1::{Parity, PublicKey, Scalar, Secp256k1, SecretKey};
        let secp = Secp256k1::new();
        let mut odd = 0;
        let mut even = 0;
        for index in 0..64u32 {
            STATE.with(|s| *s.borrow_mut() = State::default());
            let path = DerivationPath::new(Network::Simnet, 0, 0, index).unwrap();
            let actual = crypto::output_key(&path).unwrap();
            let mut secret = [0; 32];
            secret[31] = (index + 1) as u8;
            let public =
                PublicKey::from_secret_key(&secp, &SecretKey::from_slice(&secret).unwrap());
            let (x, parity) = public.x_only_public_key();
            if parity == Parity::Odd {
                odd += 1
            } else {
                even += 1
            }
            let tag = Sha256::digest(b"TapTweak");
            let mut hash = Sha256::new();
            hash.update(tag);
            hash.update(tag);
            hash.update(x.serialize());
            let tweak = Scalar::from_be_bytes(hash.finalize().into()).unwrap();
            let expected = x.add_tweak(&secp, &tweak).unwrap().0.serialize();
            assert_eq!(actual, expected, "index {index}");
            assert_eq!(STATE.with(|s| s.borrow().drops), 1);
        }
        assert!(odd > 0 && even > 0);
        println!("public/secret BIP86 agreement: {odd} odd-Y and {even} even-Y internal keys");
    }

    #[test]
    fn exact_order_tweak_and_zero_tweaked_scalar_fail_closed() {
        for reason in ["tweak_order", "tweaked_zero", "second_public"] {
            let (status, calls, drops, idle) = run(Some(reason), false);
            assert_eq!(status, Error::Crypto.status_word(), "{reason}: {calls:?}");
            assert!(!calls.contains(&"sign"));
            assert_eq!(drops, 1);
            assert!(idle);
            if reason == "tweak_order" {
                assert!(!calls.contains(&"addm"));
            }
        }
    }
    #[test]
    fn returned_master_identifier_error_wipes_private_key() {
        STATE.with(|s| {
            *s.borrow_mut() = State {
                fail: Some("fingerprint"),
                ..State::default()
            }
        });
        assert_eq!(
            crypto::account_public(&AccountPath::new(Network::Simnet, 0).unwrap()),
            Err(Error::Crypto)
        );
        STATE.with(|s| {
            let s = s.borrow();
            assert_eq!(s.calls, vec!["derive", "init", "public", "fingerprint"]);
            assert_eq!(s.drops, 1);
        });
    }
    #[test] fn private_keys_are_gone_before_public_only_syscalls() {
        STATE.with(|s|*s.borrow_mut()=State::default());
        crypto::account_public(&AccountPath::new(Network::Simnet,0).unwrap()).unwrap();
        STATE.with(|s| {let s=s.borrow();assert_eq!(s.drop_positions,vec![3]);assert_eq!(s.calls[3],"fingerprint");});
        let(status,calls,_,_)=run(None,false);assert_eq!(status,0x9000);
        STATE.with(|s|{let s=s.borrow();assert_eq!(s.drop_positions.len(),1);assert_eq!(calls[s.drop_positions[0]],"verify");});
    }

}
