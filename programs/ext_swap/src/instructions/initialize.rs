use anchor_lang::prelude::*;

use crate::state::{SwapGlobal, GLOBAL_SEED};

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = SwapGlobal::size(0,0),
        seeds = [GLOBAL_SEED],
        bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,
}

impl InitializeGlobal<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        ctx.accounts.swap_global.set_inner(SwapGlobal {
            bump: ctx.bumps.swap_global,
            admin: ctx.accounts.admin.key(),
            whitelisted_unwrappers: vec![],
            whitelisted_extensions: vec![],
        });

        Ok(())
    }
}
