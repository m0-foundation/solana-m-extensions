// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

// local dependencies
use crate::{
    constants::ANCHOR_DISCRIMINATOR_SIZE,
    errors::ExtError,
    state::{EarnManager, Earner, ExtGlobalV2, EARNER_SEED, EARN_MANAGER_SEED, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
#[instruction(user: Pubkey)]
pub struct AddEarner<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        constraint = earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED, signer.key().as_ref()],
        bump = earn_manager_account.bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        token::mint = global_account.ext_mint,
        token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        init,
        payer = signer,
        space = ANCHOR_DISCRIMINATOR_SIZE + Earner::INIT_SPACE,
        seeds = [EARNER_SEED, user_token_account.key().as_ref()],
        bump
    )]
    pub earner_account: Account<'info, Earner>,

    pub system_program: Program<'info, System>,
}

impl AddEarner<'_> {
    /// This instruction allows the earn manager to add a new earner.

    pub fn handler(ctx: Context<Self>, user: Pubkey) -> Result<()> {
        ctx.accounts.earner_account.set_inner(Earner {
            earn_manager: ctx.accounts.signer.key(),
            recipient_token_account: None,
            last_claim_index: ctx.accounts.global_account.yield_config.last_ext_index,
            last_claim_timestamp: ctx.accounts.global_account.yield_config.timestamp,
            bump: ctx.bumps.earner_account,
            user,
            user_token_account: ctx.accounts.user_token_account.key(),
        });

        Ok(())
    }
}
