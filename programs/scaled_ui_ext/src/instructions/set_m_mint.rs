// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, M_VAULT_SEED},
};

#[derive(Accounts)]
pub struct SetMMint<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        has_one = admin @ ExtError::NotAuthorized,
        has_one = m_mint @ ExtError::InvalidAccount,
        bump = global_account.bump,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        associated_token::mint = global_account.m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = Token2022::id(),
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mint::token_program = Token2022::id(),
        mint::decimals = m_mint.decimals,
    )]
    pub new_m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        associated_token::mint = new_m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = Token2022::id(),
    )]
    pub new_vault_m_token_account: InterfaceAccount<'info, TokenAccount>,
}

impl SetMMint<'_> {
    // This instruction allows the admin to set a new mint for the m_mint in the global account.
    // The new mint must be a valid mint with the same decimals as the existing m_mint.
    // Additionally, the new vault ATA for the new mint must contain at least as many tokens
    // as the existing vault ATA to ensure the extension remains fully collateralized.
    pub fn validate(&self) -> Result<()> {
        // Validate that the vault ATA for the new mint contains as many tokens
        // as the existing vault ATA so that the extension remains fully collateralized
        if self.new_vault_m_token_account.amount < self.vault_m_token_account.amount {
            return err!(ExtError::InsufficientCollateral);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Set the new mint
        ctx.accounts.global_account.m_mint = ctx.accounts.new_m_mint.key();

        Ok(())
    }
}
