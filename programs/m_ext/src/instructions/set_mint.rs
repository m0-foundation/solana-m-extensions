use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED},
};
use anchor_lang::prelude::*;
use anchor_spl::{token_2022, token_interface::Mint};
use std::str::FromStr;

#[derive(Accounts)]
pub struct SetMint<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        mut,
        mint::token_program = token_2022::ID,
        mint::decimals = 6,
        constraint = ext_mint.supply == 0 @ ExtError::InvalidMint,
    )]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Validated by the seeds, stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

impl SetMint<'_> {
    pub fn handler(ctx: Context<SetMint>) -> Result<()> {
        // Validate the ext_mint_authority PDA is the mint authority for the ext mint
        if ctx.accounts.ext_mint.mint_authority.unwrap_or_default()
            != ctx.accounts.ext_mint_authority.key()
        {
            return err!(ExtError::InvalidMint);
        }

        // Validate that the ext mint has a freeze authority
        if ctx.accounts.ext_mint.freeze_authority.is_none() {
            return err!(ExtError::InvalidMint);
        }

        // Hardcode mint we are updating to
        if ctx.accounts.ext_mint.key()
            != Pubkey::from_str("xoUSDq85Rjsb6SbUwJyreFgeWQvxdkT7R3c3g7s6p5Y").unwrap()
        {
            return err!(ExtError::InvalidMint);
        }

        ctx.accounts.global_account.m_mint = ctx.accounts.ext_mint.key();
        msg!("Set ext mint to {}", ctx.accounts.ext_mint.key());

        Ok(())
    }
}
