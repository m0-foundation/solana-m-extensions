use anchor_lang::prelude::*;

#[constant]
pub const CONFIG_SEED: &[u8] = b"config";

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub admin: Pubkey,
    pub m_mint: Pubkey,
    pub m_earn_global_account: Pubkey,
    pub m_token_program: Pubkey,
    pub bump: u8,
}
