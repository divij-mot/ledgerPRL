mod common;
use bitcoin::{
    consensus::deserialize,
    hashes::Hash,
    sighash::{Prevouts, SighashCache, TapSighashType},
};
use common::*;
use pearl_core::*;

fn reference_transaction(tx: &pearl_core::Transaction) -> bitcoin::Transaction {
    let mut raw = tx.version().to_le_bytes().to_vec();
    raw.push(tx.inputs().len() as u8);
    for input in tx.inputs() {
        raw.extend(input.txid());
        raw.extend(input.vout().to_le_bytes());
        raw.push(0);
        raw.extend(input.sequence().to_le_bytes());
    }
    raw.push(tx.outputs().len() as u8);
    for output in tx.outputs() {
        raw.extend(output.amount().to_le_bytes());
        raw.push(34);
        raw.extend(output.script());
    }
    raw.extend(tx.locktime().to_le_bytes());
    deserialize(&raw).unwrap()
}
fn reference_prevouts(tx: &pearl_core::Transaction) -> Vec<bitcoin::TxOut> {
    tx.inputs()
        .iter()
        .map(|i| bitcoin::TxOut {
            value: bitcoin::Amount::from_sat(i.amount()),
            script_pubkey: bitcoin::ScriptBuf::from_bytes(i.script().to_vec()),
        })
        .collect()
}
#[test]
fn all_supported_shapes_match_independent_rust_bitcoin_bip341() {
    for count in 1..=16 {
        for change in [false, true] {
            for amount in [1000, 100_000_000, MAX_GRAINS / (count as u64)] {
                let bytes = bundle_with_amount(count, change, amount);
                let tx = parse_bundle(&bytes, Network::Regtest).unwrap();
                let btc = reference_transaction(&tx);
                let prevouts = reference_prevouts(&tx);
                let mut cache = SighashCache::new(&btc);
                for i in 0..count {
                    let expected = cache
                        .taproot_key_spend_signature_hash(
                            i,
                            &Prevouts::All(&prevouts),
                            TapSighashType::Default,
                        )
                        .unwrap();
                    assert_eq!(
                        tx.sighash(i).unwrap(),
                        expected.to_byte_array(),
                        "count={count} change={change} amount={amount} input={i}"
                    );
                }
                assert!(tx.sighash(count).is_err());
            }
        }
    }
}
#[test]
fn every_supported_consensus_field_is_committed() {
    let bytes = bundle(2, true);
    let original = parse_bundle(&bytes, Network::Regtest)
        .unwrap()
        .sighash(0)
        .unwrap();
    for offset in [
        19,
        19 + 32,
        19 + 36,
        19 + 46,
        19 + 87,
        19 + 87 + 32,
        19 + 87 + 36,
        19 + 87 + 46,
        19 + 174,
        19 + 174 + 10,
        19 + 174 + 48,
        19 + 174 + 48 + 10,
    ] {
        let mut altered = bytes.clone();
        altered[offset] ^= 1;
        let tx = parse_bundle(&altered, Network::Regtest).unwrap();
        assert_ne!(tx.sighash(0).unwrap(), original, "offset {offset}");
    }
    let tx = parse_bundle(&bytes, Network::Regtest).unwrap();
    assert_ne!(tx.sighash(0).unwrap(), tx.sighash(1).unwrap());
}
#[test]
fn shared_typescript_fixture_matches_hash_addresses_signatures_and_txid() {
    let fixture: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/protocol-v1.json")).unwrap();
    let bytes = hex::decode(fixture["bundleHex"].as_str().unwrap()).unwrap();
    assert_eq!(
        hex::encode(bundle_hash(&bytes)),
        fixture["bundleSha256"].as_str().unwrap()
    );
    let tx = parse_bundle(&bytes, Network::Regtest).unwrap();
    assert_eq!(tx.fee(), 1000);
    assert_eq!(tx.inputs()[0].amount(), 9_007_199_254_740_993);
    let btc: bitcoin::Transaction =
        deserialize(&hex::decode(fixture["rawTx"].as_str().unwrap()).unwrap()).unwrap();
    let prevouts = reference_prevouts(&tx);
    let mut cache = SighashCache::new(&btc);
    let secp = bitcoin::secp256k1::Secp256k1::verification_only();
    for (i, input) in tx.inputs().iter().enumerate() {
        let digest = tx.sighash(i).unwrap();
        assert_eq!(
            hex::encode(digest),
            fixture["sighashes"][i].as_str().unwrap()
        );
        assert_eq!(
            digest,
            cache
                .taproot_key_spend_signature_hash(
                    i,
                    &Prevouts::All(&prevouts),
                    TapSighashType::Default
                )
                .unwrap()
                .to_byte_array()
        );
        let sig = bitcoin::secp256k1::schnorr::Signature::from_slice(
            &hex::decode(fixture["signatures"][i].as_str().unwrap()).unwrap(),
        )
        .unwrap();
        let public = bitcoin::secp256k1::XOnlyPublicKey::from_slice(&input.script()[2..]).unwrap();
        secp.verify_schnorr(
            &sig,
            &bitcoin::secp256k1::Message::from_digest(digest),
            &public,
        )
        .unwrap();
    }
    assert_eq!(
        btc.compute_txid().to_string(),
        fixture["txid"].as_str().unwrap()
    );
    assert_eq!(
        btc.compute_wtxid().to_string(),
        fixture["wtxid"].as_str().unwrap()
    );
    assert_eq!(btc.vsize() as u64, fixture["vsize"].as_u64().unwrap());
    assert_eq!(btc.input.len(), tx.inputs().len());
    assert_eq!(btc.output, reference_transaction(&tx).output);
    assert_eq!(
        Address::from_output_key(Network::Regtest, &tx.recipient().output_key())
            .unwrap()
            .as_str(),
        fixture["addresses"]["recipient"].as_str().unwrap()
    );
    assert_eq!(
        Address::from_output_key(Network::Regtest, &tx.change().unwrap().output_key())
            .unwrap()
            .as_str(),
        fixture["addresses"]["change"].as_str().unwrap()
    );
}

