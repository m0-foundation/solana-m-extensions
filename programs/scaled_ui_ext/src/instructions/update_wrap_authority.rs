// scaled_ui_ext/instructions/update_wrap_authority.rs

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

pub fn handler(
    ctx: Context<UpdateWrapAuthority>,
    index: u8,
    new_wrap_authority: Pubkey,
) -> Result<()> {
    let global_account = &mut ctx.accounts.global_account;

    // Validate that the new wrap authority is not already in the list (if not the system program)
    if new_wrap_authority != Pubkey::default()
        && global_account
            .wrap_authorities
            .contains(&new_wrap_authority)
    {
        return err!(ExtError::InvalidParam);
    }

    // Validate that the index is within bounds
    if index as usize >= global_account.wrap_authorities.len() {
        return err!(ExtError::InvalidParam);
    }

    // Update the wrap authority at the specified index
    global_account.wrap_authorities[index as usize] = new_wrap_authority;

    Ok(())
}
