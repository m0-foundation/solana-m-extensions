// scaled_ui_ext/instructions/sync.rs

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022};
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED}, 
    utils::sync_multiplier,
};
use earn::state::Global as EarnGlobal;

#[derive(Accounts)]
pub struct Sync<'info> {
    pub signer: Signer<'info>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
        has_one = ext_mint @ ExtError::InvalidMint,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    pub token_2022: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<Sync>) -> Result<()> {
    // TODO do we need to check if the vault holds enough collateral for the new multiplier?
    // I.e. that ext_mint.supply * multiplier <= vault_m_token_account.amount

    sync_multiplier(
        &ctx.accounts.ext_mint,
        &ctx.accounts.m_earn_global_account, 
        &ctx.accounts.ext_mint_authority,
        &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]],
        &ctx.accounts.token_2022
    )?;

    Ok(())
}