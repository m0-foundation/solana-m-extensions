use anchor_lang::prelude::*;

use crate::errors::SwapError;

#[constant]
pub const GLOBAL_SEED: &[u8] = b"global";
#[constant]
pub const GROUP_SEED: &[u8] = b"group";

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
        extensions * 96 // program_id + mint + token_program
    }

    pub fn is_extension_whitelisted(&self, program_id: &Pubkey) -> bool {
        self.whitelisted_extensions
            .iter()
            .any(|ext| ext.program_id.eq(program_id))
    }

    pub fn get_extension(&self, program_id: &Pubkey) -> Result<WhitelistedExtension> {
        self.whitelisted_extensions
            .iter()
            .find(|ext| ext.program_id.eq(program_id))
            .cloned()
            .ok_or_else(|| error!(SwapError::InvalidExtension))
    }
}

#[account]
pub struct WhitelistedExtension {
    pub program_id: Pubkey,
    pub mint: Pubkey,
    pub token_program: Pubkey,
    pub group_key: Pubkey,
}

#[account]
pub struct ExtensionGroup {
    pub name: [u8; 16],
    pub valid_bridge_destinations: Vec<[u8; 32]>,
}

impl ExtensionGroup {
    pub fn size(destinations: usize) -> usize {
        8 + // discriminator
        16 + // name
        4 + // length of valid_bridge_destinations vector
        destinations * 32 // each destination is 32 bytes
    }
}
