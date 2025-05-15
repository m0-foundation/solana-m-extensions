use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct MerkleClaimsConfig {
    pub earn_authority: Pubkey,
    pub merkle_root: [u8; 32],
    pub last_m_index: u64,
    pub last_ext_index: u64,
    pub last_timestamp: u64,
}
