#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;

declare_id!("C3LwTx2xTzXooN3rNbbuTkA2KJD3Un34SHcmm1E3rmKz");

#[program]
pub mod psm {
    use super::*;

    pub fn initialize_global(ctx: Context<InitializeGlobal>) -> Result<()> {
        InitializeGlobal::handler(ctx)
    }

    pub fn initialize_pool(ctx: Context<InitializePool>, trade_fee_bps: u16) -> Result<()> {
        InitializePool::handler(ctx, trade_fee_bps)
    }

    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        Deposit::handler(ctx, amount)
    }

    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        Withdraw::handler(ctx, amount)
    }

    pub fn swap(ctx: Context<Swap>, amount: u64) -> Result<()> {
        Swap::handler(ctx, amount)
    }
}
