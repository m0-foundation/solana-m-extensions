use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_SEED: &[u8] = b"global";

#[account]
pub struct SwapGlobal {
    pub bump: u8,
    pub admin: Pubkey,
    pub whitelisted_unwrappers: Vec<Pubkey>,
    pub whitelisted_extensions: Vec<Pubkey>,
}

impl SwapGlobal {
    pub fn size(unwrappers: usize, extensions: usize) -> usize {
        8 + // discriminator
        1 + // bump
        32 + // admin
        4 + // length of whitelisted_unwrappers vector
        unwrappers * 32 + // each Pubkey is 32 bytes
        4 + // length of whitelisted_extensions vector
        extensions * 32 // each Pubkey is 32 bytes
    }
}
