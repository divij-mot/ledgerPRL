//! Trusted NBGL review is shared by Nano S Plus/Nano X and Stax/Flex.
//! All strings come from device-validated public state; no host label is shown.
use alloc::{format, string::String};
use ledger_device_sdk::{
    io::Comm,
    nbgl::{Field, NbglAddressReview, NbglChoice, NbglHomeAndSettings, NbglReview},
};
use pearl_core::{
    AccountPath, AccountPublic, Address, Amount, DerivationPath, Error, Network,
    ValidatedTransaction,
};

pub fn home() -> NbglHomeAndSettings {
    NbglHomeAndSettings::new()
        .app_name(crate::NETWORK.label())
        .info_list(&[
            ("Version", env!("CARGO_PKG_VERSION")),
            ("Status", "Development build"),
            ("Policy", "BIP86 key-path only"),
        ])
}
fn approved(value: bool, comm: &Comm) -> Result<(), Error> {
    if comm.session_faulted() {
        return Err(Error::WrongState);
    }
    if value {
        Ok(())
    } else {
        Err(Error::UserRejected)
    }
}
fn warning(comm: &mut Comm, title: &str, detail: &str) -> Result<(), Error> {
    approved(
        NbglChoice::new().show(comm, title, detail, "Review anyway", "Reject"),
        comm,
    )
}
fn amount(value: u64) -> Result<String, Error> {
    Ok(format!("{} PRL", Amount::new(value)?))
}
fn account_path(network: Network, account: u32) -> String {
    format!("m/86'/{}'/{}'", network.coin_type(), account)
}
pub fn confirm_account(
    comm: &mut Comm,
    path: &AccountPath,
    public: &AccountPublic,
) -> Result<(), Error> {
    let derivation = account_path(path.network(), path.account());
    if crate::warnings::unusual_account(path.account()) {
        warning(comm, "Unusual account", &derivation)?;
    }
    let fingerprint = public
        .master_fingerprint
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let fields = [
        Field {
            name: "Network",
            value: path.network().label(),
        },
        Field {
            name: "Account path",
            value: &derivation,
        },
        Field {
            name: "Master fingerprint",
            value: &fingerprint,
        },
        Field {
            name: "Privacy",
            value: "Companion can view all addresses in this account",
        },
    ];
    approved(
        NbglReview::new()
            .titles(
                "Export Pearl account",
                "Watch-only public data",
                "Approve export",
            )
            .show(comm, &fields),
        comm,
    )
}
pub fn confirm_address(
    comm: &mut Comm,
    path: &DerivationPath,
    address: &Address,
) -> Result<(), Error> {
    let derivation = format!(
        "{}/{}/{}",
        account_path(path.network(), path.account()),
        path.branch(),
        path.index()
    );
    if crate::warnings::unusual_account(path.account())
        || crate::warnings::unusual_index(path.index())
    {
        warning(comm, "Unusual address path", &derivation)?;
    }
    let fields = [
        Field {
            name: "Network",
            value: path.network().label(),
        },
        Field {
            name: "Derivation",
            value: &derivation,
        },
        Field {
            name: "Type",
            value: "BIP86 no-script Taproot",
        },
    ];
    approved(
        NbglAddressReview::new()
            .review_title("Verify Pearl address")
            .review_subtitle("Compare the full address")
            .set_tag_value_list(&fields)
            .show(comm, address.as_str()),
        comm,
    )
}
pub fn review(comm: &mut Comm, tx: &ValidatedTransaction) -> Result<(), Error> {
    if crate::warnings::unusual_account(tx.account()) {
        warning(
            comm,
            "Unusual account",
            &account_path(tx.network(), tx.account()),
        )?;
    }
    for input in tx.inputs() {
        if crate::warnings::unusual_index(input.index()) {
            let path = format!(
                "{}/{}/{}",
                account_path(tx.network(), tx.account()),
                input.branch(),
                input.index()
            );
            warning(comm, "Unusual input path", &path)?;
        }
    }
    if let Some(change) = tx.change() {
        if crate::warnings::unusual_index(change.index()) {
            let path = format!(
                "{}/1/{}",
                account_path(tx.network(), tx.account()),
                change.index()
            );
            warning(comm, "Unusual change path", &path)?;
        }
    }
    if crate::warnings::high_fee(tx.transaction().input_total(), tx.fee()) {
        let detail = format!("Fee {} is at least 10% of inputs", amount(tx.fee())?);
        warning(comm, "High transaction fee", &detail)?;
    }
    let send = amount(tx.recipient().amount())?;
    let fee = amount(tx.fee())?;
    let change = match tx.change() {
        Some(output) => amount(output.amount())?,
        None => String::from("None"),
    };
    let change_address = tx.change_address().map_or("None", Address::as_str);
    let change_path = match tx.change() {
        Some(output) => format!(
            "{}/1/{}",
            account_path(tx.network(), tx.account()),
            output.index()
        ),
        None => String::from("None"),
    };
    let account = account_path(tx.network(), tx.account());
    let fields = [
        Field {
            name: "Network",
            value: tx.network().label(),
        },
        Field {
            name: "From account",
            value: &account,
        },
        Field {
            name: "Recipient",
            value: tx.recipient_address().as_str(),
        },
        Field {
            name: "Amount",
            value: &send,
        },
        Field {
            name: "Fee",
            value: &fee,
        },
        Field {
            name: "Change",
            value: &change,
        },
        Field {
            name: "Change address",
            value: change_address,
        },
        Field {
            name: "Change path",
            value: &change_path,
        },
    ];
    // Never call .blind() or .light(): every field is reviewable on-device.
    approved(
        NbglReview::new()
            .titles(
                "Review Pearl transfer",
                "Check address, amount and fee",
                "Sign Pearl transfer",
            )
            .show(comm, &fields),
        comm,
    )
}
