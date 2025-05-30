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

    pub fn swap<'info>(
        ctx: Context<'_, '_, '_, 'info, Swap<'info>>,
        amount: u64,
        remaining_accounts_split_idx: u8,
    ) -> Result<()> {
        Swap::handler(ctx, amount, remaining_accounts_split_idx as usize)
    }
}
