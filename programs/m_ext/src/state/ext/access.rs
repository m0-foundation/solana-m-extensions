use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub enum AccessConfig {
    Open,
    Finite(FiniteConfig),
    // Restricted, TODO mapping style whitelist?
}

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub struct FiniteConfig {
    pub wrap_authorities: [Pubkey; 10],
}
