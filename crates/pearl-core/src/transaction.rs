use crate::{Address, Amount, DerivationPath, Error, Network};
use sha2::{Digest, Sha256};

pub const MAX_INPUTS: usize = 16;
pub const MAX_OUTPUTS: usize = 2;
pub const MAX_BUNDLE_SIZE: usize = 19 + 87 * MAX_INPUTS + 48 * MAX_OUTPUTS;
pub const MIN_BUNDLE_SIZE: usize = 19 + 87 + 48;

/// The trusted native adapter derives an empty-tree BIP86 output key itself.
/// Never implement this by returning a key supplied by the host bundle.
pub trait PublicKeyProvider {
    /// Reject values that cannot be lifted to a finite secp256k1 x-only point.
    /// Use the native SDK point parser; never a host-provided validity flag.
    fn validate_output_key(&mut self, output_key: &[u8; 32]) -> Result<(), Error>;
    fn derive_output_key(&mut self, path: &DerivationPath) -> Result<[u8; 32], Error>;
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Input {
    txid: [u8; 32],
    vout: u32,
    amount: u64,
    script: [u8; 34],
    sequence: u32,
    branch: u8,
    index: u32,
}
impl Input {
    const EMPTY: Self = Self {
        txid: [0; 32],
        vout: 0,
        amount: 0,
        script: [0; 34],
        sequence: 0,
        branch: 0,
        index: 0,
    };
    /// Internal/wire byte order, never the reversed explorer display order.
    pub fn txid(&self) -> &[u8; 32] {
        &self.txid
    }
    pub const fn vout(&self) -> u32 {
        self.vout
    }
    pub const fn amount(&self) -> u64 {
        self.amount
    }
    pub fn script(&self) -> &[u8; 34] {
        &self.script
    }
    pub const fn sequence(&self) -> u32 {
        self.sequence
    }
    pub const fn branch(&self) -> u8 {
        self.branch
    }
    pub const fn index(&self) -> u32 {
        self.index
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum OutputRole {
    Recipient = 0,
    Change = 1,
}
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Output {
    amount: u64,
    script: [u8; 34],
    role: OutputRole,
    branch: u8,
    index: u32,
}
impl Output {
    const EMPTY: Self = Self {
        amount: 0,
        script: [0; 34],
        role: OutputRole::Recipient,
        branch: 0,
        index: 0,
    };
    pub const fn amount(&self) -> u64 {
        self.amount
    }
    pub fn script(&self) -> &[u8; 34] {
        &self.script
    }
    pub const fn role(&self) -> OutputRole {
        self.role
    }
    pub const fn branch(&self) -> u8 {
        self.branch
    }
    pub const fn index(&self) -> u32 {
        self.index
    }
    pub fn output_key(&self) -> [u8; 32] {
        let mut key = [0; 32];
        key.copy_from_slice(&self.script[2..]);
        key
    }
}

/// Syntactically and monetarily validated canonical transaction, with no setters.
/// This is not approval to sign: all ownership must be authenticated first.
#[derive(Debug)]
pub struct Transaction {
    network: Network,
    account: u32,
    version: i32,
    locktime: u32,
    inputs: [Input; MAX_INPUTS],
    input_count: u8,
    outputs: [Output; MAX_OUTPUTS],
    output_count: u8,
    recipient_index: usize,
    change_index: Option<usize>,
    input_total: u64,
    output_total: u64,
}
impl Transaction {
    pub const fn network(&self) -> Network {
        self.network
    }
    pub const fn account(&self) -> u32 {
        self.account
    }
    pub const fn version(&self) -> i32 {
        self.version
    }
    pub const fn locktime(&self) -> u32 {
        self.locktime
    }
    pub fn inputs(&self) -> &[Input] {
        &self.inputs[..usize::from(self.input_count)]
    }
    pub fn outputs(&self) -> &[Output] {
        &self.outputs[..usize::from(self.output_count)]
    }
    pub fn recipient(&self) -> &Output {
        &self.outputs[self.recipient_index]
    }
    pub fn change(&self) -> Option<&Output> {
        self.change_index.map(|i| &self.outputs[i])
    }
    pub const fn input_total(&self) -> u64 {
        self.input_total
    }
    pub const fn output_total(&self) -> u64 {
        self.output_total
    }
    pub const fn fee(&self) -> u64 {
        self.input_total - self.output_total
    }
    pub fn input_path(&self, index: usize) -> Result<DerivationPath, Error> {
        let input = self.inputs().get(index).ok_or(Error::InvalidData)?;
        DerivationPath::new(self.network, self.account, input.branch, input.index)
    }

    /// Authenticate every input and change using device-derived public keys.
    /// Host fingerprints and change-role flags alone never establish ownership.
    pub fn validate_ownership(
        self,
        provider: &mut impl PublicKeyProvider,
    ) -> Result<ValidatedTransaction, Error> {
        provider.validate_output_key(&self.recipient().output_key())?;
        for (i, input) in self.inputs().iter().enumerate() {
            let expected = provider.derive_output_key(&self.input_path(i)?)?;
            if input.script[2..] != expected {
                return Err(Error::OwnershipMismatch);
            }
        }
        if let Some(change) = self.change() {
            let path =
                DerivationPath::new(self.network, self.account, change.branch, change.index)?;
            let expected = provider.derive_output_key(&path)?;
            if change.script[2..] != expected {
                return Err(Error::OwnershipMismatch);
            }
        }
        let recipient_address =
            Address::from_output_key(self.network, &self.recipient().output_key())?;
        let change_address = self
            .change()
            .map(|c| Address::from_output_key(self.network, &c.output_key()))
            .transpose()?;
        Ok(ValidatedTransaction {
            transaction: self,
            recipient_address,
            change_address,
        })
    }

    /// BIP341 epoch-zero, SIGHASH_DEFAULT, key-path, no-annex digest.
    /// The digest binds every transaction input/prevout/sequence and every output.
    /// Network/path/role are policy metadata, not additions to consensus hashing.
    pub fn sighash(&self, input_index: usize) -> Result<[u8; 32], Error> {
        if input_index >= self.inputs().len() {
            return Err(Error::InvalidData);
        }
        let mut outpoints = Sha256::new();
        let mut amounts = Sha256::new();
        let mut scripts = Sha256::new();
        let mut sequences = Sha256::new();
        for input in self.inputs() {
            outpoints.update(input.txid);
            outpoints.update(input.vout.to_le_bytes());
            amounts.update(input.amount.to_le_bytes());
            scripts.update([34]);
            scripts.update(input.script); // canonical CompactSize(34)
            sequences.update(input.sequence.to_le_bytes());
        }
        let mut outputs = Sha256::new();
        for output in self.outputs() {
            outputs.update(output.amount.to_le_bytes());
            outputs.update([34]);
            outputs.update(output.script);
        }
        let tag = Sha256::digest(b"TapSighash");
        let mut hash = Sha256::new();
        hash.update(tag);
        hash.update(tag);
        hash.update([0, 0]); // epoch=0, hash_type=SIGHASH_DEFAULT
        hash.update(self.version.to_le_bytes());
        hash.update(self.locktime.to_le_bytes());
        hash.update(outpoints.finalize());
        hash.update(amounts.finalize());
        hash.update(scripts.finalize());
        hash.update(sequences.finalize());
        hash.update(outputs.finalize());
        hash.update([0]); // spend_type = ext_flag*2 + annex_present = 0
        hash.update((input_index as u32).to_le_bytes());
        Ok(hash.finalize().into())
    }
}

/// Ownership-validated, immutable review payload. This cannot authorize signing.
#[derive(Debug)]
pub struct ValidatedTransaction {
    transaction: Transaction,
    recipient_address: Address,
    change_address: Option<Address>,
}
impl ValidatedTransaction {
    pub fn transaction(&self) -> &Transaction {
        &self.transaction
    }
    pub fn network(&self) -> Network {
        self.transaction.network()
    }
    pub fn account(&self) -> u32 {
        self.transaction.account()
    }
    pub fn recipient(&self) -> &Output {
        self.transaction.recipient()
    }
    pub fn change(&self) -> Option<&Output> {
        self.transaction.change()
    }
    pub fn recipient_address(&self) -> &Address {
        &self.recipient_address
    }
    pub fn change_address(&self) -> Option<&Address> {
        self.change_address.as_ref()
    }
    pub fn fee(&self) -> u64 {
        self.transaction.fee()
    }
    pub fn inputs(&self) -> &[Input] {
        self.transaction.inputs()
    }
    pub fn outputs(&self) -> &[Output] {
        self.transaction.outputs()
    }
    pub fn input_path(&self, index: usize) -> Result<DerivationPath, Error> {
        self.transaction.input_path(index)
    }
}

/// Created only inside the session after the native review callback approves.
/// No public constructor or mutator can fabricate or change this approval token.
///
/// ```compile_fail
/// use pearl_core::{ReviewedTransaction, ValidatedTransaction};
/// fn forge(transaction: ValidatedTransaction) -> ReviewedTransaction {
///     ReviewedTransaction { transaction }
/// }
/// ```
#[derive(Debug)]
pub struct ReviewedTransaction {
    transaction: ValidatedTransaction,
}
impl ReviewedTransaction {
    pub(crate) fn approved(transaction: ValidatedTransaction) -> Self {
        Self { transaction }
    }
    pub fn transaction(&self) -> &ValidatedTransaction {
        &self.transaction
    }
    pub fn input_path(&self, index: usize) -> Result<DerivationPath, Error> {
        self.transaction.input_path(index)
    }
    pub fn sighash(&self, index: usize) -> Result<[u8; 32], Error> {
        self.transaction.transaction.sighash(index)
    }
}

/// Parse only the pinned canonical wire format. No allocation, optional fields,
/// padding, varint alternatives, unbounded loops or externally controlled sizes.
pub fn parse_bundle(bytes: &[u8], configured_network: Network) -> Result<Transaction, Error> {
    if !(MIN_BUNDLE_SIZE..=MAX_BUNDLE_SIZE).contains(&bytes.len()) {
        return Err(Error::WrongLength);
    }
    let mut c = Cursor { bytes, at: 0 };
    if c.read::<4>()? != *b"PRL1" {
        return Err(Error::InvalidData);
    }
    let network = Network::from_byte(c.byte()?)?;
    if network != configured_network {
        return Err(Error::InvalidNetwork);
    }
    let account = c.u32()?;
    DerivationPath::new(network, account, 0, 0)?;
    let version = i32::from_le_bytes(c.read()?);
    let locktime = c.u32()?;
    if version != 1 || locktime != 0 {
        return Err(Error::InvalidData);
    }
    let input_count = c.byte()?;
    let output_count = c.byte()?;
    if input_count == 0
        || usize::from(input_count) > MAX_INPUTS
        || output_count == 0
        || usize::from(output_count) > MAX_OUTPUTS
    {
        return Err(Error::InvalidData);
    }
    let expected = 19 + 87 * usize::from(input_count) + 48 * usize::from(output_count);
    if bytes.len() != expected {
        return Err(Error::WrongLength);
    }
    let mut inputs = [Input::EMPTY; MAX_INPUTS];
    let mut input_total = Amount::new(0)?;
    for i in 0..usize::from(input_count) {
        let input = Input {
            txid: c.read()?,
            vout: c.u32()?,
            amount: c.u64()?,
            script: c.read()?,
            sequence: c.u32()?,
            branch: c.byte()?,
            index: c.u32()?,
        };
        input_total = input_total.checked_add(Amount::positive(input.amount)?)?;
        validate_script(&input.script)?;
        if input.sequence != u32::MAX {
            return Err(Error::InvalidData);
        }
        DerivationPath::new(network, account, input.branch, input.index)?;
        for previous in &inputs[..i] {
            if previous.txid == input.txid && previous.vout == input.vout {
                return Err(Error::DuplicateOutpoint);
            }
        }
        inputs[i] = input;
    }
    let mut outputs = [Output::EMPTY; MAX_OUTPUTS];
    let mut output_total = Amount::new(0)?;
    let mut recipient_index = None;
    let mut change_index = None;
    for (i, slot) in outputs
        .iter_mut()
        .enumerate()
        .take(usize::from(output_count))
    {
        let amount = c.u64()?;
        let script = c.read()?;
        let role = match c.byte()? {
            0 => OutputRole::Recipient,
            1 => OutputRole::Change,
            _ => return Err(Error::InvalidData),
        };
        let branch = c.byte()?;
        let index = c.u32()?;
        output_total = output_total.checked_add(Amount::positive(amount)?)?;
        validate_script(&script)?;
        match role {
            OutputRole::Recipient => {
                if recipient_index.is_some() || branch != 0 || index != 0 {
                    return Err(Error::InvalidData);
                }
                recipient_index = Some(i);
            }
            OutputRole::Change => {
                if change_index.is_some() || branch != 1 {
                    return Err(Error::InvalidData);
                }
                DerivationPath::new(network, account, branch, index)?;
                change_index = Some(i);
            }
        }
        *slot = Output {
            amount,
            script,
            role,
            branch,
            index,
        };
    }
    let recipient_index = recipient_index.ok_or(Error::InvalidData)?;
    input_total.checked_sub(output_total)?;
    if c.at != bytes.len() {
        return Err(Error::WrongLength);
    }
    Ok(Transaction {
        network,
        account,
        version,
        locktime,
        inputs,
        input_count,
        outputs,
        output_count,
        recipient_index,
        change_index,
        input_total: input_total.grains(),
        output_total: output_total.grains(),
    })
}

fn validate_script(script: &[u8; 34]) -> Result<(), Error> {
    if script[..2] != [0x51, 0x20] {
        Err(Error::InvalidData)
    } else {
        Ok(())
    }
}
struct Cursor<'a> {
    bytes: &'a [u8],
    at: usize,
}
impl Cursor<'_> {
    fn read<const N: usize>(&mut self) -> Result<[u8; N], Error> {
        let end = self.at.checked_add(N).ok_or(Error::WrongLength)?;
        let source = self.bytes.get(self.at..end).ok_or(Error::WrongLength)?;
        let mut out = [0; N];
        out.copy_from_slice(source);
        self.at = end;
        Ok(out)
    }
    fn byte(&mut self) -> Result<u8, Error> {
        Ok(self.read::<1>()?[0])
    }
    fn u32(&mut self) -> Result<u32, Error> {
        Ok(u32::from_le_bytes(self.read()?))
    }
    fn u64(&mut self) -> Result<u64, Error> {
        Ok(u64::from_le_bytes(self.read()?))
    }
}
