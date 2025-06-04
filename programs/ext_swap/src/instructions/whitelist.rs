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
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        realloc = SwapGlobal::size(swap_global.whitelisted_extensions.len() + 1),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,
}

impl WhitelistExt<'_> {
    fn validate(&self, ext_program: &Pubkey) -> Result<()> {
        if self
            .swap_global
            .whitelisted_extensions
            .contains(ext_program)
        {
            return err!(SwapError::AlreadyWhitelisted);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(&ext_program))]
    pub fn handler(ctx: Context<Self>, ext_program: Pubkey) -> Result<()> {
        ctx.accounts
            .swap_global
            .whitelisted_extensions
            .push(ext_program);

        Ok(())
    }
}

#[derive(Accounts)]
pub struct RemoveWhitelistedExt<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [GLOBAL_SEED],
        bump = swap_global.bump,
        realloc = SwapGlobal::size(swap_global.whitelisted_extensions.len() - 1),
        realloc::payer = admin,
        realloc::zero = false,
    )]
    pub swap_global: Account<'info, SwapGlobal>,

    pub system_program: Program<'info, System>,
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
