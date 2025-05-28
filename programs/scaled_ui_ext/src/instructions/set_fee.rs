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

impl SetFee<'_> {
    // This instruction allows the admin to set a new fee in basis points (bps).
    // The fee must be between 0 and 100 bps (inclusive).
    // If the fee is set to 0, it effectively disables the fee.
    // If the fee is set to 100, it means the entire amount is taken as a fee.
    // Any value above 100 bps will result in an error.

    fn validate(&self, fee_bps: u64) -> Result<()> {
        // Validate that the fee is between 0 and 100 bps
        if fee_bps > ONE_HUNDRED_PERCENT_U64 {
            return err!(ExtError::InvalidParam);
        }
        Ok(())
    }

    #[access_control(ctx.accounts.validate(fee_bps))]
    pub fn handler(ctx: Context<Self>, fee_bps: u64) -> Result<()> {
        // Set the new fee
        ctx.accounts.global_account.fee_bps = fee_bps;

        Ok(())
    }
}
