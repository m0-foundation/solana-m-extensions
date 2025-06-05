use anchor_lang::prelude::*;

#[constant]
pub const EXT_GLOBAL_SEED: &[u8] = b"global";

#[account]
#[derive(InitSpace)]
pub struct ExtGlobal {
    pub admin: Pubkey,                 // can update config values
    pub ext_mint: Pubkey,              // m extension mint
    pub m_mint: Pubkey,                // m mint
    pub m_earn_global_account: Pubkey, // m earn global account
    pub bump: u8,
    pub m_vault_bump: u8,
    pub ext_mint_authority_bump: u8,
    pub fee_bps: u64,                   // fee in basis points
    pub accrued_fee_principal: u64,     // accrued fee principal
    pub wrap_authorities: [Pubkey; 10], // wrap authorities
}

#[constant]
pub const MINT_AUTHORITY_SEED: &[u8] = b"mint_authority";

#[constant]
pub const M_VAULT_SEED: &[u8] = b"m_vault";
