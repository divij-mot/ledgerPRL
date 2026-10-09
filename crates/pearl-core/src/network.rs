use crate::Error;
pub const HARDENED: u32 = 0x8000_0000;

/// Full network identity. Equal address HRPs do not imply equal networks.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
#[repr(u8)]
pub enum Network {
    Mainnet = 0,
    Testnet = 1,
    Testnet2 = 2,
    Regtest = 3,
    Simnet = 4,
}
impl Network {
    pub const fn from_byte(value: u8) -> Result<Self, Error> {
        match value {
            0 => Ok(Self::Mainnet),
            1 => Ok(Self::Testnet),
            2 => Ok(Self::Testnet2),
            3 => Ok(Self::Regtest),
            4 => Ok(Self::Simnet),
            _ => Err(Error::InvalidNetwork),
        }
    }
    pub const fn hrp(self) -> &'static str {
        match self {
            Self::Mainnet => "prl",
            Self::Testnet | Self::Testnet2 => "tprl",
            Self::Regtest | Self::Simnet => "rprl",
        }
    }
    pub const fn label(self) -> &'static str {
        match self {
            Self::Mainnet => "Pearl mainnet",
            Self::Testnet => "Pearl testnet",
            Self::Testnet2 => "Pearl testnet2",
            Self::Regtest => "Pearl regtest",
            Self::Simnet => "Pearl simnet",
        }
    }
    pub const fn coin_type(self) -> u32 {
        match self {
            Self::Mainnet => 808_276,
            _ => 1,
        }
    }
}

/// An approved account-level BIP86 path, never a root/parent/purpose-222 path.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct AccountPath {
    network: Network,
    account: u32,
}
impl AccountPath {
    pub const fn new(network: Network, account: u32) -> Result<Self, Error> {
        if account >= HARDENED {
            Err(Error::InvalidPath)
        } else {
            Ok(Self { network, account })
        }
    }
    pub const fn network(self) -> Network {
        self.network
    }
    pub const fn account(self) -> u32 {
        self.account
    }
    pub const fn components(self) -> [u32; 3] {
        [
            86 | HARDENED,
            self.network.coin_type() | HARDENED,
            self.account | HARDENED,
        ]
    }
}

/// Exactly m/86'/coin'/account'/branch/index; the final two components are public.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct DerivationPath {
    account: AccountPath,
    branch: u8,
    index: u32,
}
impl DerivationPath {
    pub const fn new(
        network: Network,
        account: u32,
        branch: u8,
        index: u32,
    ) -> Result<Self, Error> {
        if account >= HARDENED || branch > 1 || index >= HARDENED {
            return Err(Error::InvalidPath);
        }
        Ok(Self {
            account: AccountPath { network, account },
            branch,
            index,
        })
    }
    pub const fn network(self) -> Network {
        self.account.network
    }
    pub const fn account(self) -> u32 {
        self.account.account
    }
    pub const fn branch(self) -> u8 {
        self.branch
    }
    pub const fn index(self) -> u32 {
        self.index
    }
    pub const fn components(self) -> [u32; 5] {
        let p = self.account.components();
        [p[0], p[1], p[2], self.branch as u32, self.index]
    }
}
