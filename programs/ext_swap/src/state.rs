use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_SEED: &[u8] = b"global";

#[account]
#[derive(InitSpace)]
pub struct Global {
    pub bump: u8,
    pub admin: Pubkey,
    pub m_mint: Pubkey,
    pub whitelisted_extensions: [Pubkey; 20],
}
