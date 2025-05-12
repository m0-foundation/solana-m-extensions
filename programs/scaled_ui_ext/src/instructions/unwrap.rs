// scaled_ui_ext/instructions/unwrap.rs

use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::{amount_to_principal_up, sync_multiplier},
        token::{burn_tokens, transfer_tokens_from_program},
    },
};
use earn::state::Global as EarnGlobal;

#[derive(Accounts)]
pub struct Unwrap<'info> {
    #[account(
        constraint = signer.key() != Pubkey::default() && global_account.wrap_authorities.contains(&signer.key()) @ ExtError::NotAuthorized,
    )]
    pub signer: Signer<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidAccount,
        has_one = ext_mint @ ExtError::InvalidAccount,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = m_mint,
    )]
    pub to_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = token_2022,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::authority = signer,
    )]
    pub from_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_2022: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
    let authority_seeds: &[&[&[u8]]] = &[&[
        MINT_AUTHORITY_SEED,
        &[ctx.accounts.global_account.ext_mint_authority_bump],
    ]];

    // Update the scaled UI multiplier with the current M index
    // before unwrapping tokens
    // If multiplier up to date, just reads the current value
    let multiplier = sync_multiplier(
        &mut ctx.accounts.ext_mint,
        &mut ctx.accounts.global_account,
        &ctx.accounts.m_earn_global_account,
        &ctx.accounts.vault_m_token_account,
        &ctx.accounts.ext_mint_authority,
        authority_seeds,
        &ctx.accounts.token_2022,
    )?;

    // Calculate the principal amount of ext tokens to burn
    // from the amount of m tokens to unwrap
    let mut principal = amount_to_principal_up(amount, multiplier)?;
    if principal > ctx.accounts.from_ext_token_account.amount {
        principal = ctx.accounts.from_ext_token_account.amount;
    }

    // Burn the amount of ext tokens from the user
    burn_tokens(
        &ctx.accounts.from_ext_token_account,   // from
        principal,                              // amount
        &ctx.accounts.ext_mint,                 // mint
        &ctx.accounts.signer.to_account_info(), // authority
        &ctx.accounts.token_2022,               // token program
    )?;

    // Transfer the amount of m tokens from the m vault to the user
    transfer_tokens_from_program(
        &ctx.accounts.vault_m_token_account, // from
        &ctx.accounts.to_m_token_account,    // to
        amount,                              // amount
        &ctx.accounts.m_mint,                // mint
        &ctx.accounts.m_vault,               // authority
        &[&[M_VAULT_SEED, &[ctx.accounts.global_account.m_vault_bump]]], // authority seeds
        &ctx.accounts.token_2022,            // token program
    )?;

    Ok(())
}
