pub const ANCHOR_DISCRIMINATOR_SIZE: usize = 8;

pub const INDEX_SCALE_F64: f64 = 1e12f64;
pub const INDEX_SCALE_U64: u64 = 1_000_000_000_000u64;

pub const ONE_HUNDRED_PERCENT_U64: u64 = 100_00u64;
pub const ONE_HUNDRED_PERCENT_F64: f64 = 1e4f64;

cfg_if::cfg_if! {
    if #[cfg(feature = "ibt")] {
        pub const ONE_IN_BASIS_POINTS: f64 = 10_000.;
        pub const SECONDS_PER_YEAR: f64 = 60. * 60. * 24. * 365.24;
    }
}
