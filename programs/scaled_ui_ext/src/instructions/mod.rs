pub mod initialize;
pub mod set_m_mint;
pub mod sync;
pub mod wrap;
pub mod unwrap;

pub use initialize::Initialize;
pub(crate) use initialize::__client_accounts_initialize;
pub use set_m_mint::SetMMint;
pub(crate) use set_m_mint::__client_accounts_set_m_mint;
pub use sync::Sync;
pub(crate) use sync::__client_accounts_sync;
pub use wrap::Wrap;
pub(crate) use wrap::__client_accounts_wrap;
pub use unwrap::Unwrap;
pub(crate) use unwrap::__client_accounts_unwrap;

cfg_if::cfg_if! {
    if #[cfg(feature = "cpi")] {
        pub(crate) use initialize::__cpi_client_accounts_initialize;
        pub(crate) use set_m_mint::__cpi_client_accounts_set_m_mint;
        pub(crate) use sync::__cpi_client_accounts_sync;
        pub(crate) use wrap::__cpi_client_accounts_wrap;
        pub(crate) use unwrap::__cpi_client_accounts_unwrap;
    }
}