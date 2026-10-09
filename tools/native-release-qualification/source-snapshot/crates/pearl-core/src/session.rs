use crate::{
    bundle_hash, parse_bundle, AccountPath, Address, DerivationPath, Error, Network,
    PublicKeyProvider, ReviewedTransaction, ValidatedTransaction, MAX_BUNDLE_SIZE, MAX_INPUTS,
    MIN_BUNDLE_SIZE,
};
use zeroize::Zeroize;

/// Public-only account metadata. The native adapter never returns private keys.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AccountPublic {
    pub master_fingerprint: [u8; 4],
    pub compressed_public_key: [u8; 33],
    pub chain_code: [u8; 32],
}

/// The native trust boundary. Confirmation methods must display the complete
/// supplied values on the device and wait for physical approval. They must fail
/// closed on cancellation, timeout, UI error or disconnect. There is no default
/// approval implementation. Signing must use SDK-held keys and verify its own
/// result; the only input is an immutable transaction approved in this session.
pub trait Device: PublicKeyProvider {
    fn account_public(&mut self, path: &AccountPath) -> Result<AccountPublic, Error>;
    fn confirm_account(&mut self, path: &AccountPath, public: &AccountPublic) -> Result<(), Error>;
    fn confirm_address(&mut self, path: &DerivationPath, address: &Address) -> Result<(), Error>;
    fn review_transaction(&mut self, transaction: &ValidatedTransaction) -> Result<(), Error>;
    fn sign_input(
        &mut self,
        transaction: &ReviewedTransaction,
        input_index: usize,
    ) -> Result<[u8; 64], Error>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum SessionState {
    Idle,
    Receiving,
    Signatures,
}

/// Response data excludes the two-byte big-endian transport status word.
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Response {
    bytes: [u8; 74],
    len: usize,
    status: u16,
}
impl Response {
    fn success(data: &[u8]) -> Self {
        let mut response = Self {
            bytes: [0; 74],
            len: data.len(),
            status: 0x9000,
        };
        response.bytes[..data.len()].copy_from_slice(data);
        response
    }
    fn failure(error: Error) -> Self {
        Self {
            bytes: [0; 74],
            len: 0,
            status: error.status_word(),
        }
    }
    pub fn data(&self) -> &[u8] {
        &self.bytes[..self.len]
    }
    pub const fn status(&self) -> u16 {
        self.status
    }
}

/// One bounded session. Every error wipes all buffers and returns to Idle.
/// The adapter MUST call reset for disconnect, timeout and app-exit events.
/// No Clone implementation: there is only one owner of approval/signature state.
pub struct Session {
    network: Network,
    state: SessionState,
    payload: [u8; MAX_BUNDLE_SIZE],
    expected_len: usize,
    received: usize,
    expected_hash: [u8; 32],
    signatures: [[u8; 64]; MAX_INPUTS],
    signature_count: usize,
    next_signature: usize,
}
impl Session {
    pub const fn new(network: Network) -> Self {
        Self {
            network,
            state: SessionState::Idle,
            payload: [0; MAX_BUNDLE_SIZE],
            expected_len: 0,
            received: 0,
            expected_hash: [0; 32],
            signatures: [[0; 64]; MAX_INPUTS],
            signature_count: 0,
            next_signature: 0,
        }
    }
    pub const fn is_idle(&self) -> bool {
        matches!(self.state, SessionState::Idle)
    }
    pub const fn state(&self) -> SessionState {
        self.state
    }
    pub fn reset(&mut self) {
        self.payload.zeroize();
        self.expected_hash.zeroize();
        self.signatures.zeroize();
        self.expected_len = 0;
        self.received = 0;
        self.signature_count = 0;
        self.next_signature = 0;
        self.state = SessionState::Idle;
    }
    pub fn on_disconnect(&mut self) {
        self.reset();
    }
    pub fn on_timeout(&mut self) {
        self.reset();
    }
    pub fn on_app_exit(&mut self) {
        self.reset();
    }

