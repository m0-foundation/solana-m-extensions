use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
    utils::quote::{Op, Quoter},
};

#[derive(Accounts)]
pub struct Quote<'info> {
    pub m_mint: InterfaceAccount<'info, Mint>,

    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidAccount,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobal>,
}

impl Quote<'_> {
    pub fn handler(
        ctx: Context<Self>,
        operation: Op,
        principal: u64,
        exact_out: bool,
    ) -> Result<u64> {
        // Setup the quoter
        let quoter = Quoter::new(&ctx.accounts.global_account, &ctx.accounts.m_mint);

        // Get and return the quote
        Ok(quoter.quote(operation, principal, exact_out)?)
    }
}
