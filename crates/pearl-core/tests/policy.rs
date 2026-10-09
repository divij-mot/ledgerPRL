mod common;
use common::*;
use pearl_core::*;
use proptest::prelude::*;

#[test]
fn exact_amounts_and_checked_bounds() {
    assert_eq!(Amount::new(0).unwrap().to_string(), "0.00000000");
    assert_eq!(Amount::new(1).unwrap().to_string(), "0.00000001");
    assert_eq!(Amount::new(100_000_001).unwrap().to_string(), "1.00000001");
    assert_eq!(
        Amount::new(MAX_GRAINS).unwrap().to_string(),
        "21000000000.00000000"
    );
    assert!(Amount::new(MAX_GRAINS + 1).is_err());
    assert!(Amount::new(u64::MAX).is_err());
    assert!(Amount::new(MAX_GRAINS)
        .unwrap()
        .checked_add(Amount::new(1).unwrap())
        .is_err());
    assert!(Amount::new(0)
        .unwrap()
        .checked_sub(Amount::new(1).unwrap())
        .is_err());
}
#[test]
fn strict_network_and_path_firewall() {
    for n in 0..=4 {
        let network = Network::from_byte(n).unwrap();
        let p = DerivationPath::new(network, 3, 1, 42).unwrap();
        assert_eq!(
            p.components(),
            [
                86 | HARDENED,
                network.coin_type() | HARDENED,
                3 | HARDENED,
                1,
                42
            ]
        );
        assert_eq!(
            AccountPath::new(network, 3).unwrap().components(),
            p.components()[..3]
        );
    }
    for n in 5..=255 {
        assert!(Network::from_byte(n).is_err());
    }
    assert!(DerivationPath::new(Network::Mainnet, HARDENED, 0, 0).is_err());
    assert!(AccountPath::new(Network::Mainnet, u32::MAX).is_err());
    assert!(DerivationPath::new(Network::Mainnet, 0, 2, 0).is_err());
    assert!(DerivationPath::new(Network::Mainnet, 0, 0, HARDENED).is_err());
    assert!(DerivationPath::new(Network::Mainnet, HARDENED - 1, 1, HARDENED - 1).is_ok());
    assert!(parse_bundle(&bundle(1, false), Network::Simnet).is_err()); // same HRP, different network
}
#[test]
fn all_supported_sizes_and_precise_fees() {
    for count in 1..=MAX_INPUTS {
        for change in [false, true] {
            let bytes = bundle(count, change);
            let tx = parse_bundle(&bytes, Network::Regtest).unwrap();
            assert_eq!(
                bytes.len(),
                19 + 87 * count + 48 * (1 + usize::from(change))
            );
            assert_eq!(tx.inputs().len(), count);
            assert_eq!(tx.fee(), 10);
            let validated = tx.validate_ownership(&mut MockDevice::default()).unwrap();
            assert_eq!(validated.change().is_some(), change);
            assert_eq!(validated.recipient_address().as_str().len(), 64);
        }
    }
    assert_eq!(bundle(16, true).len(), MAX_BUNDLE_SIZE);
    assert!(parse_bundle(&bundle(17, false), Network::Regtest).is_err());
}
#[test]
fn truncation_at_every_byte_and_trailing_data_rejected() {
    let bytes = bundle(16, true);
    for end in 0..bytes.len() {
        assert!(
            parse_bundle(&bytes[..end], Network::Regtest).is_err(),
            "accepted {end}"
        );
    }
    let mut extra = bundle(1, false);
    extra.push(0);
    assert!(parse_bundle(&extra, Network::Regtest).is_err());
}
#[test]
fn malformed_header_scripts_paths_and_roles_rejected() {
    for (offset, value) in [
        (0, 0),
        (4, 5),
        (9, 2),
        (13, 1),
        (17, 0),
        (17, 17),
        (18, 0),
        (18, 3),
        (19 + 44, 0x52),
        (19 + 45, 0x21),
        (19 + 78, 0),
        (19 + 82, 2),
        (19 + 86, 0x80),
        (19 + 87 + 8, 0x52),
        (19 + 87 + 42, 2),
        (19 + 87 + 43, 1),
        (19 + 87 + 44, 1),
    ] {
        let mut bytes = bundle(1, false);
        bytes[offset] = value;
        assert!(
            parse_bundle(&bytes, Network::Regtest).is_err(),
            "accepted offset {offset}"
        );
    }
    let mut high_account = bundle(1, false);
    high_account[5..9].copy_from_slice(&HARDENED.to_le_bytes());
    assert!(parse_bundle(&high_account, Network::Regtest).is_err());
    let mut two_recipients = bundle(1, true);
    let change = 19 + 87 + 48;
    two_recipients[change + 42] = 0;
    two_recipients[change + 43] = 0;
    two_recipients[change + 44..change + 48].fill(0);
    assert!(parse_bundle(&two_recipients, Network::Regtest).is_err());
    let mut no_recipient = bundle(1, false);
    let out = 19 + 87;
    no_recipient[out + 42] = 1;
    no_recipient[out + 43] = 1;
    assert!(parse_bundle(&no_recipient, Network::Regtest).is_err());
}
#[test]
fn duplicate_outpoints_rejected_but_distinct_vouts_allowed() {
    let mut bytes = bundle(2, false);
    let first = bytes[19..55].to_vec();
    bytes[106..142].copy_from_slice(&first);
    assert!(matches!(
        parse_bundle(&bytes, Network::Regtest),
        Err(Error::DuplicateOutpoint)
    ));
    bytes[138] = 1;
    assert!(parse_bundle(&bytes, Network::Regtest).is_ok());
}
#[test]
fn impossible_amounts_and_aggregate_overflow_are_rejected() {
    for amount in [0, MAX_GRAINS + 1, u64::MAX] {
        let mut bytes = bundle(1, false);
        bytes[55..63].copy_from_slice(&amount.to_le_bytes());
        assert!(parse_bundle(&bytes, Network::Regtest).is_err());
        let mut bytes = bundle(1, false);
        bytes[106..114].copy_from_slice(&amount.to_le_bytes());
        assert!(parse_bundle(&bytes, Network::Regtest).is_err());
    }
    for count in [2, 5, 9, 16] {
        let mut bytes = bundle(count, true);
        for i in 0..count {
            bytes[19 + 87 * i + 36..19 + 87 * i + 44].copy_from_slice(&MAX_GRAINS.to_le_bytes());
        }
        assert!(parse_bundle(&bytes, Network::Regtest).is_err());
    }
    let mut bytes = bundle(1, false);
    bytes[106..114].copy_from_slice(&100_000_001u64.to_le_bytes());
    assert!(parse_bundle(&bytes, Network::Regtest).is_err());
    let bytes = bundle_with_amount(1, true, MAX_GRAINS);
    assert_eq!(parse_bundle(&bytes, Network::Regtest).unwrap().fee(), 10);
}
#[test]
fn forged_input_and_change_never_validate() {
    for offset in [19 + 46, 19 + 87 + 48 + 10] {
        let mut bytes = bundle(1, true);
        bytes[offset] ^= 1;
        let tx = parse_bundle(&bytes, Network::Regtest).unwrap();
        assert!(matches!(
            tx.validate_ownership(&mut MockDevice::default()),
            Err(Error::OwnershipMismatch)
        ));
    }
}
#[test]
fn bech32m_full_addresses_have_exact_hrp_and_version() {
    use bech32::primitives::decode::SegwitHrpstring;
    for n in 0..=4 {
        let network = Network::from_byte(n).unwrap();
        let address = Address::from_output_key(network, &[0x42; 32]).unwrap();
        let checked = SegwitHrpstring::new(address.as_str()).unwrap();
        assert_eq!(checked.hrp().as_str(), network.hrp());
        assert_eq!(checked.witness_version(), bech32::segwit::VERSION_1);
        assert_eq!(checked.byte_iter().collect::<Vec<_>>(), vec![0x42; 32]);
    }
}
proptest! {
    #![proptest_config(ProptestConfig::with_cases(1024))]
    #[test]
    fn arbitrary_bytes_never_panic(bytes in prop::collection::vec(any::<u8>(),0..1600)) {
        for n in 0..=4 { let _=parse_bundle(&bytes,Network::from_byte(n).unwrap()); }
    }
    #[test]
    fn valid_bounded_totals_stay_exact(count in 1usize..=16, amount in 100u64..=(MAX_GRAINS/16), change in any::<bool>()) {
        let bytes=bundle_with_amount(count,change,amount); let tx=parse_bundle(&bytes,Network::Regtest).unwrap();
        prop_assert_eq!(tx.input_total(),amount*count as u64); prop_assert_eq!(tx.fee(),10);
        prop_assert_eq!(tx.output_total()+tx.fee(),tx.input_total());
    }
}

#[test]
fn invalid_recipient_x_only_key_fails_before_review() {
    let mut bytes = bundle(1, false);
    bytes[19 + 87 + 10..19 + 87 + 42].fill(0xff);
    let parsed = parse_bundle(&bytes, Network::Regtest).unwrap();
    let mut device = MockDevice::default();
    assert!(matches!(
        parsed.validate_ownership(&mut device),
        Err(Error::InvalidData)
    ));
    assert_eq!(device.derived, 0);
    let mut session = Session::new(Network::Regtest);
    transfer(&mut session, &mut device, &bytes);
    assert_eq!(
        session.handle_apdu(&apdu(0x12, &[]), &mut device).status(),
        0x6a80
    );
    assert_eq!(device.reviewed, 0);
    assert_eq!(device.signed, 0);
    assert!(session.is_idle());
}
