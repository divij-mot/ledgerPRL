//! Independent, deterministic APDU state-model review. No secrets or real signing.
//! The imported production crate is immutable; this executable is an external consumer.
use pearl_core::{
    bundle_hash, AccountPath, AccountPublic, Address, DerivationPath, Device, Error, Network,
    PublicKeyProvider, ReviewedTransaction, Session, SessionState, Transaction,
    ValidatedTransaction, HARDENED, MAX_BUNDLE_SIZE, MAX_GRAINS, MIN_BUNDLE_SIZE,
};
use std::collections::BTreeSet;

const OK: u16 = 0x9000;
// Literal protocol oracle: never derive expected failure statuses from production.
fn expected_status(error: Error) -> u16 {
    match error {
        Error::WrongLength => 0x6700,
        Error::UserRejected => 0x6985,
        Error::WrongState => 0x6986,
        Error::WrongParameters => 0x6b00,
        Error::UnsupportedInstruction => 0x6d00,
        Error::UnsupportedClass => 0x6e00,
        Error::Crypto => 0x6f00,
        Error::InvalidData
        | Error::InvalidNetwork
        | Error::InvalidPath
        | Error::InvalidAmount
        | Error::DuplicateOutpoint
        | Error::OwnershipMismatch
        | Error::HashMismatch => 0x6a80,
    }
}
fn assert_output(output: &pearl_core::Output, raw: &[u8; 48]) {
    assert_eq!(output.amount(), u64le(&raw[..8]));
    assert_eq!(output.script().as_slice(), &raw[8..42]);
    assert_eq!(output.output_key().as_slice(), &raw[10..42]);
    assert_eq!(output.role() as u8, raw[42]);
    assert_eq!(output.branch(), raw[43]);
    assert_eq!(output.index(), u32le(&raw[44..48]));
}
fn net(n: u8) -> Network {
    Network::from_byte(n).unwrap()
}
fn u16le(b: &[u8]) -> usize {
    usize::from(u16::from_le_bytes(b.try_into().unwrap()))
}
fn u32le(b: &[u8]) -> u32 {
    u32::from_le_bytes(b.try_into().unwrap())
}
fn u64le(b: &[u8]) -> u64 {
    u64::from_le_bytes(b.try_into().unwrap())
}
fn apdu(ins: u8, data: &[u8]) -> Vec<u8> {
    assert!(data.len() <= 255);
    let mut b = vec![0xe0, ins, 0, 0, data.len() as u8];
    b.extend_from_slice(data);
    b
}
fn begin(b: &[u8]) -> Vec<u8> {
    let mut d = (b.len() as u16).to_le_bytes().to_vec();
    d.extend_from_slice(&bundle_hash(b));
    apdu(0x10, &d)
}
fn append(offset: usize, b: &[u8]) -> Vec<u8> {
    let mut d = (offset as u16).to_le_bytes().to_vec();
    d.extend_from_slice(b);
    apdu(0x11, &d)
}
fn key(network: u8, account: u32, branch: u8, index: u32) -> [u8; 32] {
    let mut pre = b"PUBLIC MOCK OUTPUT KEY, NOT SECP256K1".to_vec();
    pre.push(network);
    pre.extend_from_slice(&account.to_le_bytes());
    pre.push(branch);
    pre.extend_from_slice(&index.to_le_bytes());
    bundle_hash(&pre)
}
fn account_public() -> AccountPublic {
    AccountPublic {
        master_fingerprint: [11; 4],
        compressed_public_key: [2; 33],
        chain_code: [22; 32],
    }
}
fn signature(bundle: &[u8], epoch: u64, index: usize) -> [u8; 64] {
    let mut pre = b"PUBLIC MOCK SIGNATURE, NOT BIP340".to_vec();
    pre.extend_from_slice(bundle);
    pre.extend_from_slice(&epoch.to_le_bytes());
    pre.extend_from_slice(&(index as u64).to_le_bytes());
    let digest = bundle_hash(&pre);
    let mut out = [0; 64];
    out[..32].copy_from_slice(&digest);
    pre.push(1);
    out[32..].copy_from_slice(&bundle_hash(&pre));
    out
}
fn encode_transaction(t: &Transaction) -> Vec<u8> {
    let mut b = b"PRL1".to_vec();
    b.push(t.network() as u8);
    b.extend_from_slice(&t.account().to_le_bytes());
    b.extend_from_slice(&t.version().to_le_bytes());
    b.extend_from_slice(&t.locktime().to_le_bytes());
    b.push(t.inputs().len() as u8);
    b.push(t.outputs().len() as u8);
    for i in t.inputs() {
        b.extend_from_slice(i.txid());
        b.extend_from_slice(&i.vout().to_le_bytes());
        b.extend_from_slice(&i.amount().to_le_bytes());
        b.extend_from_slice(i.script());
        b.extend_from_slice(&i.sequence().to_le_bytes());
        b.push(i.branch());
        b.extend_from_slice(&i.index().to_le_bytes());
    }
    for o in t.outputs() {
        b.extend_from_slice(&o.amount().to_le_bytes());
        b.extend_from_slice(o.script());
        b.push(o.role() as u8);
        b.push(o.branch());
        b.extend_from_slice(&o.index().to_le_bytes());
    }
    b
}

