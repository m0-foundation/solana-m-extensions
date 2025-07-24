use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::{amount_to_principal_down, principal_to_amount_down, sync_multiplier},
        token::{burn_tokens, transfer_tokens_from_program},
    },
};

#[derive(Accounts)]
pub struct Unwrap<'info> {
    pub token_authority: Signer<'info>,

    // Will be set if a whitelisted authority is signing for a user
    pub unwrap_authority: Option<Signer<'info>>,

    #[account(mint::token_program = m_token_program)]
    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, mint::token_program = ext_token_program)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidAccount,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

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
        token::token_program = m_token_program,
        // authority of the to token account is not checked to allow unwrap + send
    )]
    pub to_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program,
        // signer must be the authority of the from token account or delegated by the owner
        // this is checked by the token program
    )]
    pub from_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    // we have duplicate entries for the token2022 program since the interface needs to be consistent
    // but we want to leave open the possibility that either may not have to be token2022 in the future
    pub m_token_program: Program<'info, Token2022>,
    pub ext_token_program: Interface<'info, TokenInterface>,
}

impl Unwrap<'_> {
    pub fn validate(&self, ext_principal: u64) -> Result<()> {
        let auth = match &self.unwrap_authority {
            Some(auth) => auth.key,
            None => self.token_authority.key,
        };

        // Ensure the caller is authorized to wrap
        if !self.global_account.wrap_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        if ext_principal == 0 {
            return err!(ExtError::InvalidAmount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(ext_principal))]
    pub fn handler(ctx: Context<Self>, ext_principal: u64) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        // If necessary, sync the multiplier between M and Ext tokens
        // Return the current value to use for conversions
        let ext_multiplier: f64 = sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.m_mint,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.ext_token_program,
        )?;

        // Get the current multiplier for the m_mint
        let m_scaled_ui_config =
            earn::utils::conversion::get_scaled_ui_config(&ctx.accounts.m_mint)?;
        let m_multiplier: f64 = m_scaled_ui_config.new_multiplier.into();

        // TODO should we reduce ext_principal to the user's balance to avoid reverts?

        // Calculate the principal amount of m tokens
        // from the principal amount of ext tokens to unwrap
        let m_principal: u64 = amount_to_principal_down(
            principal_to_amount_down(ext_principal, ext_multiplier)?,
            m_multiplier,
        )?;

        // Burn the amount of ext tokens from the user
        burn_tokens(
            &ctx.accounts.from_ext_token_account,            // from
            ext_principal,                                   // amount
            &ctx.accounts.ext_mint,                          // mint
            &ctx.accounts.token_authority.to_account_info(), // authority
            &ctx.accounts.ext_token_program,                 // token program
        )?;

        // Transfer the amount of m tokens from the m vault to the user
        transfer_tokens_from_program(
            &ctx.accounts.vault_m_token_account, // from
            &ctx.accounts.to_m_token_account,    // to
            m_principal,                         // amount
            &ctx.accounts.m_mint,                // mint
            &ctx.accounts.m_vault,               // authority
            &[&[M_VAULT_SEED, &[ctx.accounts.global_account.m_vault_bump]]], // authority seeds
            &ctx.accounts.m_token_program,       // token program
        )?;

        Ok(())
    }
}
