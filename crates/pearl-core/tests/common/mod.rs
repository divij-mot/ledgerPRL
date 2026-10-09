#![allow(dead_code)]
use pearl_core::*;

// This mock maps PUBLIC test identifiers to PUBLIC output bytes; it is NOT a
// BIP32/BIP86 or signature implementation and is never compiled into firmware.
#[derive(Default)]
pub struct MockDevice {
    pub reject: bool,
    pub fail_sign: Option<usize>,
    pub reviewed: usize,
    pub signed: usize,
    pub confirmed: usize,
    pub derived: usize,
}
pub fn key(branch: u8, index: u32) -> [u8; 32] {
    let mut result = [0x77; 32];
    result[0] = branch;
    result[1..5].copy_from_slice(&index.to_le_bytes());
    result
}
pub fn script(branch: u8, index: u32) -> [u8; 34] {
    let mut result = [0; 34];
    result[..2].copy_from_slice(&[0x51, 0x20]);
    result[2..].copy_from_slice(&key(branch, index));
    result
}
impl PublicKeyProvider for MockDevice {
    fn validate_output_key(&mut self, output_key: &[u8; 32]) -> Result<(), Error> {
        if *output_key == [0xff; 32] {
            Err(Error::InvalidData)
        } else {
            Ok(())
        }
    }
    fn derive_output_key(&mut self, path: &DerivationPath) -> Result<[u8; 32], Error> {
        self.derived += 1;
        Ok(key(path.branch(), path.index()))
    }
}
impl MockDevice {
    fn confirm(&mut self) -> Result<(), Error> {
        self.confirmed += 1;
        if self.reject {
            Err(Error::UserRejected)
        } else {
            Ok(())
        }
    }
}
impl Device for MockDevice {
    fn account_public(&mut self, _: &AccountPath) -> Result<AccountPublic, Error> {
        let mut compressed_public_key = [0x77; 33];
        compressed_public_key[0] = 2;
        Ok(AccountPublic {
            master_fingerprint: [1, 2, 3, 4],
            compressed_public_key,
            chain_code: [0x99; 32],
        })
    }
    fn confirm_account(&mut self, _: &AccountPath, _: &AccountPublic) -> Result<(), Error> {
        self.confirm()
    }
    fn confirm_address(&mut self, _: &DerivationPath, address: &Address) -> Result<(), Error> {
        assert!(address.as_str().starts_with("rprl1p"));
        self.confirm()
    }
    fn review_transaction(&mut self, tx: &ValidatedTransaction) -> Result<(), Error> {
        assert!(!tx.recipient_address().as_str().is_empty());
        self.reviewed += 1;
        self.confirm()
    }
    fn sign_input(&mut self, tx: &ReviewedTransaction, index: usize) -> Result<[u8; 64], Error> {
        assert_eq!(self.reviewed, 1);
        tx.sighash(index)?;
        tx.input_path(index)?;
        if self.fail_sign == Some(index) {
            return Err(Error::Crypto);
        }
        self.signed += 1;
        Ok([index as u8 + 1; 64])
    }
}
pub fn bundle(input_count: usize, with_change: bool) -> Vec<u8> {
    bundle_with_amount(input_count, with_change, 100_000_000)
}
pub fn bundle_with_amount(input_count: usize, with_change: bool, amount: u64) -> Vec<u8> {
    let mut bytes = b"PRL1".to_vec();
    bytes.push(Network::Regtest as u8);
    bytes.extend(0u32.to_le_bytes());
    bytes.extend(1i32.to_le_bytes());
    bytes.extend(0u32.to_le_bytes());
    bytes.push(input_count as u8);
    bytes.push(if with_change { 2 } else { 1 });
    for i in 0..input_count {
        bytes.extend([i as u8 + 1; 32]);
        bytes.extend((i as u32).to_le_bytes());
        bytes.extend(amount.to_le_bytes());
        bytes.extend(script(0, i as u32));
        bytes.extend(u32::MAX.to_le_bytes());
        bytes.push(0);
        bytes.extend((i as u32).to_le_bytes());
    }
    let total = amount * input_count as u64;
    let change = if with_change { total / 3 } else { 0 };
    bytes.extend((total - change - 10).to_le_bytes());
    bytes.extend(script(0, 12345));
    bytes.push(0);
    bytes.push(0);
    bytes.extend(0u32.to_le_bytes());
    if with_change {
        bytes.extend(change.to_le_bytes());
        bytes.extend(script(1, 7));
        bytes.push(1);
        bytes.push(1);
        bytes.extend(7u32.to_le_bytes());
    }
    bytes
}
pub fn apdu(ins: u8, data: &[u8]) -> Vec<u8> {
    assert!(data.len() <= 255);
    let mut out = vec![0xe0, ins, 0, 0, data.len() as u8];
    out.extend(data);
    out
}
pub fn begin(session: &mut Session, device: &mut MockDevice, bytes: &[u8]) {
    let mut data = (bytes.len() as u16).to_le_bytes().to_vec();
    data.extend(bundle_hash(bytes));
    assert_eq!(
        session.handle_apdu(&apdu(0x10, &data), device).status(),
        0x9000
    );
}
pub fn transfer(session: &mut Session, device: &mut MockDevice, bytes: &[u8]) {
    begin(session, device, bytes);
    for (i, chunk) in bytes.chunks(253).enumerate() {
        let mut data = ((i * 253) as u16).to_le_bytes().to_vec();
        data.extend(chunk);
        assert_eq!(
            session.handle_apdu(&apdu(0x11, &data), device).status(),
            0x9000
        );
    }
}
