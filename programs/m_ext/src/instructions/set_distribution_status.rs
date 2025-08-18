use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED},
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct SetDistributionStatus<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,
}

impl SetDistributionStatus<'_> {
    pub fn handler(ctx: Context<Self>, distribute: bool) -> Result<()> {
        ctx.accounts.global_account.distribute = distribute;

        Ok(())
    }
}
