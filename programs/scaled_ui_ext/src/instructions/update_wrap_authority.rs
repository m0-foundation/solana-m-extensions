use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct UpdateWrapAuthority<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,
}

impl UpdateWrapAuthority<'_> {
    // This instruction allows the admin to update the wrap authority at a specific index
    // in the global account's wrap authorities list.
    // The new wrap authority must not already exist in the list (unless it's the system program).
    // The index must be within bounds of the current wrap authorities.

    pub fn validate(&self, index: u8, new_wrap_authority: Pubkey) -> Result<()> {
        // Validate that the new wrap authority is not already in the list (if not the system program)
        if new_wrap_authority != Pubkey::default()
            && self
                .global_account
                .wrap_authorities
                .contains(&new_wrap_authority)
        {
            return err!(ExtError::InvalidParam);
        }

        // Validate that the index is within bounds
        if index as usize >= self.global_account.wrap_authorities.len() {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(index, new_wrap_authority))]
    pub fn handler(ctx: Context<Self>, index: u8, new_wrap_authority: Pubkey) -> Result<()> {
        // Update the wrap authority at the specified index
        ctx.accounts.global_account.wrap_authorities[index as usize] = new_wrap_authority;

        Ok(())
    }
}
