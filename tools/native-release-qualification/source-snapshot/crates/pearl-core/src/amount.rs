use crate::Error;
use core::fmt;

pub const GRAINS_PER_PRL: u64 = 100_000_000;
pub const MAX_GRAINS: u64 = 2_100_000_000_000_000_000;

/// An exact, bounded atomic amount. Zero is valid for fees, not tx outputs.
#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd)]
pub struct Amount(u64);

impl Amount {
    pub const fn new(grains: u64) -> Result<Self, Error> {
        if grains > MAX_GRAINS {
            Err(Error::InvalidAmount)
        } else {
            Ok(Self(grains))
        }
    }
    pub const fn grains(self) -> u64 {
        self.0
    }
    pub(crate) const fn positive(grains: u64) -> Result<Self, Error> {
        if grains == 0 {
            Err(Error::InvalidAmount)
        } else {
            Self::new(grains)
        }
    }
    pub fn checked_add(self, rhs: Self) -> Result<Self, Error> {
        Self::new(self.0.checked_add(rhs.0).ok_or(Error::InvalidAmount)?)
    }
    pub fn checked_sub(self, rhs: Self) -> Result<Self, Error> {
        Self::new(self.0.checked_sub(rhs.0).ok_or(Error::InvalidAmount)?)
    }
}

/// Always eight decimal places; no rounding or floating-point conversion.
impl fmt::Display for Amount {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "{}.{:08}",
            self.0 / GRAINS_PER_PRL,
            self.0 % GRAINS_PER_PRL
        )
    }
}
