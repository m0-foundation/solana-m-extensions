use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct CrankConfig {
    pub earn_authority: Pubkey,
    pub fee_bps: u64, // TODO move this to earn manager to allow multiple fee tiers
    pub last_m_index: u64,
    pub last_ext_index: u64,
    pub timestamp: u64,
}
