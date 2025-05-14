use anchor_lang::prelude::*;

pub mod core_config;
pub mod ext_config;

pub use core_config::*;
pub use ext_config::*;

#[constant]
pub const MINT_AUTHORITY_SEED_PREFIX: &[u8] = b"mint_authority";

#[constant]
pub const M_VAULT_SEED_PREFIX: &[u8] = b"m_vault";
