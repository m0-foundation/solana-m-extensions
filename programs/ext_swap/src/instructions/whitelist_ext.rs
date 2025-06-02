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
    )]
    pub swap_global: Account<'info, SwapGlobal>,
}

impl WhitelistExt<'_> {
    fn validate(&self, insert_idx: usize) -> Result<()> {
        if insert_idx >= self.swap_global.whitelisted_extensions.len() {
            return err!(SwapError::InvalidIndex);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(insert_idx))]
    pub fn handler(ctx: Context<Self>, ext_program: Pubkey, insert_idx: usize) -> Result<()> {
        let whitelisted_exts = &mut ctx.accounts.swap_global.whitelisted_extensions;
        msg!("{} -> {}", whitelisted_exts[insert_idx], ext_program);
        whitelisted_exts[insert_idx] = ext_program;

        Ok(())
    }
}
