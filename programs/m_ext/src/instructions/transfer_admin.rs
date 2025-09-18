use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct TransferAdmin<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,
}

impl TransferAdmin<'_> {
    /// This instruction allows the admin to propose a new admin for the global account.
    /// The new admin must accept the transfer before it takes effect.
    /// This is the first step of a two-step admin transfer process.

    pub fn validate(&self, new_admin: Pubkey) -> Result<()> {
        // Validate that the new admin is different from the current admin
        if new_admin == self.global_account.admin {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(new_admin))]
    pub fn handler(ctx: Context<Self>, new_admin: Pubkey) -> Result<()> {
        // Set the pending admin
        ctx.accounts.global_account.pending_admin = Some(new_admin);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct AcceptAdmin<'info> {
    pub pending_admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        constraint = global_account.pending_admin == Some(pending_admin.key()) @ ExtError::NotAuthorized,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,
}

impl AcceptAdmin<'_> {
    /// This instruction allows the pending admin to accept the admin transfer.
    /// This is the second step of a two-step admin transfer process.
    /// After accepting, the pending admin becomes the new admin.

    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Transfer admin ownership
        ctx.accounts.global_account.admin = ctx.accounts.pending_admin.key();

        // Clear the pending admin
        ctx.accounts.global_account.pending_admin = None;

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RevokeAdminTransfer<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,
}

impl RevokeAdminTransfer<'_> {
    /// This instruction allows the current admin to revoke a pending admin transfer.
    /// This can only be called if there is a pending admin transfer in progress.

    pub fn validate(&self) -> Result<()> {
        // Validate that there is a pending admin transfer to revoke
        if self.global_account.pending_admin.is_none() {
            return err!(ExtError::InvalidParam);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Clear the pending admin
        ctx.accounts.global_account.pending_admin = None;

        Ok(())
    }
}
