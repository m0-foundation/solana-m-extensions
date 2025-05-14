use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

pub mod crank;
pub mod custom;
pub mod merkle_claims;
pub mod rebasing;

pub use crank::*;
pub use custom::*;
pub use merkle_claims::*;
pub use rebasing::*;

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub enum YieldConfig {
    None,
    Crank(CrankConfig),
    MerkleClaims(MerkleClaimsConfig),
    Rebasing(RebasingConfig),
    Custom(CustomConfig),
}
