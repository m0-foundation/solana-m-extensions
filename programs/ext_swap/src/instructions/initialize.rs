use anchor_lang::prelude::*;

use crate::state::{SwapGlobal, GLOBAL_SEED};

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = SwapGlobal::size(0),
        seeds = [GLOBAL_SEED],
        bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,
}

impl InitializeGlobal<'_> {
    pub fn handler(ctx: Context<Self>, m_mint: Pubkey) -> Result<()> {
        ctx.accounts.swap_global.set_inner(SwapGlobal {
            bump: ctx.bumps.swap_global,
            admin: ctx.accounts.admin.key(),
            m_mint: m_mint,
            whitelisted_extensions: vec![],
        });

        Ok(())
    }
}
