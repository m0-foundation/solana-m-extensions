use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};
use earn::state::Global as EarnGlobal;

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::{amount_to_principal_down, check_solvency, sync_multiplier},
        token::{mint_tokens, transfer_tokens},
    },
};

#[derive(Accounts)]
pub struct Wrap<'info> {
    pub signer: Signer<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
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
        bump = global_account.m_vault_bump
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
        token::authority = signer,
    )]
    pub from_m_token_account: InterfaceAccount<'info, TokenAccount>,

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
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_2022: Program<'info, Token2022>,
}

impl Wrap<'_> {
    fn validate(&self) -> Result<()> {
        #[cfg(feature = "permissioned-wrapping")]
        if !self
            .global_account
            .wrap_authorities
            .contains(&self.signer.key())
        {
            return Err(ExtError::InvalidAccount.into());
        }

        check_solvency(
            &self.ext_mint,
            &self.m_earn_global_account,
            &self.vault_m_token_account,
        )
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        let multiplier = sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &ctx.accounts.m_earn_global_account,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.token_2022,
        )?;

        // Transfer the amount of m tokens from the user to the m vault
        transfer_tokens(
            &ctx.accounts.from_m_token_account,     // from
            &ctx.accounts.vault_m_token_account,    // to
            amount,                                 // amount
            &ctx.accounts.m_mint,                   // mint
            &ctx.accounts.signer.to_account_info(), // authority
            &ctx.accounts.token_2022,               // token program
        )?;

        // Calculate the amount of ext tokens to mint based on the amount of m tokens wrapped
        let principal = amount_to_principal_down(amount, multiplier);

        // Mint the amount of ext tokens to the user
        mint_tokens(
            &ctx.accounts.to_ext_token_account, // to
            principal,                          // amount
            &ctx.accounts.ext_mint,             // mint
            &ctx.accounts.ext_mint_authority,   // authority
            authority_seeds,                    // authority seeds
            &ctx.accounts.token_2022,           // token program
        )?;

        Ok(())
    }
}
