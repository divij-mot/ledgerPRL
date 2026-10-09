#![no_std]
#![no_main]

extern crate alloc;
mod crypto;
mod ui;
mod warnings;

use ledger_device_sdk::io::{ApduHeader, Comm, Event, Reply, StatusWords, init_comm};
use pearl_core::{
    AccountPath, AccountPublic, Address, DerivationPath, Device, Error, Network, PublicKeyProvider,
    ReviewedTransaction, Session, ValidatedTransaction,
};
use zeroize::Zeroize;

#[cfg(any(
    all(feature = "testnet", feature = "testnet2"),
    all(feature = "testnet", feature = "regtest"),
    all(feature = "testnet", feature = "simnet"),
    all(feature = "testnet2", feature = "regtest"),
    all(feature = "testnet2", feature = "simnet"),
    all(feature = "regtest", feature = "simnet")
))]
compile_error!("Choose exactly one Pearl network per firmware binary");

const NETWORK: Network = if cfg!(feature = "testnet") {
    Network::Testnet
} else if cfg!(feature = "testnet2") {
    Network::Testnet2
} else if cfg!(feature = "regtest") {
    Network::Regtest
} else if cfg!(feature = "simnet") {
    Network::Simnet
} else {
    Network::Mainnet
};

ledger_device_sdk::set_panic!(ledger_device_sdk::exiting_panic);
ledger_device_sdk::define_comm!(COMM);

struct Ledger<'a> {
    comm: &'a mut Comm,
}
impl PublicKeyProvider for Ledger<'_> {
    fn validate_output_key(&mut self, output: &[u8; 32]) -> Result<(), Error> {
        crypto::validate_output_key(output)
    }
    fn derive_output_key(&mut self, path: &DerivationPath) -> Result<[u8; 32], Error> {
        crypto::output_key(path)
    }
}
impl Device for Ledger<'_> {
    fn account_public(&mut self, path: &AccountPath) -> Result<AccountPublic, Error> {
        crypto::account_public(path)
    }
    fn confirm_account(&mut self, path: &AccountPath, public: &AccountPublic) -> Result<(), Error> {
        ui::confirm_account(self.comm, path, public)
    }
    fn confirm_address(&mut self, path: &DerivationPath, address: &Address) -> Result<(), Error> {
        ui::confirm_address(self.comm, path, address)
    }
    fn review_transaction(&mut self, tx: &ValidatedTransaction) -> Result<(), Error> {
        ui::review(self.comm, tx)
    }
    fn sign_input(&mut self, tx: &ReviewedTransaction, index: usize) -> Result<[u8; 64], Error> {
        crypto::sign_input(tx, index)
    }
}
struct Header(ApduHeader);
impl TryFrom<ApduHeader> for Header {
    type Error = StatusWords;
    fn try_from(header: ApduHeader) -> Result<Self, Self::Error> {
        Ok(Self(header))
    }
}

#[unsafe(no_mangle)]
extern "C" fn sample_main() {
    let comm = init_comm(&COMM);
    let mut home = ui::home();
    home.show_and_return();
    let mut session = Session::new(NETWORK);
    loop {
        match comm.next_event() {
            Event::Command(command) => {
                let header = match command.decode::<Header>() {
                    Ok(value) => value.0,
                    Err(_) => {
                        session.reset();
                        ledger_device_sdk::exit_app(1);
                    }
                };
                let data = command.get_data();
                if data.len() > 255 {
                    session.reset();
                    let _ = command.reply(&[], Reply(0x6700));
                    ledger_device_sdk::exit_app(1);
                }
                let mut raw = [0u8; 260];
                let length = data.len() + 5;
                raw[..5].copy_from_slice(&[
                    header.cla,
                    header.ins,
                    header.p1,
                    header.p2,
                    data.len() as u8,
                ]);
                raw[5..length].copy_from_slice(data);
                let comm = command.into_comm();
                // This method intentionally exists only in the audited, pinned
                // SDK patch. An unpatched SDK cannot build this application.
                comm.set_strict_session(true);
                let response = session.handle_apdu(&raw[..length], &mut Ledger { comm });
                raw.zeroize();
                if comm.session_faulted() {
                    session.reset();
                    let _ = comm.begin_response().send(Reply(0x6986));
                    ledger_device_sdk::exit_app(1);
                }
                comm.set_strict_session(!session.is_idle());
                let sent = comm
                    .begin_response()
                    .extend(response.data())
                    .and_then(|r| r.send(Reply(response.status())));
                if sent.is_err() {
                    session.on_disconnect();
                    ledger_device_sdk::exit_app(1);
                }
                home.show_and_return();
            }
            Event::SessionFault => {
                session.reset();
                ledger_device_sdk::exit_app(1);
            }
            Event::Internal => {
                // Conservative invalidation for an SDK-handled event between
                // commands. During review strict SDK handling rejects synchronously.
                session.reset();
                comm.set_strict_session(false);
            }
            _ => {}
        }
    }
}
