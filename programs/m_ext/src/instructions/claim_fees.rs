// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::{
    state::{EARNER_SEED, Global as EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED},
    ID as EARN_PROGRAM,
};

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::{amount_to_principal_down, principal_to_amount_up, sync_multiplier},
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
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = ext_mint @ ExtError::InvalidMint,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = EARN_PROGRAM,
        bump = m_earn_global_account.bump,
    )]
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

    /// CHECK: We partially validate this account is the correct address
    /// via the seed, but we delay full validation to the handler
    /// so we can handle cases where the account has been closed.
    #[account(
        seeds = [EARNER_SEED, vault_m_token_account.key().as_ref()],
        seeds::program = EARN_PROGRAM,
        bump,
    )]
    pub m_earner_account: UncheckedAccount<'info>,

    pub m_token_program: Program<'info, Token2022>,
    pub ext_token_program: Program<'info, Token2022>,
}

impl ClaimFees<'_> {
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Sync the multiplier before allowing any collateral withdrawals
        let signer_bump = ctx.accounts.global_account.ext_mint_authority_bump;
        let multiplier: f64 = sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.m_earn_global_account,
            &ctx.accounts.ext_mint_authority,
            &[&[MINT_AUTHORITY_SEED, &[signer_bump]]],
            &ctx.accounts.ext_token_program,
            &ctx.accounts.m_earner_account
        )?;

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