#[derive(Clone, Debug, PartialEq, Eq)]
enum Event {
    Account([u32; 3]),
    ConfirmAccount(u8, [u32; 3], AccountPublic),
    Derive([u32; 5]),
    Validate([u8; 32]),
    ConfirmAddress(u8, [u32; 5], String),
    Review(Vec<u8>),
    Sign(usize, Vec<u8>),
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Fault {
    None,
    Validate(Error),
    DeriveAt(usize, Error),
    Review(Error),
    SignAt(usize, Error),
    Account(Error),
    ConfirmAccount(Error),
    ConfirmAddress(Error),
    BadAccountKey,
}
#[derive(Debug)]
struct MockDevice {
    fault: Fault,
    events: Vec<Event>,
    derivations: usize,
    epoch: u64,
    approval: Option<Vec<u8>>,
    approved_this_command: bool,
}
impl MockDevice {
    fn new() -> Self {
        Self {
            fault: Fault::None,
            events: vec![],
            derivations: 0,
            epoch: 0,
            approval: None,
            approved_this_command: false,
        }
    }
    fn start(&mut self, f: Fault) {
        self.fault = f;
        self.events.clear();
        self.derivations = 0;
        self.approved_this_command = false;
    }
}
impl PublicKeyProvider for MockDevice {
    fn validate_output_key(&mut self, output_key: &[u8; 32]) -> Result<(), Error> {
        self.events.push(Event::Validate(*output_key));
        if let Fault::Validate(e) = self.fault {
            return Err(e);
        }
        // A deterministic sentinel lets us exercise point-validation failure without claiming real curve validation.
        if output_key.iter().all(|x| *x == 0) {
            return Err(Error::Crypto);
        }
        Ok(())
    }
    fn derive_output_key(&mut self, p: &DerivationPath) -> Result<[u8; 32], Error> {
        self.events.push(Event::Derive(p.components()));
        let at = self.derivations;
        self.derivations += 1;
        assert!(p.account() < HARDENED && p.branch() < 2 && p.index() < HARDENED);
        assert_eq!(
            p.components(),
            [
                86 | HARDENED,
                p.network().coin_type() | HARDENED,
                p.account() | HARDENED,
                p.branch() as u32,
                p.index()
            ]
        );
        if let Fault::DeriveAt(i, e) = self.fault {
            if i == at {
                return Err(e);
            }
        }
        Ok(key(p.network() as u8, p.account(), p.branch(), p.index()))
    }
}
impl Device for MockDevice {
    fn account_public(&mut self, p: &AccountPath) -> Result<AccountPublic, Error> {
        self.events.push(Event::Account(p.components()));
        if let Fault::Account(e) = self.fault {
            return Err(e);
        }
        let mut a = account_public();
        if self.fault == Fault::BadAccountKey {
            a.compressed_public_key[0] = 4;
        }
        Ok(a)
    }
    fn confirm_account(&mut self, path: &AccountPath, public: &AccountPublic) -> Result<(), Error> {
        self.events.push(Event::ConfirmAccount(
            path.network() as u8,
            path.components(),
            public.clone(),
        ));
        if let Fault::ConfirmAccount(e) = self.fault {
            return Err(e);
        }
        Ok(())
    }
    fn confirm_address(&mut self, path: &DerivationPath, a: &Address) -> Result<(), Error> {
        self.events.push(Event::ConfirmAddress(
            path.network() as u8,
            path.components(),
            a.as_str().to_owned(),
        ));
        if let Fault::ConfirmAddress(e) = self.fault {
            return Err(e);
        }
        Ok(())
    }
    fn review_transaction(&mut self, t: &ValidatedTransaction) -> Result<(), Error> {
        let bytes = encode_transaction(t.transaction());
        self.events.push(Event::Review(bytes.clone()));
        let decoded = reference_parse(&bytes, t.network() as u8)
            .expect("production presented non-canonical review");
        assert_eq!(t.fee() as u128, decoded.total_in - decoded.total_out);
        assert_eq!(t.transaction().input_total() as u128, decoded.total_in);
        assert_eq!(t.transaction().output_total() as u128, decoded.total_out);
        assert_eq!(t.inputs().len(), decoded.inputs.len());
        assert_eq!(t.outputs().len(), decoded.output_count);
        assert_eq!(t.account(), decoded.account);
        assert_eq!(t.inputs(), t.transaction().inputs());
        for (output, raw) in t.outputs().iter().zip(&decoded.output_records) {
            assert_output(output, raw);
        }
        assert_output(t.recipient(), &decoded.output_records[decoded.recipient_at]);
        assert_eq!(t.change_address().is_some(), decoded.change_at.is_some());
        match decoded.change_at {
            Some(at) => assert_output(
                t.change().expect("missing reviewed change"),
                &decoded.output_records[at],
            ),
            None => assert!(t.change().is_none()),
        }
        assert_eq!(
            t.recipient_address().as_str(),
            Address::from_output_key(t.network(), &decoded.recipient)
                .unwrap()
                .as_str()
        );
        assert_eq!(t.change().is_some(), decoded.change.is_some());
        if let Some((branch, index, k)) = decoded.change {
            assert_eq!(branch, 1);
            assert_eq!(k, key(t.network() as u8, t.account(), branch, index));
            assert_eq!(
                t.change_address().unwrap().as_str(),
                Address::from_output_key(t.network(), &k).unwrap().as_str()
            );
        }
        for (i, record) in decoded.inputs.iter().enumerate() {
            assert_eq!(
                t.input_path(i).unwrap().components(),
                path_components(t.network() as u8, t.account(), record.0, record.1)
            );
        }
        assert!(t.input_path(decoded.inputs.len()).is_err());
        if let Fault::Review(e) = self.fault {
            return Err(e);
        }
        self.epoch += 1;
        self.approval = Some(bytes);
        self.approved_this_command = true;
        Ok(())
    }
    fn sign_input(&mut self, t: &ReviewedTransaction, i: usize) -> Result<[u8; 64], Error> {
        let b = encode_transaction(t.transaction().transaction());
        self.events.push(Event::Sign(i, b.clone()));
        assert!(
            self.approved_this_command,
            "signature callback without this command's successful review"
        );
        assert_eq!(
            self.approval.as_deref(),
            Some(b.as_slice()),
            "reviewed transaction mutated before signing"
        );
        assert!(i < t.transaction().inputs().len());
        assert_eq!(
            t.input_path(i).unwrap(),
            t.transaction().input_path(i).unwrap()
        );
        assert_eq!(
            t.sighash(i).unwrap(),
            t.transaction().transaction().sighash(i).unwrap()
        );
        assert!(t.sighash(t.transaction().inputs().len()).is_err());
        if let Fault::SignAt(at, e) = self.fault {
            if at == i {
                return Err(e);
            }
        }
        Ok(signature(&b, self.epoch, i))
    }
}

// This oracle uses wide sums, offset-based records, and a set of outpoints; it does not call production parsing.
#[derive(Debug)]
struct Decoded {
    account: u32,
    inputs: Vec<(u8, u32, [u8; 32])>,
    recipient: [u8; 32],
    change: Option<(u8, u32, [u8; 32])>,
    total_in: u128,
    total_out: u128,
    output_count: usize,
    output_records: Vec<[u8; 48]>,
    recipient_at: usize,
    change_at: Option<usize>,
}
fn reference_parse(b: &[u8], network: u8) -> Result<Decoded, u16> {
    if !(154..=1507).contains(&b.len()) {
        return Err(0x6700);
    }
    if &b[..4] != b"PRL1" || b[4] != network || b[4] > 4 {
        return Err(0x6a80);
    }
    let account = u32le(&b[5..9]);
    if account >= 0x8000_0000 || b[9..13] != [1, 0, 0, 0] || b[13..17] != [0; 4] {
        return Err(0x6a80);
    }
    let ni = b[17] as usize;
    let no = b[18] as usize;
    if !(1..=16).contains(&ni) || !(1..=2).contains(&no) {
        return Err(0x6a80);
    }
    if b.len() != 19 + 87 * ni + 48 * no {
        return Err(0x6700);
    }
    let mut inputs = vec![];
    let mut outpoints = BTreeSet::new();
    let mut ti = 0u128;
    let mut to = 0u128;
    for raw in b[19..19 + 87 * ni].as_chunks::<87>().0 {
        let amt = u64le(&raw[36..44]);
        ti += amt as u128;
        if amt == 0
            || ti > 2_100_000_000_000_000_000u128
            || raw[44..46] != [0x51, 0x20]
            || raw[78..82] != [255; 4]
            || raw[82] > 1
            || u32le(&raw[83..87]) >= 0x8000_0000
            || !outpoints.insert(raw[..36].to_vec())
        {
            return Err(0x6a80);
        }
        inputs.push((
            raw[82],
            u32le(&raw[83..87]),
            raw[46..78].try_into().unwrap(),
        ));
    }
    let mut recipient = None;
    let mut change = None;
    let mut recipient_at = None;
    let mut change_at = None;
    let mut output_records = vec![];
    for (position, raw) in b[19 + 87 * ni..].as_chunks::<48>().0.iter().enumerate() {
        output_records.push(*raw);
        let amt = u64le(&raw[..8]);
        to += amt as u128;
        if amt == 0 || to > 2_100_000_000_000_000_000u128 || raw[8..10] != [0x51, 0x20] {
            return Err(0x6a80);
        }
        let k: [u8; 32] = raw[10..42].try_into().unwrap();
        let branch = raw[43];
        let index = u32le(&raw[44..48]);
        match raw[42] {
            0 if recipient.is_none() && branch == 0 && index == 0 => {
                recipient = Some(k);
                recipient_at = Some(position);
            }
            1 if change.is_none() && branch == 1 && index < 0x8000_0000 => {
                change = Some((branch, index, k));
                change_at = Some(position);
            }
            _ => return Err(0x6a80),
        }
    }
    if ti < to || recipient.is_none() {
        return Err(0x6a80);
    }
    Ok(Decoded {
        account,
        inputs,
        recipient: recipient.unwrap(),
        change,
        total_in: ti,
        total_out: to,
        output_count: no,
        output_records,
        recipient_at: recipient_at.unwrap(),
        change_at,
    })
}
fn path_components(network: u8, account: u32, branch: u8, index: u32) -> [u32; 5] {
    [
        0x8000_0056,
        if network == 0 {
            808276 | HARDENED
        } else {
            1 | HARDENED
        },
        account | HARDENED,
        branch as u32,
        index,
    ]
}
#[derive(Clone, Debug)]
enum ModelState {
    Idle,
    Receiving {
        size: usize,
        hash: [u8; 32],
        bytes: Vec<u8>,
    },
    Signatures {
        sigs: Vec<[u8; 64]>,
        next: usize,
    },
}
#[derive(Debug)]
struct Model {
    network: u8,
    state: ModelState,
    epoch: u64,
    events: Vec<Event>,
}
impl Model {
    fn new(network: u8) -> Self {
        Self {
            network,
            state: ModelState::Idle,
            epoch: 0,
            events: vec![],
        }
    }
    fn state(&self) -> SessionState {
        match self.state {
            ModelState::Idle => SessionState::Idle,
            ModelState::Receiving { .. } => SessionState::Receiving,
            ModelState::Signatures { .. } => SessionState::Signatures,
        }
    }
    fn handle(&mut self, b: &[u8], f: Fault) -> (u16, Vec<u8>) {
        self.events.clear();
        match self.inner(b, f) {
            Ok(data) => (OK, data),
            Err(sw) => {
                self.state = ModelState::Idle;
                (sw, vec![])
            }
        }
    }
    fn inner(&mut self, b: &[u8], f: Fault) -> Result<Vec<u8>, u16> {
        if b.len() < 5 || b.len() != 5 + b[4] as usize {
            return Err(0x6700);
        }
        if b[0] != 0xe0 {
            return Err(0x6e00);
        }
        if b[2] != 0 || b[3] != 0 {
            return Err(0x6b00);
        }
        let d = &b[5..];
        match b[1] {
            0x00 => {
                if !d.is_empty() {
                    return Err(0x6700);
                }
                if self.state() != SessionState::Idle {
                    return Err(0x6986);
                }
                Ok(vec![1, 0, 1, 0, self.network, 16, 0xe3, 5])
            }
            0x01 => {
                if self.state() != SessionState::Idle {
                    return Err(0x6986);
                }
                if d.len() != 4 {
                    return Err(0x6700);
                }
                let a = u32le(d);
                if a >= HARDENED {
                    return Err(0x6a80);
                }
                let p = path_components(self.network, a, 0, 0);
                self.events.push(Event::Account(p[..3].try_into().unwrap()));
                if let Fault::Account(e) = f {
                    return Err(expected_status(e));
                }
                if f == Fault::BadAccountKey {
                    return Err(0x6f00);
                }
                self.events.push(Event::ConfirmAccount(
                    self.network,
                    p[..3].try_into().unwrap(),
                    account_public(),
                ));
                if let Fault::ConfirmAccount(e) = f {
                    return Err(expected_status(e));
                }
                let a_pub = account_public();
                let mut out = a_pub.master_fingerprint.to_vec();
                out.extend_from_slice(&a_pub.compressed_public_key);
                out.extend_from_slice(&a_pub.chain_code);
                out.push(self.network);
                out.extend_from_slice(&a.to_le_bytes());
                Ok(out)
            }
            0x02 => {
                if self.state() != SessionState::Idle {
                    return Err(0x6986);
                }
                if d.len() != 9 {
                    return Err(0x6700);
                }
                let a = u32le(&d[..4]);
                let br = d[4];
                let idx = u32le(&d[5..]);
                if a >= HARDENED || br > 1 || idx >= HARDENED {
                    return Err(0x6a80);
                }
                self.events
                    .push(Event::Derive(path_components(self.network, a, br, idx)));
                if let Fault::DeriveAt(0, e) = f {
                    return Err(expected_status(e));
                }
                let addr =
                    Address::from_output_key(net(self.network), &key(self.network, a, br, idx))
                        .unwrap()
                        .as_str()
                        .to_owned();
                self.events.push(Event::ConfirmAddress(
                    self.network,
                    path_components(self.network, a, br, idx),
                    addr.clone(),
                ));
                if let Fault::ConfirmAddress(e) = f {
                    return Err(expected_status(e));
                }
                Ok(addr.into_bytes())
            }
            0x10 => {
                if self.state() != SessionState::Idle {
                    return Err(0x6986);
                }
                if d.len() != 34 {
                    return Err(0x6700);
                }
                let size = u16le(&d[..2]);
                if !(154..=1507).contains(&size) {
                    return Err(0x6700);
                }
                self.state = ModelState::Receiving {
                    size,
                    hash: d[2..].try_into().unwrap(),
                    bytes: vec![],
                };
                Ok(vec![])
            }
            0x11 => {
                let ModelState::Receiving { size, bytes, .. } = &mut self.state else {
                    return Err(0x6986);
                };
                if d.len() < 3 {
                    return Err(0x6700);
                }
                if u16le(&d[..2]) != bytes.len() {
                    return Err(0x6a80);
                }
                if bytes.len() + d.len() - 2 > *size {
                    return Err(0x6700);
                }
                bytes.extend_from_slice(&d[2..]);
                Ok(vec![])
            }
            0x12 => {
                if !d.is_empty() {
                    return Err(0x6700);
                }
                let ModelState::Receiving { size, hash, bytes } = &self.state else {
                    return Err(0x6986);
                };
                if bytes.len() != *size {
                    return Err(0x6986);
                }
                if bundle_hash(bytes) != *hash {
                    return Err(0x6a80);
                }
                let bytes = bytes.clone();
                let hash = *hash;
                let t = reference_parse(&bytes, self.network)?;
                self.events.push(Event::Validate(t.recipient));
                if let Fault::Validate(e) = f {
                    return Err(expected_status(e));
                }
                if t.recipient == [0; 32] {
                    return Err(0x6f00);
                }
                for (i, (br, idx, k)) in t.inputs.iter().chain(t.change.iter()).enumerate() {
                    self.events.push(Event::Derive(path_components(
                        self.network,
                        t.account,
                        *br,
                        *idx,
                    )));
                    if let Fault::DeriveAt(at, e) = f {
                        if at == i {
                            return Err(expected_status(e));
                        }
                    }
                    if *k != key(self.network, t.account, *br, *idx) {
                        return Err(0x6a80);
                    }
                }
                self.events.push(Event::Review(bytes.clone()));
                if let Fault::Review(e) = f {
                    return Err(expected_status(e));
                }
                self.epoch += 1;
                let mut sigs = vec![];
                for i in 0..t.inputs.len() {
                    self.events.push(Event::Sign(i, bytes.clone()));
                    if let Fault::SignAt(at, e) = f {
                        if at == i {
                            return Err(expected_status(e));
                        }
                    }
                    sigs.push(signature(&bytes, self.epoch, i));
                }
                let mut out = vec![t.inputs.len() as u8];
                out.extend_from_slice(&hash);
                self.state = ModelState::Signatures { sigs, next: 0 };
                Ok(out)
            }
            0x13 => {
                let ModelState::Signatures { sigs, next } = &mut self.state else {
                    return Err(0x6986);
                };
                if d.len() != 1 {
                    return Err(0x6700);
                }
                if d[0] as usize != *next {
                    return Err(0x6a80);
                }
                let out = sigs[*next].to_vec();
                *next += 1;
                if *next == sigs.len() {
                    self.state = ModelState::Idle;
                }
                Ok(out)
            }
            0x14 => {
                if !d.is_empty() {
                    return Err(0x6700);
                }
                self.state = ModelState::Idle;
                Ok(vec![])
            }
            _ => Err(0x6d00),
        }
    }
}

#[derive(Default, Debug)]
struct Counts {
    commands: u64,
    reviews: u64,
    approvals: u64,
    signing_callbacks: u64,
    signatures_released: u64,
    failures: u64,
    resets: u64,
    episodes: u64,
}
struct Harness {
    session: Session,
    device: MockDevice,
    model: Model,
    counts: Counts,
    trace: Vec<String>,
    label: String,
}
impl Harness {
    fn new(network: u8, label: String) -> Self {
        Self {
            session: Session::new(net(network)),
            device: MockDevice::new(),
            model: Model::new(network),
            counts: Counts::default(),
            trace: vec![],
            label,
        }
    }
    fn step(&mut self, b: &[u8], f: Fault) {
        self.counts.commands += 1;
        self.trace.push(format!("{:02x?} fault={f:?}", b));
        while self.trace.len() > 100 {
            self.trace.remove(0);
        }
        self.device.start(f);
        let before = self.session.state();
        let epoch = self.device.epoch;
        let expected = self.model.handle(b, f);
        let got = self.session.handle_apdu(b, &mut self.device);
        let context = || {
            format!(
                "{} command={} prior={before:?}\n{}",
                self.label,
                self.counts.commands,
                self.trace.join("\n")
            )
        };
        assert_eq!(
            (got.status(), got.data()),
            (expected.0, expected.1.as_slice()),
            "response mismatch: {}",
            context()
        );
        assert_eq!(
            self.session.state(),
            self.model.state(),
            "state mismatch: {}",
            context()
        );
        assert_eq!(
            self.device.events,
            self.model.events,
            "callback mismatch: {}",
            context()
        );
        assert_eq!(
            self.device.epoch,
            self.model.epoch,
            "approval epoch mismatch: {}",
            context()
        );
        assert_eq!(
            self.session.is_idle(),
            self.model.state() == SessionState::Idle
        );
        if got.status() != OK {
            assert!(self.session.is_idle());
            assert!(got.data().is_empty());
            self.counts.failures += 1;
        }
        self.counts.approvals += self.device.epoch - epoch;
        self.counts.reviews += self
            .device
            .events
            .iter()
            .filter(|e| matches!(e, Event::Review(_)))
            .count() as u64;
        self.counts.signing_callbacks += self
            .device
            .events
            .iter()
            .filter(|e| matches!(e, Event::Sign(_, _)))
            .count() as u64;
        if b.len() >= 2 && b[1] == 0x13 && got.status() == OK {
            self.counts.signatures_released += 1;
        }
    }
    fn reset(&mut self, kind: usize) {
        self.counts.resets += 1;
        match kind % 4 {
            0 => self.session.reset(),
            1 => self.session.on_disconnect(),
            2 => self.session.on_timeout(),
            _ => self.session.on_app_exit(),
        };
        self.model.state = ModelState::Idle;
        assert!(self.session.is_idle());
        self.trace.push(format!("RESET({kind})"));
        while self.trace.len() > 100 {
            self.trace.remove(0);
        }
    }
    fn upload(&mut self, b: &[u8], rng: &mut Rng) {
        self.step(&begin(b), Fault::None);
        let mut pos = 0;
        while pos < b.len() {
            let n = match rng.pick(5) {
                0 => 1,
                1 => 253,
                2 => 2,
                3 => 252,
                _ => 1 + rng.pick(253),
            }
            .min(b.len() - pos);
            self.step(&append(pos, &b[pos..pos + n]), Fault::None);
            pos += n;
        }
    }
    fn commit(&mut self, f: Fault) {
        self.step(&apdu(0x12, &[]), f);
    }
    fn drain(&mut self) {
        while let ModelState::Signatures { next, .. } = self.model.state {
            self.step(&apdu(0x13, &[next as u8]), Fault::None);
        }
    }
}
#[derive(Clone)]
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
        z ^ (z >> 31)
    }
    fn pick(&mut self, n: usize) -> usize {
        (self.next() % (n as u64)) as usize
    }
    fn path_index(&mut self) -> u32 {
        match self.pick(6) {
            0 => 0,
            1 => 0x7fff_ffff,
            2 => 1,
            _ => (self.next() as u32) & 0x7fff_ffff,
        }
    }
}
fn bundle(rng: &mut Rng, network: u8, ni: usize, change: bool) -> Vec<u8> {
    let account = rng.path_index();
    let no = if change { 2 } else { 1 };
    let mut b = b"PRL1".to_vec();
    b.push(network);
    b.extend_from_slice(&account.to_le_bytes());
    b.extend_from_slice(&1u32.to_le_bytes());
    b.extend_from_slice(&0u32.to_le_bytes());
    b.extend_from_slice(&[ni as u8, no]);
    let total = match rng.pick(6) {
        0 => MAX_GRAINS,
        1 => ni.max(no as usize) as u64,
        2 => 100_000_000,
        3 => MAX_GRAINS - 1,
        _ => (rng.next() % 1_000_000_000_000) + 100,
    };
    for i in 0..ni {
        let txid = bundle_hash(&rng.next().to_le_bytes());
        b.extend_from_slice(&txid);
        b.extend_from_slice(&(i as u32).to_le_bytes());
        let amt = total / (ni as u64) + u64::from((i as u64) < total % (ni as u64));
        b.extend_from_slice(&amt.to_le_bytes());
        let br = rng.pick(2) as u8;
        let idx = rng.path_index();
        b.extend_from_slice(&[0x51, 0x20]);
        b.extend_from_slice(&key(network, account, br, idx));
        b.extend_from_slice(&[255; 4]);
        b.push(br);
        b.extend_from_slice(&idx.to_le_bytes());
    }
    let available = match rng.pick(4) {
        0 => total,
        1 => no as u64,
        _ => no as u64 + rng.next() % (total - no as u64 + 1),
    };
    let recipient = if change {
        1 + rng.next() % (available - 1)
    } else {
        available
    };
    let mut outs = vec![];
    let mut o = recipient.to_le_bytes().to_vec();
    o.extend_from_slice(&[0x51, 0x20]);
    o.extend_from_slice(&bundle_hash(&rng.next().to_le_bytes()));
    o.extend_from_slice(&[0; 6]);
    outs.push(o);
    if change {
        let idx = rng.path_index();
        let mut o = (available - recipient).to_le_bytes().to_vec();
        o.extend_from_slice(&[0x51, 0x20]);
        o.extend_from_slice(&key(network, account, 1, idx));
        o.extend_from_slice(&[1, 1]);
        o.extend_from_slice(&idx.to_le_bytes());
        outs.push(o);
        if rng.pick(2) == 0 {
            outs.swap(0, 1);
        }
    }
    for o in outs {
        b.extend_from_slice(&o);
    }
    assert!(reference_parse(&b, network).is_ok());
    b
}
fn fault(rng: &mut Rng) -> Fault {
    let e = match rng.pick(4) {
        0 => Error::UserRejected,
        1 => Error::Crypto,
        2 => Error::WrongState,
        _ => Error::InvalidData,
    };
    match rng.pick(14) {
        0 => Fault::Validate(e),
        1 => Fault::DeriveAt(rng.pick(17), e),
        2 => Fault::Review(e),
        3 => Fault::SignAt(rng.pick(16), e),
        4 => Fault::Account(e),
        5 => Fault::ConfirmAccount(e),
        6 => Fault::ConfirmAddress(e),
        7 => Fault::BadAccountKey,
        _ => Fault::None,
    }
}
fn invalidation_probe(h: &mut Harness) {
    for i in [0, 1, 15, 255] {
        h.step(&apdu(0x13, &[i]), Fault::None);
    }
    h.commit(Fault::None);
}
fn add(total: &mut Counts, c: &Counts) {
    total.commands += c.commands;
    total.reviews += c.reviews;
    total.approvals += c.approvals;
    total.signing_callbacks += c.signing_callbacks;
    total.signatures_released += c.signatures_released;
    total.failures += c.failures;
    total.resets += c.resets;
    total.episodes += c.episodes;
}