/// A TEST-ONLY public xpub provider: no secret derivation/signing in Rust tests.
struct FixtureProvider {
    account: bitcoin::bip32::Xpub,
}
impl PublicKeyProvider for FixtureProvider {
    fn validate_output_key(&mut self, key: &[u8; 32]) -> Result<(), Error> {
        bitcoin::secp256k1::XOnlyPublicKey::from_slice(key)
            .map(|_| ())
            .map_err(|_| Error::InvalidData)
    }
    fn derive_output_key(&mut self, path: &DerivationPath) -> Result<[u8; 32], Error> {
        use bitcoin::{bip32::ChildNumber, key::TapTweak};
        if path.network() != Network::Regtest || path.account() != 0 {
            return Err(Error::InvalidPath);
        }
        let secp = bitcoin::secp256k1::Secp256k1::verification_only();
        let child = self
            .account
            .derive_pub(
                &secp,
                &[
                    ChildNumber::from_normal_idx(path.branch() as u32)
                        .map_err(|_| Error::InvalidPath)?,
                    ChildNumber::from_normal_idx(path.index()).map_err(|_| Error::InvalidPath)?,
                ],
            )
            .map_err(|_| Error::Crypto)?;
        let (output, _) = child
            .public_key
            .x_only_public_key()
            .0
            .tap_tweak(&secp, None);
        Ok(output.to_x_only_public_key().serialize())
    }
}
#[test]
fn public_xpub_derivation_and_empty_tree_tweak_match_typescript_fixture() {
    use bitcoin::bip32::{ChainCode, ChildNumber, Fingerprint, Xpub};
    let f: serde_json::Value =
        serde_json::from_str(include_str!("../../../fixtures/protocol-v1.json")).unwrap();
    let account = &f["publicAccount"];
    let mut provider = FixtureProvider {
        account: Xpub {
            network: bitcoin::NetworkKind::Test,
            depth: 3,
            // Parent fingerprint is only serialization metadata, not public-child derivation input.
            parent_fingerprint: Fingerprint::from([0; 4]),
            child_number: ChildNumber::from_hardened_idx(0).unwrap(),
            public_key: bitcoin::secp256k1::PublicKey::from_slice(
                &hex::decode(account["publicKey"].as_str().unwrap()).unwrap(),
            )
            .unwrap(),
            chain_code: ChainCode::from(
                <[u8; 32]>::try_from(hex::decode(account["chainCode"].as_str().unwrap()).unwrap())
                    .unwrap(),
            ),
        },
    };
    let bytes = hex::decode(f["bundleHex"].as_str().unwrap()).unwrap();
    let validated = parse_bundle(&bytes, Network::Regtest)
        .unwrap()
        .validate_ownership(&mut provider)
        .unwrap();
    assert_eq!(
        validated.recipient_address().as_str(),
        f["addresses"]["recipient"].as_str().unwrap()
    );
    assert_eq!(
        validated.change_address().unwrap().as_str(),
        f["addresses"]["change"].as_str().unwrap()
    );
    for invalid in [[0xff; 32], [0; 32]] {
        assert!(provider.validate_output_key(&invalid).is_err());
    }
}
