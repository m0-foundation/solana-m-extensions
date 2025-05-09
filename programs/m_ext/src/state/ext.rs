use anchor_lang::prelude::*;

#[constant]
pub const EXT_GLOBAL_SEED_PREFIX: &[u8] = b"global";

#[account]
#[derive(InitSpace)]
pub struct ExtGlobal {
    pub ext_admin: Pubkey,
    pub ext_mint: Pubkey,
    pub bump: u8,
    pub m_vault_bump: u8,
    pub ext_mint_authority_bump: u8,
    pub ext_yield: ExtYield,
    pub ext_access: ExtAccess,
}

pub enum ExtYield {
    None,
    PermissionedCrank(ExtCrank),
    // TODO MerkleClaims(ExtMerkleClaims), // i.e. Jito tip style
    Rebasing(ExtRebasing), // TODO do we need ScaledUiAmount and IBT? is it useful to have both? Can we handle both in one?
}

// TODO what about fee tiers? would probably require multiple indices
// better to have multiple extensions for multiple fee tiers?

pub struct ExtRebasing {
    pub fee_bps: u64,
    pub last_m_index: u64,
    pub last_ext_index: u64,
}

pub struct ExtCrank {
    pub earn_authority: Pubkey,
    pub fee_bps: u64,
    pub last_m_index: u64,
    pub last_ext_index: u64,
    pub timestamp: u64,
}

pub enum ExtAccess {
    Open,
    Finite(ExtFinite),
    // Restricted, TODO mapping style whitelist?
}

pub struct ExtFinite {
    pub wrap_authorities: [Pubkey; 10],
}