fn suite_callbacks(seed: u64) -> Counts {
    let mut total = Counts::default();
    let mut rng = Rng(seed);
    let errors = [
        Error::WrongLength,
        Error::UserRejected,
        Error::WrongState,
        Error::InvalidData,
        Error::InvalidNetwork,
        Error::InvalidPath,
        Error::InvalidAmount,
        Error::DuplicateOutpoint,
        Error::OwnershipMismatch,
        Error::HashMismatch,
        Error::WrongParameters,
        Error::UnsupportedInstruction,
        Error::UnsupportedClass,
        Error::Crypto,
    ];
    for network in 0..5 {
        let mut h = Harness::new(
            network,
            format!("callbacks seed={seed:#x} network={network}"),
        );
        for ni in [1, 2, 16] {
            for change in [false, true] {
                let b = bundle(&mut rng, network, ni, change);
                for error in errors {
                    let mut failures = vec![Fault::Validate(error), Fault::Review(error)];
                    for i in 0..ni + usize::from(change) {
                        failures.push(Fault::DeriveAt(i, error));
                    }
                    for i in 0..ni {
                        failures.push(Fault::SignAt(i, error));
                    }
                    for f in failures {
                        h.counts.episodes += 1;
                        h.upload(&b, &mut rng);
                        h.commit(f);
                        assert!(h.session.is_idle());
                        invalidation_probe(&mut h);
                        // Even identical payload requires a new explicit successful review after failure.
                        h.upload(&b, &mut rng);
                        h.commit(Fault::None);
                        h.drain();
                        h.step(&apdu(0x13, &[0]), Fault::None);
                    }
                }
            }
        }
        add(&mut total, &h.counts);
    }
    total
}
fn suite_boundaries(seed: u64) -> Counts {
    let mut total = Counts::default();
    let mut rng = Rng(seed);
    for network in 0..5 {
        let mut h = Harness::new(
            network,
            format!("boundaries seed={seed:#x} network={network}"),
        );
        for a in [0u32, 1, HARDENED - 1, HARDENED, HARDENED + 1, u32::MAX] {
            for f in [
                Fault::None,
                Fault::Account(Error::Crypto),
                Fault::ConfirmAccount(Error::UserRejected),
                Fault::BadAccountKey,
            ] {
                h.step(&apdu(1, &a.to_le_bytes()), f);
            }
            for br in [0u8, 1, 2, 127, 255] {
                for idx in [0u32, 1, HARDENED - 1, HARDENED, HARDENED + 1, u32::MAX] {
                    let mut d = a.to_le_bytes().to_vec();
                    d.push(br);
                    d.extend_from_slice(&idx.to_le_bytes());
                    for f in [
                        Fault::None,
                        Fault::DeriveAt(0, Error::Crypto),
                        Fault::ConfirmAddress(Error::UserRejected),
                    ] {
                        h.step(&apdu(2, &d), f);
                    }
                }
            }
            let mut b = bundle(&mut rng, network, 1, false);
            b[5..9].copy_from_slice(&a.to_le_bytes());
            h.upload(&b, &mut rng);
            h.commit(Fault::None);
            h.drain();
        }
        for amount in [
            0u64,
            1,
            99_999_999,
            100_000_000,
            100_000_001,
            MAX_GRAINS - 1,
            MAX_GRAINS,
            MAX_GRAINS + 1,
            u64::MAX,
        ] {
            let a = pearl_core::Amount::new(amount);
            assert_eq!(a.is_ok(), amount <= MAX_GRAINS);
            if let Ok(a) = a {
                assert_eq!(a.grains(), amount);
                assert_eq!(
                    format!("{a}"),
                    format!("{}.{:08}", amount / 100_000_000, amount % 100_000_000)
                );
                for other in [0, 1, MAX_GRAINS] {
                    let o = pearl_core::Amount::new(other).unwrap();
                    assert_eq!(
                        a.checked_add(o).is_ok(),
                        amount as u128 + other as u128 <= MAX_GRAINS as u128
                    );
                    assert_eq!(a.checked_sub(o).is_ok(), amount >= other);
                }
            }
            for offset in [19 + 36, 19 + 87] {
                let mut b = bundle(&mut rng, network, 1, false);
                b[offset..offset + 8].copy_from_slice(&amount.to_le_bytes());
                h.upload(&b, &mut rng);
                h.commit(Fault::None);
                h.drain();
            }
        }
        for ni in [1, 2, 16] {
            for change in [false, true] {
                let b = bundle(&mut rng, network, ni, change);
                // Every possible split boundary, including exactly 1, 2, 252 and 253 byte APDU chunks.
                for split in 1..b.len() {
                    h.counts.episodes += 1;
                    h.step(&begin(&b), Fault::None);
                    let mut pos = 0;
                    while pos < split {
                        let end = (pos + 253).min(split);
                        h.step(&append(pos, &b[pos..end]), Fault::None);
                        pos = end;
                    }
                    while pos < b.len() {
                        let end = (pos + 253).min(b.len());
                        h.step(&append(pos, &b[pos..end]), Fault::None);
                        pos = end;
                    }
                    h.commit(Fault::None);
                    h.drain();
                }
                // External lifecycle invalidation in every signature position and reception state.
                for k in 0..4 {
                    for position in 0..ni {
                        h.upload(&b, &mut rng);
                        h.commit(Fault::None);
                        for i in 0..position {
                            h.step(&apdu(0x13, &[i as u8]), Fault::None);
                        }
                        h.reset(k);
                        invalidation_probe(&mut h);
                    }
                    for position in [0, 1, b.len() - 1, b.len()] {
                        h.step(&begin(&b), Fault::None);
                        let mut pos = 0;
                        while pos < position {
                            let end = (pos + 253).min(position);
                            h.step(&append(pos, &b[pos..end]), Fault::None);
                            pos = end;
                        }
                        h.reset(k);
                        invalidation_probe(&mut h);
                    }
                }
                // Out-of-order/replayed fetch at each release point invalidates all remaining signatures.
                for next in 0..ni {
                    for wrong in [next.wrapping_sub(1), next + 1, 16, 255] {
                        if wrong == next || wrong > 255 {
                            continue;
                        }
                        h.upload(&b, &mut rng);
                        h.commit(Fault::None);
                        for i in 0..next {
                            h.step(&apdu(0x13, &[i as u8]), Fault::None);
                        }
                        h.step(&apdu(0x13, &[wrong as u8]), Fault::None);
                        assert!(h.session.is_idle());
                        invalidation_probe(&mut h);
                    }
                }
            }
        }
        // Exhaustive declared u16 BEGIN length domain. Only bounded values can enter Receiving.
        for length in 0..=u16::MAX {
            let mut d = length.to_le_bytes().to_vec();
            d.extend_from_slice(&[0x33; 32]);
            h.step(&apdu(0x10, &d), Fault::None);
            h.step(&apdu(0x14, &[]), Fault::None);
        }
        add(&mut total, &h.counts);
    }
    total
}
fn suite_opcodes(seed: u64) -> Counts {
    let mut total = Counts::default();
    let mut rng = Rng(seed);
    for network in 0..5 {
        let mut h = Harness::new(network, format!("opcodes seed={seed:#x} network={network}"));
        let b = bundle(&mut rng, network, 2, true);
        for state in 0..6 {
            for ins in 0..=255 {
                for shape in 0..4 {
                    h.reset(0);
                    h.counts.episodes += 1;
                    match state {
                        1 => h.step(&begin(&b), Fault::None),
                        2 => {
                            h.step(&begin(&b), Fault::None);
                            h.step(&append(0, &b[..1]), Fault::None);
                        }
                        3 => h.upload(&b, &mut rng),
                        4 | 5 => {
                            h.upload(&b, &mut rng);
                            h.commit(Fault::None);
                            if state == 5 {
                                h.step(&apdu(0x13, &[0]), Fault::None);
                            }
                        }
                        _ => {}
                    }
                    let d = match shape {
                        0 => vec![],
                        1 => vec![0],
                        2 => match ins {
                            1 => vec![0; 4],
                            2 => vec![0; 9],
                            0x10 => begin(&b)[5..].to_vec(),
                            0x11 => vec![0, 0, b[0]],
                            _ => vec![255; 34],
                        },
                        _ => vec![0xa5; 255],
                    };
                    h.step(&apdu(ins, &d), Fault::None);
                    // A fault must leave no usable approval; drain valid surviving sessions only after checking state.
                    if matches!(h.model.state, ModelState::Signatures { .. }) {
                        h.drain();
                    } else if matches!(h.model.state, ModelState::Idle) {
                        invalidation_probe(&mut h);
                    }
                }
            }
        }
        add(&mut total, &h.counts);
    }
    total
}
fn suite_mutations(seed: u64) -> Counts {
    let mut total = Counts::default();
    let mut rng = Rng(seed);
    for network in 0..5 {
        let mut h = Harness::new(
            network,
            format!("mutations seed={seed:#x} network={network}"),
        );
        for (ni, change) in [(1, false), (2, true), (16, true)] {
            let b = bundle(&mut rng, network, ni, change);
            // Each serialized bit is changed with a recomputed commitment: this reaches parser/ownership, not merely hash rejection.
            for position in 0..b.len() {
                for bit in 0..8 {
                    h.counts.episodes += 1;
                    let mut m = b.clone();
                    m[position] ^= 1 << bit;
                    h.upload(&m, &mut rng);
                    h.commit(Fault::None);
                    h.drain();
                }
            }
            for cut in 0..b.len() {
                let m = &b[..cut];
                h.upload(m, &mut rng);
                h.commit(Fault::None);
                h.drain();
            }
            for extra in 1..=4 {
                let mut m = b.clone();
                m.extend(std::iter::repeat_n(0, extra));
                h.upload(&m, &mut rng);
                h.commit(Fault::None);
                h.drain();
            }
            // Two individually valid inputs overflowing the monetary cap together; duplicates and nonadjacent aliases.
            if ni > 1 {
                for amount in [MAX_GRAINS / 2, MAX_GRAINS, MAX_GRAINS + 1, u64::MAX] {
                    let mut m = b.clone();
                    for i in 0..ni {
                        m[19 + 87 * i + 36..19 + 87 * i + 44]
                            .copy_from_slice(&amount.to_le_bytes());
                    }
                    h.upload(&m, &mut rng);
                    h.commit(Fault::None);
                    h.drain();
                }
                let mut m = b.clone();
                let first = m[19..55].to_vec();
                m[19 + (ni - 1) * 87..55 + (ni - 1) * 87].copy_from_slice(&first);
                h.upload(&m, &mut rng);
                h.commit(Fault::None);
                h.drain();
            }
        }
        add(&mut total, &h.counts);
    }
    total
}
fn suite_walks(seed: u64, episodes: usize) -> Counts {
    let mut total = Counts::default();
    let mut rng = Rng(seed);
    for network in 0..5 {
        let mut h = Harness::new(network, format!("walks seed={seed:#x} network={network}"));
        let mut target = vec![];
        for episode in 0..episodes {
            h.counts.episodes += 1;
            h.label = format!("walks seed={seed:#x} network={network} episode={episode}");
            for _ in 0..32 + rng.pick(96) {
                let state = h.model.state.clone();
                let roll = rng.pick(100);
                if roll < 4 {
                    h.reset(rng.pick(4));
                    continue;
                }
                let mut command = match state {
                    ModelState::Idle if roll < 82 => {
                        let ni = 1 + rng.pick(16);
                        let change = rng.pick(2) == 0;
                        target = bundle(&mut rng, network, ni, change);
                        if rng.pick(6) == 0 {
                            let n = 1 + rng.pick(4);
                            for _ in 0..n {
                                let p = rng.pick(target.len());
                                target[p] ^= 1 << rng.pick(8);
                            }
                        }
                        let mut b = begin(&target);
                        if rng.pick(30) == 0 {
                            b[7 + rng.pick(32)] ^= 1;
                        }
                        b
                    }
                    ModelState::Receiving { bytes, size, .. } if roll < 85 => {
                        if bytes.len() == size || rng.pick(25) == 0 {
                            apdu(0x12, &[])
                        } else {
                            let remaining = size - bytes.len();
                            let n = match rng.pick(5) {
                                0 => 1,
                                1 => 253,
                                _ => 1 + rng.pick(253),
                            }
                            .min(remaining);
                            let pos = bytes.len();
                            let mut b = append(pos, &target[pos..pos + n]);
                            if rng.pick(40) == 0 {
                                b[5] ^= 1;
                            }
                            b
                        }
                    }
                    ModelState::Signatures { next, .. } if roll < 85 => {
                        let index = if rng.pick(10) == 0 {
                            rng.pick(256)
                        } else {
                            next
                        };
                        apdu(0x13, &[index as u8])
                    }
                    _ => match rng.pick(10) {
                        0 => apdu(0x00, &[]),
                        1 => apdu(0x01, &rng.path_index().to_le_bytes()),
                        2 => {
                            let mut d = rng.path_index().to_le_bytes().to_vec();
                            d.push(rng.pick(3) as u8);
                            d.extend_from_slice(&rng.path_index().to_le_bytes());
                            apdu(0x02, &d)
                        }
                        3 => apdu(0x14, &[]),
                        4 => apdu(0x13, &[rng.pick(17) as u8]),
                        5 => apdu(0x12, &[]),
                        6 => begin(&target),
                        7 => apdu(0x11, &[0, 0, 1]),
                        8 => apdu(rng.pick(256) as u8, &[]),
                        _ => apdu(0x10, &[0; 34]),
                    },
                };
                if rng.pick(40) == 0 {
                    match rng.pick(5) {
                        0 => command[0] ^= 1,
                        1 => command[2] = 1,
                        2 => command[3] = 1,
                        3 => command[4] ^= 1,
                        _ => {
                            command.pop();
                        }
                    }
                }
                let f = if rng.pick(5) == 0 {
                    fault(&mut rng)
                } else {
                    Fault::None
                };
                h.step(&command, f);
            }
            // Close the loop each episode, then prove no stale signature can be released.
            h.step(&apdu(0x14, &[]), Fault::None);
            invalidation_probe(&mut h);
        }
        add(&mut total, &h.counts);
    }
    total
}
fn main() {
    assert_eq!(MAX_BUNDLE_SIZE, 1507);
    assert_eq!(MIN_BUNDLE_SIZE, 154);
    let args: Vec<_> = std::env::args().collect();
    let seed = args
        .get(1)
        .map(|s| u64::from_str_radix(s.trim_start_matches("0x"), 16).unwrap())
        .unwrap_or(0x7065_6172_6c20_2609);
    let episodes = args.get(2).map(|s| s.parse().unwrap()).unwrap_or(10_000);
    let mode = args.get(3).map(String::as_str).unwrap_or("all");
    if ![
        "all",
        "boundaries",
        "callbacks",
        "opcodes",
        "mutations",
        "walks",
    ]
    .contains(&mode)
        || episodes == 0
        || args.len() > 4
    {
        eprintln!("REFUSED: unknown suite, zero episodes, or extra arguments");
        std::process::exit(2);
    }
    let start = std::time::Instant::now();
    let mut total = Counts::default();
    println!("seed={seed:#018x} episodes_per_network={episodes} mode={mode} production=external-hash-verified-core harness=hardened-v2");
    for (name, run) in [
        ("boundaries", suite_boundaries as fn(u64) -> Counts),
        ("callbacks", suite_callbacks),
        ("opcodes", suite_opcodes),
        ("mutations", suite_mutations),
    ] {
        if mode == "all" || mode == name {
            let c = run(seed);
            println!("PASS {name}: {c:?} elapsed={:?}", start.elapsed());
            add(&mut total, &c);
        }
    }
    if mode == "all" || mode == "walks" {
        let c = suite_walks(seed, episodes);
        println!("PASS walks: {c:?} elapsed={:?}", start.elapsed());
        add(&mut total, &c);
    }
    assert!(total.commands > 0, "refuse zero-coverage success");
    println!("PASS TOTAL {total:?} elapsed={:?}", start.elapsed());
    println!("Bounded result: exact production Session state/response/callback agreement for these deterministic traces; public mocks do not establish real cryptography, device UI, hardware isolation, or transport integration.");
}
