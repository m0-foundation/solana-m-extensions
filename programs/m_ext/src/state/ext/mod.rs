use anchor_lang::prelude::*;

pub mod access;
pub mod yield_config;

pub use access::*;
pub use yield_config::*;

#[constant]
pub const EXT_CONFIG_SEED_PREFIX: &[u8] = b"ext_config";

#[account]
#[derive(InitSpace)]
pub struct ExtConfig {
    pub ext_authority: Pubkey,
    pub ext_mint: Pubkey,
    pub ext_token_program: Pubkey,
    pub bump: u8,
    pub m_vault_bump: u8,
    pub ext_mint_authority_bump: u8,
    pub yield_config: YieldConfig,
    pub access_config: AccessConfig,
}
