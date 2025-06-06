// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::state::Global as EarnGlobal;

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::{amount_to_principal_down, get_multiplier, principal_to_amount_up},
        token::mint_tokens,
    },
};

#[derive(Accounts)]
pub struct ClaimFees<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = ext_mint @ ExtError::InvalidMint,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(mint::token_program = m_token_program)]
    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, mint::token_program = ext_token_program)]
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
    pub m_vault: AccountInfo<'info>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    /// CHECK: Allowing the admin to specify the recipient account is more flexible
    /// so the authority of this token account is not checked
    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program,
    )]
    pub recipient_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub m_token_program: Program<'info, Token2022>,
    pub ext_token_program: Program<'info, Token2022>,
}

impl ClaimFees<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Get the multiplier to handle value conversions
        let multiplier: f64 = get_multiplier(&ctx.accounts.ext_mint, &ctx.accounts.global_account)?;

        // Calculate the required collateral, rounding down to be conservative
        // This amount will always be greater than what is required in the check_solvency function
        // since it allows a rounding error of up to 2e-6
        let required_m = principal_to_amount_up(ctx.accounts.ext_mint.supply, multiplier)?;

        // Excess M is the amount of M in the vault above the amount needed to fully collateralize the extension
        let vault_m = ctx.accounts.vault_m_token_account.amount;

        let excess = vault_m
            .checked_sub(required_m)
            .ok_or(ExtError::InsufficientCollateral)?; // This shouldn't underflow, but we check for safety

        let excess_principal = amount_to_principal_down(excess, multiplier)?;

        // Only transfer a positive amount of excess
        if excess_principal > 0 {
            mint_tokens(
                &ctx.accounts.recipient_ext_token_account,
                excess_principal,
                &ctx.accounts.ext_mint,
                &ctx.accounts.ext_mint_authority,
                &[&[
                    MINT_AUTHORITY_SEED,
                    &[ctx.accounts.global_account.ext_mint_authority_bump],
                ]],
                &ctx.accounts.ext_token_program,
            )?;

            emit!(FeesClaimed {
                recipient_token_account: ctx.accounts.recipient_ext_token_account.key(),
                amount: excess,
                principal: excess_principal,
            });
        }

        Ok(())
    }
}

#[event]
pub struct FeesClaimed {
    pub recipient_token_account: Pubkey,
    pub amount: u64,
    pub principal: u64,
}
