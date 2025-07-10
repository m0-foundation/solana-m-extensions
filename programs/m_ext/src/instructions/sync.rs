use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED},
    utils::conversion::sync_multiplier,
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022};

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = ext_mint @ ExtError::InvalidMint,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        mint::token_program = ext_token_program,
    )]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    pub ext_token_program: Program<'info, Token2022>,
}

impl Sync<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Sync the multiplier
        // This will update the multiplier on ext_mint
        // if it doesn't match the index on m_mint
        let signer_bump = ctx.accounts.global_account.ext_mint_authority_bump;
        sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.m_mint,
            &ctx.accounts.ext_mint_authority,
            &[&[MINT_AUTHORITY_SEED, &[signer_bump]]],
            &ctx.accounts.ext_token_program,
        )?;

        Ok(())
    }
}
