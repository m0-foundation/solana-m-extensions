use anchor_lang::prelude::*;

#[constant]
pub const EXT_CONFIG_SEED_PREFIX: &[u8] = b"ext_config";

#[account]
#[derive(InitSpace)]
pub struct ExtConfig {
    pub ext_authority: Pubkey,
    pub ext_mint: Pubkey,
    pub ext_program: Pubkey,
    pub bump: u8,
    pub m_vault_bump: u8,
}
