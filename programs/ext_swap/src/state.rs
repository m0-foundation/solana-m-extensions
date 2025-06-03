use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_SEED: &[u8] = b"global";

#[account]
pub struct SwapGlobal {
    pub bump: u8,
    pub admin: Pubkey,
    pub m_mint: Pubkey,
    pub whitelisted_extensions: Vec<Pubkey>,
}

impl SwapGlobal {
    pub fn size(members_length: usize) -> usize {
        8 + // discriminator
        1 + // bump
        32 + // admin
        32 + // m_mint
        4 + // length of whitelisted_extensions vector
        members_length * 32 // each Pubkey is 32 bytes
    }
}
