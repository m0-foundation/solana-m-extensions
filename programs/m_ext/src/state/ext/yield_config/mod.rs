use anchor_lang::prelude::{
    borsh::{BorshDeserialize, BorshSerialize},
    *,
};

pub mod custom;
pub mod manual;
pub mod rebasing;

pub use custom::*;
pub use manual::*;
pub use rebasing::*;

#[derive(BorshSerialize, BorshDeserialize, Clone, InitSpace)]
pub enum YieldConfig {
    None,
    Manual(ManualConfig),
    Rebasing(RebasingConfig),
    Custom(CustomConfig),
}
