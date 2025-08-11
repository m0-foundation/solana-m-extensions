// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

// local dependencies
use crate::{
    constants::ONE_HUNDRED_PERCENT_U64,
    errors::ExtError,
    state::{EarnManager, ExtGlobalV2, EARN_MANAGER_SEED, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct ConfigureEarnManager<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        mut,
        seeds = [EARN_MANAGER_SEED, signer.key().as_ref()],
        bump = earn_manager_account.bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    #[account(token::mint = global_account.ext_mint)]
    pub fee_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

impl ConfigureEarnManager<'_> {
    /// This instruction allows the earn manager to configure their fee_bps and fee token account.
    /// The fee_bps is the basis points charged for the earn distribution.
    /// The fee token account is the account where the fees will be collected.
    /// If the fee_bps is None, it will not be updated.
    /// If the fee token account is None, it will not be updated.

    pub fn handler(ctx: Context<Self>, fee_bps: Option<u64>) -> Result<()> {
        if let Some(fee_bps) = fee_bps {
            // Validate the fee percent is not greater than 100%
            if fee_bps > ONE_HUNDRED_PERCENT_U64 {
                return err!(ExtError::InvalidParam);
            }

            ctx.accounts.earn_manager_account.fee_bps = fee_bps;
        }

        if let Some(fee_token_account) = &ctx.accounts.fee_token_account {
            ctx.accounts.earn_manager_account.fee_token_account = fee_token_account.key();
        }

        Ok(())
    }
}
