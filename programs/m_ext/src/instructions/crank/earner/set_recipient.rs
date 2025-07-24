use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

use crate::{
    errors::ExtError,
    state::{Earner, ExtGlobalV2, EARNER_SEED, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct SetRecipient<'info> {
    #[account(
        constraint =
            signer.key() == earner_account.user ||
            signer.key() == earner_account.earn_manager
            @ ExtError::NotAuthorized,
    )]
    pub signer: Signer<'info>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        mut,
        seeds = [EARNER_SEED, &earner_account.user_token_account.as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, Earner>,

    #[account(token::mint = global_account.ext_mint)]
    pub recipient_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

impl SetRecipient<'_> {
    /// This instruction allows the earner to set their recipient token account.
    /// The recipient token account is the account where the earn rewards will be sent.
    /// If the recipient token account is None, it will default to the user's token account.

    pub fn handler(ctx: Context<Self>) -> Result<()> {
        ctx.accounts.earner_account.recipient_token_account =
            if let Some(token_account) = &ctx.accounts.recipient_token_account {
                Some(token_account.key())
            } else {
                None
            };

        Ok(())
    }
}
