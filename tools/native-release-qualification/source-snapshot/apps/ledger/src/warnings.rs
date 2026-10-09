//! Ledger Bitcoin-style recovery-path and high-fee warning thresholds.
//! These are review warnings; the core's strict cryptographic policy still applies.
pub const MAX_STANDARD_ACCOUNT: u32 = 100;
pub const MAX_STANDARD_INDEX: u32 = 50_000;
pub const fn unusual_account(account: u32) -> bool {
    account > MAX_STANDARD_ACCOUNT
}
pub const fn unusual_index(index: u32) -> bool {
    index > MAX_STANDARD_INDEX
}
pub const fn high_fee(input_total: u64, fee: u64) -> bool {
    // Equivalent to fee*10 >= total without overflowing Pearl's monetary range.
    let threshold = input_total / 10 + if input_total % 10 != 0 { 1 } else { 0 };
    input_total > 100_000 && fee >= threshold
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn account_warning_boundary() {
        assert!(!unusual_account(100));
        assert!(unusual_account(101));
    }
    #[test]
    fn index_warning_boundary() {
        assert!(!unusual_index(50_000));
        assert!(unusual_index(50_001));
    }
    #[test]
    fn low_total_exception() {
        assert!(!high_fee(100_000, 100_000));
        assert!(high_fee(100_001, 10_001));
    }
    #[test]
    fn ceiling_boundary() {
        assert!(!high_fee(100_001, 10_000));
        assert!(high_fee(100_001, 10_001));
        assert!(high_fee(1_000_000, 100_000));
        assert!(!high_fee(1_000_000, 99_999));
    }
    #[test]
    fn pearl_maximum_and_overflow_boundary() {
        let maximum = 2_100_000_000_000_000_000;
        assert!(high_fee(maximum, maximum / 10));
        assert!(!high_fee(maximum, maximum / 10 - 1));
        assert!(high_fee(u64::MAX, u64::MAX));
        assert!(!high_fee(u64::MAX, u64::MAX / 10));
        assert!(high_fee(u64::MAX, u64::MAX / 10 + 1));
    }
}
