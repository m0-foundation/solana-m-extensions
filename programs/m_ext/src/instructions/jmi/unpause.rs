use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct Unpause<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,
}

impl Unpause<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        ctx.accounts.global_account.yield_config.is_paused = false;
        Ok(())
    }
}
