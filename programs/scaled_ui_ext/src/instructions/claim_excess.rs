// no_earn/instructions/admin/claim_excess.rs

// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::state::Global as EarnGlobal;

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, M_VAULT_SEED, MINT_AUTHORITY_SEED},
    utils::{
        conversion::{check_solvency, principal_to_amount_down, sync_multiplier},
        token::transfer_tokens_from_program,
    },
};

#[derive(Accounts)]
pub struct ClaimExcess<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
        has_one = m_mint @ ExtError::InvalidAccount,
        has_one = ext_mint @ ExtError::InvalidAccount,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    /// CHECK: There is no data in this account, it is validated by the seed
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault_account: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault_account,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    // TODO should we require setting this pubkey in the global account?
    // Allowing admin to specify within the instruction is more flexible
    #[account(
        mut,
        token::mint = m_mint,
    )]
    pub recipient_m_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_2022: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<ClaimExcess>) -> Result<()> {
    // Sync the multiplier before allowing any collateral withdrawals
    let signer_bump = ctx.accounts.global_account.ext_mint_authority_bump;
    let multiplier: f64 = sync_multiplier(
        &mut ctx.accounts.ext_mint,
        &mut ctx.accounts.global_account,
        &ctx.accounts.m_earn_global_account,
        &ctx.accounts.ext_mint_authority,
        &[&[MINT_AUTHORITY_SEED, &[signer_bump]]],
        &ctx.accounts.token_2022,
    )?;

    // Calculate the required collateral, rounding down to be conservative
    // This amount will always be greater than what is required in the check_solvency function
    // since it allows a rounding error of up to 2e-6
    let req_collateral = principal_to_amount_down(ctx.accounts.ext_mint.supply, multiplier);

    // Excess M is the amount of M in the vault above the amount needed to fully collateralize the extension
    let vault_balance = ctx.accounts.vault_m_token_account.amount;

    let excess = vault_balance
        .checked_sub(req_collateral)
        .ok_or(ExtError::InsufficientCollateral)?; // This shouldn't underflow, but we check for safety

    // Only transfer a positive amount of excess
    if excess > 0 {
        transfer_tokens_from_program(
            &ctx.accounts.vault_m_token_account,
            &ctx.accounts.recipient_m_token_account,
            excess,
            &ctx.accounts.m_mint,
            &ctx.accounts.m_vault_account,
            &[&[M_VAULT_SEED, &[ctx.accounts.global_account.m_vault_bump]]],
            &ctx.accounts.token_2022,
        )?;

    
        // Reload the mint and check solvency to be sure the system is still solvent
        // This is probably overkill, but it is a good sanity check
        ctx.accounts.ext_mint.reload()?;
        check_solvency(
            &ctx.accounts.ext_mint,
            &ctx.accounts.global_account,
            &ctx.accounts.m_earn_global_account,
            &ctx.accounts.vault_m_token_account,
        )?;

        // TODO emit event?

    }

    Ok(())
}