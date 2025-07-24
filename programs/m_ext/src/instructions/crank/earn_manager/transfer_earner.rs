use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{EarnManager, Earner, EARNER_SEED, EARN_MANAGER_SEED},
};

#[derive(Accounts)]
#[instruction(to_earn_manager: Pubkey)]
pub struct TransferEarner<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        constraint = earner_account.earn_manager == signer.key() @ ExtError::NotAuthorized,
        seeds = [EARNER_SEED, earner_account.user_token_account.as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, Earner>,

    #[account(
        constraint = from_earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED, signer.key().as_ref()],
        bump = from_earn_manager_account.bump,
    )]
    pub from_earn_manager_account: Account<'info, EarnManager>,

    #[account(
        constraint = to_earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED, to_earn_manager.as_ref()],
        bump = to_earn_manager_account.bump,
    )]
    pub to_earn_manager_account: Account<'info, EarnManager>,
}

impl TransferEarner<'_> {
    /// This instruction allows the earn manager to transfer an earner to another earn manager.
    /// The earner account is updated to point to the new earn manager.
    /// A use case for this is if one entity is using two earn manager accounts with different fees
    /// and wants to transfer an earner from one to the other based on some condition.

    pub fn handler(ctx: Context<Self>, to_earn_manager: Pubkey) -> Result<()> {
        ctx.accounts.earner_account.earn_manager = to_earn_manager;

        Ok(())
    }
}
