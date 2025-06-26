use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, Token2022, TokenAccount};

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::{
        conversion::{amount_to_principal_down, sync_multiplier},
        token::{mint_tokens, transfer_tokens},
    },
};
use earn::{
    state::{Earner, EARNER_SEED},
    ID as EARN_PROGRAM,
};

#[derive(Accounts)]
pub struct Wrap<'info> {
    pub token_authority: Signer<'info>,

    // Will be set if a whitelisted authority is signing for a user
    pub wrap_authority: Option<Signer<'info>>,

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
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        seeds = [EARNER_SEED, vault_m_token_account.key().as_ref()],
        seeds::program = EARN_PROGRAM,
        bump = m_earner_account.bump,
    )]
    pub m_earner_account: Account<'info, Earner>,

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
        // signer must be authority of the from token account or delegated by the owner
        // this is checked by the token program
        token::token_program = m_token_program,
    )]
    pub from_m_token_account: InterfaceAccount<'info, TokenAccount>,

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
        // signer is arbitrary to allow wrapping to another user's account
        token::token_program = ext_token_program,
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    // we have duplicate entries for the token2022 program since the interface needs to be consistent, and all extensions may not be token2022
    // additionally, it allows us to change the m token program in the future without breaking the interface
    pub m_token_program: Program<'info, Token2022>,
    pub ext_token_program: Program<'info, Token2022>,
}

impl Wrap<'_> {
    pub fn validate(&self) -> Result<()> {
        let auth = match &self.wrap_authority {
            Some(auth) => auth.key,
            None => self.token_authority.key,
        };

        // Ensure the caller is authorized to wrap
        if !self.global_account.wrap_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        // If necessary, sync the multiplier between M and Ext tokens
        // Return the current value to use for conversions
        let multiplier = sync_multiplier(
            &mut ctx.accounts.ext_mint,
            &mut ctx.accounts.global_account,
            &ctx.accounts.m_earner_account,
            &ctx.accounts.vault_m_token_account,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.ext_token_program,
        )?;

        // Skip if amount is zero
        if amount == 0 {
            return Ok(());
        }

        // Transfer the amount of m tokens from the user to the m vault
        transfer_tokens(
            &ctx.accounts.from_m_token_account,              // from
            &ctx.accounts.vault_m_token_account,             // to
            amount,                                          // amount
            &ctx.accounts.m_mint,                            // mint
            &ctx.accounts.token_authority.to_account_info(), // authority
            &ctx.accounts.m_token_program,                   // token program
        )?;

        // Calculate the amount of ext tokens to mint based
        // on the amount of m tokens wrapped
        // If multiplier is 1.0, the amount remains the same
        let principal = amount_to_principal_down(amount, multiplier)?;

        // Mint the amount of ext tokens to the user
        mint_tokens(
            &ctx.accounts.to_ext_token_account, // to
            principal,                          // amount
            &ctx.accounts.ext_mint,             // mint
            &ctx.accounts.ext_mint_authority,   // authority
            authority_seeds,                    // authority seeds
            &ctx.accounts.ext_token_program,    // token program
        )?;

        Ok(())
    }
}
