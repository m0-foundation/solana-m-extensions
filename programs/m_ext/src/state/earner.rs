use anchor_lang::prelude::*;

#[constant]
pub const EARNER_SEED_PREFIX: &[u8] = b"earner";

#[account]
#[derive(InitSpace)]
pub struct Earner {
    pub last_claim_index: u64,
    pub last_claim_timestamp: u64,
    pub bump: u8,
    pub user: Pubkey,
    pub user_token_account: Pubkey,
    pub earn_manager: Pubkey,
    pub recipient_token_account: Option<Pubkey>,
}
