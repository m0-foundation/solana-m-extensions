use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

#[constant]
pub const EARNER_SEED_PREFIX: &[u8] = b"earner";

#[account]
#[derive(InitSpace)]
pub struct Earner {
    pub user: Pubkey,
    pub user_token_account: Pubkey,
    pub earn_manager: Pubkey,
    pub earner_type: EarnerType,
    pub bump: u8,
    pub recipient_token_account: Option<Pubkey>,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub enum EarnerType {
    Crank(EarnerCrank),
    MerkleClaims(EarnerMerkleClaims),
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct EarnerCrank {
    pub last_claim_index: u64,
    pub last_claim_timestamp: u64,
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct EarnerMerkleClaims {
    pub claimed_amount: u128,
    pub claim_delegate: Option<Pubkey>,
}
