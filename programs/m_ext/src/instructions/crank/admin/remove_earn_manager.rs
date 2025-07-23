// ext_earn/instructions/admin/remove_earn_manager.rs

use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{EarnManager, ExtGlobalV2, EARN_MANAGER_SEED, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct RemoveEarnManager<'info> {
    pub admin: Signer<'info>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        mut,
        seeds = [EARN_MANAGER_SEED, earn_manager_account.earn_manager.as_ref()],
        bump = earn_manager_account.bump,
    )]
    pub earn_manager_account: Account<'info, EarnManager>,
}

impl RemoveEarnManager<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // We set the is_active flag to false instead of closing the account to avoid issues
        // with earner instructions which require the earn manager account
        ctx.accounts.earn_manager_account.is_active = false;

        Ok(())
    }
}