    /// Parse a complete ISO7816 short APDU: CLA INS P1 P2 Lc DATA, no Le.
    /// No untrusted caller supplies signing digests, approval flags or signatures.
    pub fn handle_apdu(&mut self, raw: &[u8], device: &mut impl Device) -> Response {
        match self.handle_inner(raw, device) {
            Ok(response) => response,
            Err(error) => {
                self.reset();
                Response::failure(error)
            }
        }
    }
    fn handle_inner(&mut self, raw: &[u8], device: &mut impl Device) -> Result<Response, Error> {
        if raw.len() < 5 || raw.len() != 5 + usize::from(raw[4]) {
            return Err(Error::WrongLength);
        }
        if raw[0] != 0xe0 {
            return Err(Error::UnsupportedClass);
        }
        if raw[2] != 0 || raw[3] != 0 {
            return Err(Error::WrongParameters);
        }
        let data = &raw[5..];
        match raw[1] {
            0x00 => {
                // Capabilities are side-effect-free only outside a signing session.
                empty(data)?;
                self.require_state(SessionState::Idle)?;
                let max = (MAX_BUNDLE_SIZE as u16).to_le_bytes();
                Ok(Response::success(&[
                    1,
                    0,
                    1,
                    0,
                    self.network as u8,
                    MAX_INPUTS as u8,
                    max[0],
                    max[1],
                ]))
            }
            0x01 => {
                self.require_state(SessionState::Idle)?;
                if data.len() != 4 {
                    return Err(Error::WrongLength);
                }
                let path = AccountPath::new(self.network, u32_from(data)?)?;
                let public = device.account_public(&path)?;
                if !matches!(public.compressed_public_key[0], 2 | 3) {
                    return Err(Error::Crypto);
                }
                device.confirm_account(&path, &public)?;
                let mut response = [0; 74];
                response[..4].copy_from_slice(&public.master_fingerprint);
                response[4..37].copy_from_slice(&public.compressed_public_key);
                response[37..69].copy_from_slice(&public.chain_code);
                response[69] = self.network as u8;
                response[70..74].copy_from_slice(&path.account().to_le_bytes());
                Ok(Response::success(&response))
            }
            0x02 => {
                self.require_state(SessionState::Idle)?;
                if data.len() != 9 {
                    return Err(Error::WrongLength);
                }
                let path = DerivationPath::new(
                    self.network,
                    u32_from(&data[..4])?,
                    data[4],
                    u32_from(&data[5..])?,
                )?;
                let key = device.derive_output_key(&path)?;
                let address = Address::from_output_key(self.network, &key)?;
                device.confirm_address(&path, &address)?;
                Ok(Response::success(address.as_str().as_bytes()))
            }
            0x10 => {
                self.require_state(SessionState::Idle)?;
                if data.len() != 34 {
                    return Err(Error::WrongLength);
                }
                let size = usize::from(u16::from_le_bytes([data[0], data[1]]));
                if !(MIN_BUNDLE_SIZE..=MAX_BUNDLE_SIZE).contains(&size) {
                    return Err(Error::WrongLength);
                }
                self.expected_hash.copy_from_slice(&data[2..]);
                self.expected_len = size;
                self.received = 0;
                self.state = SessionState::Receiving;
                Ok(Response::success(&[]))
            }
            0x11 => {
                self.require_state(SessionState::Receiving)?;
                if data.len() < 3 {
                    return Err(Error::WrongLength);
                }
                let offset = usize::from(u16::from_le_bytes([data[0], data[1]]));
                if offset != self.received {
                    return Err(Error::InvalidData);
                }
                let end = self
                    .received
                    .checked_add(data.len() - 2)
                    .ok_or(Error::WrongLength)?;
                if end > self.expected_len {
                    return Err(Error::WrongLength);
                }
                self.payload[self.received..end].copy_from_slice(&data[2..]);
                self.received = end;
                Ok(Response::success(&[]))
            }
            0x12 => {
                empty(data)?;
                self.require_state(SessionState::Receiving)?;
                if self.received != self.expected_len {
                    return Err(Error::WrongState);
                }
                let hash = bundle_hash(&self.payload[..self.received]);
                if hash != self.expected_hash {
                    return Err(Error::HashMismatch);
                }
                let parsed = parse_bundle(&self.payload[..self.received], self.network)?;
                let validated = parsed.validate_ownership(device)?;
                device.review_transaction(&validated)?;
                let reviewed = ReviewedTransaction::approved(validated);
                let count = reviewed.transaction().inputs().len();
                for i in 0..count {
                    self.signatures[i] = device.sign_input(&reviewed, i)?;
                }
                // No signature is returned until every input was successfully signed.
                let mut response = [0; 33];
                response[0] = count as u8;
                response[1..].copy_from_slice(&hash);
                self.payload.zeroize();
                self.expected_hash.zeroize();
                self.expected_len = 0;
                self.received = 0;
                self.signature_count = count;
                self.next_signature = 0;
                self.state = SessionState::Signatures;
                Ok(Response::success(&response))
            }
            0x13 => {
                self.require_state(SessionState::Signatures)?;
                if data.len() != 1 {
                    return Err(Error::WrongLength);
                }
                if usize::from(data[0]) != self.next_signature {
                    return Err(Error::InvalidData);
                }
                let response = Response::success(&self.signatures[self.next_signature]);
                self.signatures[self.next_signature].zeroize();
                self.next_signature += 1;
                if self.next_signature == self.signature_count {
                    self.reset();
                }
                Ok(response)
            }
            0x14 => {
                empty(data)?;
                self.reset();
                Ok(Response::success(&[]))
            }
            _ => Err(Error::UnsupportedInstruction),
        }
    }
    fn require_state(&self, state: SessionState) -> Result<(), Error> {
        if self.state == state {
            Ok(())
        } else {
            Err(Error::WrongState)
        }
    }
}
impl Drop for Session {
    fn drop(&mut self) {
        self.reset();
    }
}
fn empty(data: &[u8]) -> Result<(), Error> {
    if data.is_empty() {
        Ok(())
    } else {
        Err(Error::WrongLength)
    }
}
fn u32_from(data: &[u8]) -> Result<u32, Error> {
    let bytes: [u8; 4] = data.try_into().map_err(|_| Error::WrongLength)?;
    Ok(u32::from_le_bytes(bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reset_zeroizes_all_transfer_and_signature_storage() {
        let mut session = Session::new(Network::Mainnet);
        session.payload.fill(0xa5);
        session.expected_hash.fill(0x55);
        session.signatures.fill([0x77; 64]);
        session.expected_len = MAX_BUNDLE_SIZE;
        session.received = MAX_BUNDLE_SIZE;
        session.signature_count = MAX_INPUTS;
        session.next_signature = 7;
        session.state = SessionState::Signatures;
        session.reset();
        assert!(session.payload.iter().all(|b| *b == 0));
        assert!(session.expected_hash.iter().all(|b| *b == 0));
        assert!(session.signatures.iter().flatten().all(|b| *b == 0));
        assert_eq!(session.expected_len, 0);
        assert_eq!(session.received, 0);
        assert_eq!(session.signature_count, 0);
        assert_eq!(session.next_signature, 0);
        assert!(session.is_idle());
    }
}
