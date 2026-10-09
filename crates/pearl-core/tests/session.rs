mod common;
use common::*;
use pearl_core::*;
use proptest::prelude::*;

#[test]
fn approval_precedes_signatures_and_complete_fetch_wipes() {
    let mut s = Session::new(Network::Regtest);
    let mut d = MockDevice::default();
    let bytes = bundle(16, true);
    transfer(&mut s, &mut d, &bytes);
    assert_eq!(d.signed, 0);
    let response = s.handle_apdu(&apdu(0x12, &[]), &mut d);
    assert_eq!(response.status(), 0x9000);
    assert_eq!(response.data()[0], 16);
    assert_eq!(&response.data()[1..], bundle_hash(&bytes));
    assert_eq!(d.reviewed, 1);
    assert_eq!(d.signed, 16);
    for i in 0..16 {
        let signature = s.handle_apdu(&apdu(0x13, &[i]), &mut d);
        assert_eq!(signature.status(), 0x9000);
        assert_eq!(signature.data(), &[i + 1; 64]);
    }
    assert!(s.is_idle());
    assert_eq!(s.handle_apdu(&apdu(0x13, &[0]), &mut d).status(), 0x6986);
}
#[test]
fn every_rejection_and_signing_failure_is_terminal() {
    for failure in [None, Some(0), Some(1)] {
        let mut s = Session::new(Network::Regtest);
        let mut d = MockDevice {
            reject: failure.is_none(),
            fail_sign: failure,
            ..Default::default()
        };
        transfer(&mut s, &mut d, &bundle(2, true));
        let r = s.handle_apdu(&apdu(0x12, &[]), &mut d);
        assert_eq!(r.status(), if failure.is_none() { 0x6985 } else { 0x6f00 });
        assert!(r.data().is_empty());
        assert!(s.is_idle());
        assert_eq!(s.handle_apdu(&apdu(0x13, &[0]), &mut d).status(), 0x6986);
    }
}
#[test]
fn malformed_commands_wipe_receiving_and_signed_sessions() {
    let bad_commands = vec![
        vec![],
        vec![0xe0, 0x12, 0, 0],
        vec![0xe0, 0x12, 0, 0, 1],
        vec![0xe0, 0x12, 0, 0, 0, 0],
        vec![0, 0x12, 0, 0, 0],
        vec![0xe0, 0x12, 1, 0, 0],
        vec![0xe0, 0x12, 0, 1, 0],
        apdu(0xff, &[]),
        apdu(1, &[0; 4]),
        apdu(2, &[0; 9]),
        apdu(0, &[]),
        apdu(0x13, &[16]),
        apdu(0x14, &[1]),
    ];
    for signed in [false, true] {
        for bad in &bad_commands {
            let mut s = Session::new(Network::Regtest);
            let mut d = MockDevice::default();
            transfer(&mut s, &mut d, &bundle(2, true));
            if signed {
                assert_eq!(s.handle_apdu(&apdu(0x12, &[]), &mut d).status(), 0x9000);
            }
            assert_ne!(
                s.handle_apdu(bad, &mut d).status(),
                0x9000,
                "accepted {bad:?}"
            );
            assert!(s.is_idle());
        }
    }
}
#[test]
fn transfers_reject_reorder_replay_empty_overflow_and_replacement() {
    let bytes = bundle(1, false);
    for data in [vec![0, 0], vec![1, 0, 9], vec![0, 0, 9, 10]] {
        let mut s = Session::new(Network::Regtest);
        let mut d = MockDevice::default();
        begin(&mut s, &mut d, &bytes);
        if data.len() == 4 {
            let p = apdu(0x11, &data);
            assert_eq!(s.handle_apdu(&p, &mut d).status(), 0x9000);
            assert_ne!(s.handle_apdu(&p, &mut d).status(), 0x9000);
        } else {
            assert_ne!(s.handle_apdu(&apdu(0x11, &data), &mut d).status(), 0x9000);
        }
        assert!(s.is_idle());
        assert_eq!(d.signed, 0);
    }
    let mut s = Session::new(Network::Regtest);
    let mut d = MockDevice::default();
    transfer(&mut s, &mut d, &bytes);
    let data = vec![bytes.len() as u8, 0, 9];
    assert_ne!(s.handle_apdu(&apdu(0x11, &data), &mut d).status(), 0x9000);
    assert!(s.is_idle());
    begin(&mut s, &mut d, &bytes);
    assert_eq!(
        s.handle_apdu(&apdu(0x10, &[0; 34]), &mut d).status(),
        0x6986
    );
    assert!(s.is_idle());
}
#[test]
fn incomplete_hash_mismatch_and_forged_change_never_reach_review() {
    let bytes = bundle(1, true);
    let mut s = Session::new(Network::Regtest);
    let mut d = MockDevice::default();
    begin(&mut s, &mut d, &bytes);
    assert_ne!(s.handle_apdu(&apdu(0x12, &[]), &mut d).status(), 0x9000);
    assert!(s.is_idle());
    begin(&mut s, &mut d, &bytes);
    let mut wrong = bytes.clone();
    wrong[50] ^= 1;
    let mut data = vec![0, 0];
    data.extend(wrong);
    assert_eq!(s.handle_apdu(&apdu(0x11, &data), &mut d).status(), 0x9000);
    assert_eq!(s.handle_apdu(&apdu(0x12, &[]), &mut d).status(), 0x6a80);
    assert!(s.is_idle());
    let mut malicious = bytes;
    malicious[19 + 87 + 48 + 10] ^= 1;
    transfer(&mut s, &mut d, &malicious);
    assert_eq!(s.handle_apdu(&apdu(0x12, &[]), &mut d).status(), 0x6a80);
    assert!(s.is_idle());
    assert_eq!(d.reviewed, 0);
    assert_eq!(d.signed, 0);
}
#[test]
fn out_of_order_or_repeated_signature_fetch_destroys_session() {
    for first in [0, 1] {
        let mut s = Session::new(Network::Regtest);
        let mut d = MockDevice::default();
        transfer(&mut s, &mut d, &bundle(2, true));
        assert_eq!(s.handle_apdu(&apdu(0x12, &[]), &mut d).status(), 0x9000);
        if first == 0 {
            assert_eq!(s.handle_apdu(&apdu(0x13, &[0]), &mut d).status(), 0x9000);
        }
        assert_ne!(
            s.handle_apdu(&apdu(0x13, &[first]), &mut d).status(),
            0x9000
        );
        assert!(s.is_idle());
    }
}
#[test]
fn lifecycle_events_and_abort_clear_every_active_state() {
    for state in [0, 1, 2] {
        for event in 0..4 {
            let mut s = Session::new(Network::Regtest);
            let mut d = MockDevice::default();
            if state > 0 {
                transfer(&mut s, &mut d, &bundle(2, true));
            }
            if state > 1 {
                assert_eq!(s.handle_apdu(&apdu(0x12, &[]), &mut d).status(), 0x9000);
            }
            match event {
                0 => s.on_disconnect(),
                1 => s.on_timeout(),
                2 => s.on_app_exit(),
                _ => {
                    assert_eq!(s.handle_apdu(&apdu(0x14, &[]), &mut d).status(), 0x9000);
                }
            }
            assert!(s.is_idle());
            assert_eq!(s.handle_apdu(&apdu(0x13, &[0]), &mut d).status(), 0x6986);
        }
    }
}
#[test]
fn account_and_address_exports_require_confirmations() {
    for reject in [false, true] {
        let mut s = Session::new(Network::Regtest);
        let mut d = MockDevice {
            reject,
            ..Default::default()
        };
        let account = s.handle_apdu(&apdu(1, &7u32.to_le_bytes()), &mut d);
        let address = s.handle_apdu(&apdu(2, &[0; 9]), &mut d);
        assert_eq!(d.confirmed, 2);
        if reject {
            assert_eq!(account.status(), 0x6985);
            assert_eq!(address.status(), 0x6985);
            assert!(account.data().is_empty());
        } else {
            assert_eq!(account.data().len(), 74);
            assert_eq!(account.data()[69], 3);
            assert_eq!(&account.data()[70..], &7u32.to_le_bytes());
            assert_eq!(address.data().len(), 64);
        }
    }
}
#[test]
fn capabilities_and_exact_status_words() {
    let mut s = Session::new(Network::Regtest);
    let mut d = MockDevice::default();
    let response = s.handle_apdu(&apdu(0, &[]), &mut d);
    assert_eq!(response.data(), &[1, 0, 1, 0, 3, 16, 0xe3, 5]);
    for (raw, status) in [
        (vec![0xe0, 0, 0, 0], 0x6700),
        (vec![0, 0, 0, 0, 0], 0x6e00),
        (vec![0xe0, 0, 1, 0, 0], 0x6b00),
        (apdu(0xff, &[]), 0x6d00),
    ] {
        assert_eq!(s.handle_apdu(&raw, &mut d).status(), status);
    }
}
proptest! {
    #![proptest_config(ProptestConfig::with_cases(512))]
    #[test]
    fn hostile_apdu_sequences_never_sign_without_review(commands in prop::collection::vec(prop::collection::vec(any::<u8>(),0..270),0..20)) {
        let mut s=Session::new(Network::Regtest); let mut d=MockDevice{reject:true,..Default::default()};
        for command in commands { let r=s.handle_apdu(&command,&mut d); if r.status()!=0x9000 {prop_assert!(s.is_idle());} }
        prop_assert_eq!(d.signed,0);
    }
}

