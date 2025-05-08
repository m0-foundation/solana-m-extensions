// scaled_ui_ext/instructions/sync.rs

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::conversion::{check_solvency, sync_multiplier},
};
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
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

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    #[account(
        associated_token::mint = global_account.m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = Token2022::id(),
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

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
    // Check that the vault will be solvent after the sync
    // TODO: If not, should we skip the sync or revert?
    check_solvency(
        &ctx.accounts.ext_mint,
        &ctx.accounts.global_account,
        &ctx.accounts.m_earn_global_account,
        &ctx.accounts.vault_m_token_account,
    )?;

    // Sync the multiplier
    // This will update the multiplier on ext_mint
    // if it doesn't match the index on m_earn_global_account
    let signer_bump = ctx.accounts.global_account.ext_mint_authority_bump;
    sync_multiplier(
        &mut ctx.accounts.ext_mint,
        &mut ctx.accounts.global_account,
        &ctx.accounts.m_earn_global_account,
        &ctx.accounts.ext_mint_authority,
        &[&[MINT_AUTHORITY_SEED, &[signer_bump]]],
        &ctx.accounts.token_2022,
    )?;

    Ok(())
}
