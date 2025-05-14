pub mod config;
pub mod earner;
pub mod ext;

pub use config::*;
pub use earner::*;
pub use ext::*;

use anchor_lang::prelude::*;

#[constant]
pub const M_VAULT_SEED_PREFIX: &[u8] = b"m_vault";

#[constant]
pub const MINT_AUTHORITY_SEED_PREFIX: &[u8] = b"mint_authority";
