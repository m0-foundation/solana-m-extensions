use anchor_lang::prelude::*;

use crate::{
    errors::SwapError,
    state::{SwapGlobal, GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct WhitelistExt<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        realloc = SwapGlobal::size(
            swap_global.whitelisted_unwrappers.len(),
            swap_global.whitelisted_extensions.len() + 1,
        ),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,

    /// CHECK: This account is validated in the `validate` function
    pub ext_program: AccountInfo<'info>,
}

impl WhitelistExt<'_> {
    fn validate(&self) -> Result<()> {
        // Check if the extension program is already whitelisted
        if self
            .swap_global
            .whitelisted_extensions
            .contains(self.ext_program.key)
        {
            return err!(SwapError::AlreadyWhitelisted);
        }

        // Check that the extension program is a valid program
        if !self.ext_program.executable {
            return err!(SwapError::InvalidExtension);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_extensions
            .push(*ctx.accounts.ext_program.key);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct WhitelistUnwrapper<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        realloc = SwapGlobal::size(
            swap_global.whitelisted_unwrappers.len() + 1,
            swap_global.whitelisted_extensions.len() ,
        ),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,
}

impl WhitelistUnwrapper<'_> {
    fn validate(&self, authority: &Pubkey) -> Result<()> {
        if self.swap_global.whitelisted_unwrappers.contains(authority) {
            return err!(SwapError::AlreadyWhitelisted);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&authority))]
    pub fn handler(ctx: Context<Self>, authority: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_unwrappers
            .push(authority);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveWhitelistedExt<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,
}

impl RemoveWhitelistedExt<'_> {
    fn validate(&self, ext_program: &Pubkey) -> Result<()> {
        if !self
            .swap_global
            .whitelisted_extensions
            .contains(ext_program)
        {
            return err!(SwapError::InvalidExtension);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ext_program))]
    pub fn handler(ctx: Context<Self>, ext_program: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_extensions
            .retain(|&x| !x.eq(&ext_program));

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveWhitelistedUnwrapper<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        has_one = admin @ SwapError::NotAuthorized,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
    )]
    pub swap_global: Account<'info, SwapGlobal>,
}

impl RemoveWhitelistedUnwrapper<'_> {
    fn validate(&self, authority: &Pubkey) -> Result<()> {
        if !self.swap_global.whitelisted_unwrappers.contains(authority) {
            return err!(SwapError::UnauthorizedUnwrapper);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&authority))]
    pub fn handler(ctx: Context<Self>, authority: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_unwrappers
            .retain(|&x| !x.eq(&authority));

        Ok(())
    }
}
