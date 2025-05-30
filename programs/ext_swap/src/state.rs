use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub bump: u8,
    pub admin: Pubkey,
    pub m_mint: Pubkey,
    pub whitelisted_extensions: [Pubkey; 20],
}
