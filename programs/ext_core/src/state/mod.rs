use anchor_lang::prelude::*;

pub mod core_config;
pub mod ext_config;

pub use core_config::*;
pub use ext_config::*;

#[constant]
pub const M_VAULT_SEED_PREFIX: &[u8] = b"m_vault";
