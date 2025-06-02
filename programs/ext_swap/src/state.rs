use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_SEED: &[u8] = b"global";

pub const MAX_WHITELISTED_EXTENSIONS: usize = 32;

#[account]
#[derive(InitSpace)]
pub struct SwapGlobal {
    pub bump: u8,
    pub admin: Pubkey,
    pub m_mint: Pubkey,
    pub whitelisted_extensions: [Pubkey; MAX_WHITELISTED_EXTENSIONS],
}
