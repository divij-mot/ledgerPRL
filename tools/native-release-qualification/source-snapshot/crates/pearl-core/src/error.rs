/// Fail-closed policy/transport result. Every APDU error destroys the session.
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Error {
    WrongLength,
    UserRejected,
    WrongState,
    InvalidData,
    InvalidNetwork,
    InvalidPath,
    InvalidAmount,
    DuplicateOutpoint,
    OwnershipMismatch,
    HashMismatch,
    WrongParameters,
    UnsupportedInstruction,
    UnsupportedClass,
    Crypto,
}

impl Error {
    pub const fn status_word(self) -> u16 {
        match self {
            Self::WrongLength => 0x6700,
            Self::UserRejected => 0x6985,
            Self::WrongState => 0x6986,
            Self::WrongParameters => 0x6b00,
            Self::UnsupportedInstruction => 0x6d00,
            Self::UnsupportedClass => 0x6e00,
            Self::Crypto => 0x6f00,
            _ => 0x6a80,
        }
    }
}
