// external dependencies
use anchor_lang::prelude::*;

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct SetEarnAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,
}

impl SetEarnAuthority<'_> {
    /// This instruction allows the admin to set a new earn authority.
    /// The earn authority is the public key of the account that will manage the earn distribution.

    pub fn handler(ctx: Context<Self>, new_earn_authority: Pubkey) -> Result<()> {
        ctx.accounts.global_account.yield_config.earn_authority = new_earn_authority;

        Ok(())
    }
}
