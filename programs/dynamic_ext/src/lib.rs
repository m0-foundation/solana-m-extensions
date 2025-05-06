#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub use instructions::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("4yXxi6sRvWpYUUUx3CTnVKuKLYegooLoNakrePLLVoV4");

#[program]
pub mod dynamic_ext {
    use super::*;

    // Admin instructions

    pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        instructions::initialize::Initialize::handler(ctx, wrap_authorities)
    }

    // Wrap authority instructions

    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        instructions::wrap::Wrap::handler(ctx, amount)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        instructions::unwrap::Unwrap::handler(ctx, amount)
    }

    // Open instructions

    pub fn sync_multiplier(ctx: Context<SyncMultiplier>) -> Result<()> {
        instructions::sync::SyncMultiplier::handler(ctx)
    }
}
