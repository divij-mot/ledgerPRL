use crate::{Error, Network};
use bech32::{segwit, Hrp};
use core::fmt::{self, Write};

pub const ADDRESS_CAPACITY: usize = 64;

/// Fixed-size, complete lowercase Bech32m witness-v1 address.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Address {
    bytes: [u8; ADDRESS_CAPACITY],
    len: usize,
}
impl Address {
    pub fn from_output_key(network: Network, output_key: &[u8; 32]) -> Result<Self, Error> {
        let mut address = Self {
            bytes: [0; ADDRESS_CAPACITY],
            len: 0,
        };
        let hrp = Hrp::parse(network.hrp()).map_err(|_| Error::InvalidNetwork)?;
        // Unchecked refers to witness-program validation, which is guaranteed:
        // fixed 32-byte program, witness version 1, known lowercase network HRP.
        segwit::encode_to_fmt_unchecked(
            &mut AddressWriter(&mut address),
            hrp,
            segwit::VERSION_1,
            output_key,
        )
        .map_err(|_| Error::InvalidData)?;
        Ok(address)
    }
    pub fn as_str(&self) -> &str {
        // All bytes originate in the Bech32 ASCII writer; retain a safe fallback
        // rather than introducing unsafe conversion or panicking in firmware.
        core::str::from_utf8(&self.bytes[..self.len]).unwrap_or("")
    }
}
struct AddressWriter<'a>(&'a mut Address);
impl Write for AddressWriter<'_> {
    fn write_str(&mut self, text: &str) -> fmt::Result {
        let end = self.0.len.checked_add(text.len()).ok_or(fmt::Error)?;
        if !text.is_ascii() || end > self.0.bytes.len() {
            return Err(fmt::Error);
        }
        self.0.bytes[self.0.len..end].copy_from_slice(text.as_bytes());
        self.0.len = end;
        Ok(())
    }
}
impl fmt::Display for Address {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
