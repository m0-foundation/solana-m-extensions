use anchor_lang::prelude::*;

#[constant]
pub const GLOBAL_SEED: &[u8] = b"global";

#[account]
pub struct SwapGlobal {
    pub bump: u8,
    pub admin: Pubkey,
    pub whitelisted_unwrappers: Vec<Pubkey>,
    pub whitelisted_extensions: Vec<WhitelistedExtension>,
}

impl SwapGlobal {
    pub fn size(unwrappers: usize, extensions: usize) -> usize {
        8 + // discriminator
        1 + // bump
        32 + // admin
        4 + // length of whitelisted_unwrappers vector
        unwrappers * 32 + // each Pubkey is 32 bytes
        4 + // length of whitelisted_extensions vector
        extensions * 64 // program_id + mint
    }

    pub fn is_extension_whitelisted(&self, program_id: &Pubkey) -> bool {
        self.whitelisted_extensions
            .iter()
            .any(|ext| ext.program_id.eq(program_id))
    }
}

#[account]
pub struct WhitelistedExtension {
    pub program_id: Pubkey,
    pub mint: Pubkey,
}