#[test]
fn every_short_apdu_chunk_boundary_preserves_canonical_bytes() {
    let bytes = bundle(3, true);
    for chunk_size in 1..=253 {
        let mut session = Session::new(Network::Regtest);
        let mut device = MockDevice::default();
        begin(&mut session, &mut device, &bytes);
        let mut offset = 0usize;
        for chunk in bytes.chunks(chunk_size) {
            let mut data = (offset as u16).to_le_bytes().to_vec();
            data.extend(chunk);
            assert_eq!(
                session
                    .handle_apdu(&apdu(0x11, &data), &mut device)
                    .status(),
                0x9000
            );
            offset += chunk.len();
        }
        assert_eq!(
            session.handle_apdu(&apdu(0x12, &[]), &mut device).status(),
            0x9000
        );
        assert_eq!(device.signed, 3);
    }
}

#[test]
fn begin_rejects_undersized_oversized_and_noncanonical_lengths() {
    for size in [0, 1, 153, 1508, u16::MAX] {
        let mut session = Session::new(Network::Regtest);
        let mut device = MockDevice::default();
        let mut data = u16::to_le_bytes(size).to_vec();
        data.extend([0; 32]);
        assert_eq!(
            session
                .handle_apdu(&apdu(0x10, &data), &mut device)
                .status(),
            0x6700
        );
        assert!(session.is_idle());
        assert_eq!(device.signed, 0);
    }
}
