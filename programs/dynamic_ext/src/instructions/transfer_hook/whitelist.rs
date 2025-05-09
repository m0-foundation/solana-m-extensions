use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct AddToWhiteList<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    /// CHECK: New account to add to white list
    #[account()]
    pub new_account: AccountInfo<'info>,

    #[account(
        mut,
        seeds = [b"whitelist"],
        bump
    )]
    pub whitelist: Account<'info, WhiteList>,
}

impl AddToWhiteList<'_> {
    fn validate(&self, index: u8, new_whitelist_entry: Pubkey) -> Result<()> {
        // Validate that the new wrap authority is not already in the list (if not the system program)
        if new_whitelist_entry != Pubkey::default()
            && self.whitelist.keys.contains(&new_whitelist_entry)
        {
            msg!("New whitelist entry already in the list");
            return err!(ExtError::InvalidParam);
        }

        // Validate that the index is within bounds
        if index as usize >= self.whitelist.keys.len() {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(index, new_whitelist_entry))]
    pub fn handler(
        ctx: Context<AddToWhiteList>,
        index: u8,
        new_whitelist_entry: Pubkey,
    ) -> Result<()> {
        ctx.accounts.whitelist.keys[index as usize] = new_whitelist_entry;

        Ok(())
    }
}

#[account]
#[derive(InitSpace)]
pub struct WhiteList {
    pub keys: [Pubkey; 64],
}
