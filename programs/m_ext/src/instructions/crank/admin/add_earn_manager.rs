use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    constants::{ANCHOR_DISCRIMINATOR_SIZE, ONE_HUNDRED_PERCENT_U64},
    errors::ExtError,
    state::{EarnManager, ExtGlobalV2, EARN_MANAGER_SEED, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
#[instruction(earn_manager: Pubkey)]
pub struct AddEarnManager<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        init_if_needed,
        payer = admin,
        space = ANCHOR_DISCRIMINATOR_SIZE + EarnManager::INIT_SPACE,
        seeds = [EARN_MANAGER_SEED, earn_manager.as_ref()],
        bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    #[account(token::mint = global_account.ext_mint)]
    pub fee_token_account: InterfaceAccount<'info, TokenAccount>,

    pub system_program: Program<'info, System>,
}

impl AddEarnManager<'_> {
    /// This instruction allows the admin to add a new earn manager.
    /// The earn manager is identified by its public key and must be unique.
    /// The fee_bps is the fee in basis points that the earn manager will charge.
    /// It must be between 0 and 10000 bps (inclusive).

    fn validate(&self, fee_bps: u64) -> Result<()> {
        // Validate that the fee is between 0 and 10000 bps
        if fee_bps > ONE_HUNDRED_PERCENT_U64 {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(fee_bps))]
    pub fn handler(ctx: Context<Self>, earn_manager: Pubkey, fee_bps: u64) -> Result<()> {
        ctx.accounts.earn_manager_account.set_inner(EarnManager {
            earn_manager,
            is_active: true,
            fee_bps,
            fee_token_account: ctx.accounts.fee_token_account.key(),
            bump: ctx.bumps.earn_manager_account,
        });

        Ok(())
    }
}
