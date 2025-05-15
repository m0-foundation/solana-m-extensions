// scaled_ui_ext/src/instructions/set_fee.rs

// external dependencies
use anchor_lang::prelude::*;

// local dependencies
use crate::{
    constants::ONE_HUNDRED_PERCENT_U64,
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct SetFee<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,
}

pub fn handler(ctx: Context<SetFee>, fee_bps: u64) -> Result<()> {
    // Validate that the fee is between 0 and 100
    if fee_bps > ONE_HUNDRED_PERCENT_U64 {
        return err!(ExtError::InvalidParam);
    }

    // Set the new fee
    ctx.accounts.global_account.fee_bps = fee_bps;

    Ok(())
}
