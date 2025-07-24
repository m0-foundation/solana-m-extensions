// external dependencies
use anchor_lang::prelude::*;

// local dependencies
use crate::{
    errors::ExtError,
    state::{EarnManager, Earner, EARNER_SEED, EARN_MANAGER_SEED},
};

#[derive(Accounts)]
pub struct RemoveEarner<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        mut,
        close = signer,
        constraint = earner_account.earn_manager == signer.key() @ ExtError::NotAuthorized,
        seeds = [EARNER_SEED, earner_account.user_token_account.as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, Earner>,

    #[account(
        constraint = earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED, signer.key().as_ref()],
        bump = earn_manager_account.bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    pub system_program: Program<'info, System>,
}

impl RemoveEarner<'_> {
    /// This instruction allows the earn manager to remove an earner.
    /// The earner account is closed and the lamport balance is recovered.

    pub fn handler(_ctx: Context<Self>) -> Result<()> {
        Ok(())
    }
}
