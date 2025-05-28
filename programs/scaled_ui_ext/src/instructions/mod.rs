pub mod claim_fees;
pub mod initialize;
pub mod set_m_mint;
pub mod unwrap;
pub mod update_wrap_authority;
pub mod wrap;

pub use claim_fees::*;
pub use initialize::*;
pub use set_m_mint::*;
pub use unwrap::*;
pub use update_wrap_authority::*;
pub use wrap::*;

cfg_if::cfg_if!(
    if #[cfg(feature = "scaled-ui")] {
        pub mod set_fee;
        pub mod sync;

        pub use set_fee::*;
        pub use sync::*;
    }
);
