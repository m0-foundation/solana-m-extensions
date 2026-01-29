use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct AddReplaceAuthority<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
        realloc = ExtGlobalV2::size(
            global_account.wrap_authorities.len(),
            global_account.replace_authorities.len() + 1
        ),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    pub system_program: Program<'info, System>,
}

impl AddReplaceAuthority<'_> {
    // This instruction allows the admin to add a replace authority to the global account.
    // The new replace authority must not already exist in the list.

    pub fn validate(&self, new_replace_authority: Pubkey) -> Result<()> {
        // Validate that the new replace authority is not already in the list
        if self
            .global_account
            .replace_authorities
            .contains(&new_replace_authority)
        {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(new_replace_authority))]
    pub fn handler(ctx: Context<Self>, new_replace_authority: Pubkey) -> Result<()> {
        // Add the new replace authority
        ctx.accounts
            .global_account
            .replace_authorities
            .push(new_replace_authority);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveReplaceAuthority<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    pub system_program: Program<'info, System>,
}

impl RemoveReplaceAuthority<'_> {
    // This instruction allows the admin to remove a replace authority from the global account.
    // The replace authority must exist in the list.

    pub fn validate(&self, replace_authority: Pubkey) -> Result<()> {
        // Validate that the replace authority exists in the list
        if !self
            .global_account
            .replace_authorities
            .contains(&replace_authority)
        {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(replace_authority))]
    pub fn handler(ctx: Context<Self>, replace_authority: Pubkey) -> Result<()> {
        // Remove the specified replace authority
        ctx.accounts
            .global_account
            .replace_authorities
            .retain(|&x| !x.eq(&replace_authority));

        // Reallocate the account to remove the empty space without erasing the other data
        let new_size = ExtGlobalV2::size(
            ctx.accounts.global_account.wrap_authorities.len(),
            ctx.accounts.global_account.replace_authorities.len(),
        );
        ctx.accounts
            .global_account
            .to_account_info()
            .realloc(new_size, false)?;

        // Refund excess lamports to the admin
        let current_lamports = ctx.accounts.global_account.to_account_info().lamports();
        let required_lamports = Rent::get()?.minimum_balance(new_size);
        let excess_lamports = current_lamports.saturating_sub(required_lamports);
        if excess_lamports > 0 {
            **ctx
                .accounts
                .global_account
                .to_account_info()
                .lamports
                .borrow_mut() -= excess_lamports;
            **ctx.accounts.admin.to_account_info().lamports.borrow_mut() += excess_lamports;
        }

        Ok(())
    }
}
