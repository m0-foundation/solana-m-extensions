#![allow(unexpected_cfgs)]

pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

declare_id!("HwH4wB2ihdUM3XQzAcRq6zDdjkYKu6KjCazHHweJhVz6");

#[program]
pub mod ext_swap {
    use super::*;

    pub fn swap(ctx: Context<Swap>, amount: u64) -> Result<()> {
        Swap::handler(ctx, amount)
    }
}
