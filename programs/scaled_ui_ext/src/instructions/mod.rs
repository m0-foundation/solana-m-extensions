// scaled_ui_ext/src/instructions/mod.rs

pub mod claim_fees;
pub mod initialize;
pub mod set_fee;
pub mod set_m_mint;
pub mod sync;
pub mod unwrap;
pub mod update_wrap_authority;
pub mod wrap;

pub use claim_fees::ClaimFees;
pub(crate) use claim_fees::__client_accounts_claim_fees;
pub use initialize::Initialize;
pub(crate) use initialize::__client_accounts_initialize;
pub use set_fee::SetFee;
pub(crate) use set_fee::__client_accounts_set_fee;
pub use set_m_mint::SetMMint;
pub(crate) use set_m_mint::__client_accounts_set_m_mint;
pub use sync::Sync;
pub(crate) use sync::__client_accounts_sync;
pub use unwrap::Unwrap;
pub(crate) use unwrap::__client_accounts_unwrap;
pub use update_wrap_authority::UpdateWrapAuthority;
pub(crate) use update_wrap_authority::__client_accounts_update_wrap_authority;
pub use wrap::Wrap;
pub(crate) use wrap::__client_accounts_wrap;

cfg_if::cfg_if! {
    if #[cfg(feature = "cpi")] {
        pub(crate) use claim_fees::__cpi_client_accounts_claim_fees;
        pub(crate) use initialize::__cpi_client_accounts_initialize;
        pub(crate) use set_fee::__cpi_client_accounts_set_fee;
        pub(crate) use set_m_mint::__cpi_client_accounts_set_m_mint;
        pub(crate) use sync::__cpi_client_accounts_sync;
        pub(crate) use wrap::__cpi_client_accounts_wrap;
        pub(crate) use unwrap::__cpi_client_accounts_unwrap;
        pub(crate) use update_wrap_authority::__cpi_client_accounts_update_wrap_authority;
    }
}
