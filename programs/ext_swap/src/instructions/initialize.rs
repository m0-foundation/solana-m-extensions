use anchor_lang::prelude::*;

use crate::state::{Global, GLOBAL_SEED, MAX_WHITELISTED_EXTENSIONS};

#[derive(Accounts)]
pub struct InitializeGlobal<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        init,
        payer = admin,
        space = 8 + Global::INIT_SPACE,
        seeds = [GLOBAL_SEED],
        bump,
    )]
    pub swap_global: Account<'info, Global>,

    pub system_program: Program<'info, System>,
}

impl InitializeGlobal<'_> {
    pub fn handler(ctx: Context<Self>, m_mint: Pubkey) -> Result<()> {
        ctx.accounts.swap_global.set_inner(Global {
            bump: ctx.bumps.swap_global,
            admin: ctx.accounts.admin.key(),
            m_mint: m_mint,
            whitelisted_extensions: [Pubkey::default(); MAX_WHITELISTED_EXTENSIONS],
        });

        Ok(())
    }
}
