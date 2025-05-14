use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{
        Config, ExtConfig, CONFIG_SEED, EXT_CONFIG_SEED_PREFIX, MINT_AUTHORITY_SEED_PREFIX,
        M_VAULT_SEED_PREFIX,
    },
    utils::{
        conversion::amount_to_principal_down,
        token::{mint_tokens, transfer_tokens},
    },
};
use earn::state::Global as EarnGlobal;

#[derive(Accounts)]
pub struct Wrap<'info> {
    pub signer: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = m_mint @ ExtError::InvalidMint,
        has_one = m_earn_global_account @ ExtError::InvalidAccount,
    )]
    pub config: Account<'info, Config>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(mut)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.m_vault_bump
    )]
    pub m_vault: AccountInfo<'info>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = m_mint,
        token::authority = signer,
        token::token_program = m_token_program
    )]
    pub from_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    pub m_token_program: Interface<'info, TokenInterface>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub ext_token_program: Interface<'info, TokenInterface>,

    /// CHECK: This program is validated if the extension has a custom yield distribution program
    pub ext_program: Option<AccountInfo<'info>>,
}

impl<'info> Wrap<'info> {
    fn validate(&self) -> Result<()> {
        match self.ext_config.access_config {
            AccessConfig::Open => Ok(()),
            AccessConfig::Finite(finite_config) => {
                if finite_config.wrap_authorities.contains(&self.signer.key()) {
                    Ok(())
                } else {
                    Err(ExtError::NotAuthorized.into())
                }
            }
        }
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<'_, '_, '_, 'info, Self>, amount_m: u64) -> Result<()> {
        let amount_ext = match ctx.accounts.ext_config.yield_config {
            YieldConfig::Rebasing(rebasing_config) => {
                // most yield distribution methods maintain 1:1 ratio
                // between m and ext tokens, but token2022 rebasing tokens do not
                // on the token accounts even though it is displayed that way on the UI

                // sync the extension if required and return the conversion rate (aka multiplier)
                let multiplier = rebasing_config.sync(ctx)?;

                // calculate the amount of ext tokens to mint and return
                amount_to_principal_down(amount_m, multiplier)?
            }
            YieldConfig::Custom(custom_config) => {
                // custom extensions may implement a wrap hook to perform custom logic
                // and/or be able to provide a conversion rate (aka multiplier)
                // if the ratio is not 1:1 between m and ext tokens
                // if no wrap hook is provided, we assume a 1:1 ratio
                if custom_config.wrap_hook {
                    let multiplier = custom_config.wrap_hook(ctx)?;

                    // calculate the amount of ext tokens to mint and return
                    amount_to_principal_down(amount_m, multiplier)?
                } else {
                    // if no wrap hook is provided, we assume a 1:1 ratio
                    amount_m
                }
            }
            _ => amount_m,
        };

        // Transfer the amount of m tokens from the user to the m vault
        transfer_tokens(
            &ctx.accounts.from_m_token_account,     // from
            &ctx.accounts.vault_m_token_account,    // to
            amount,                                 // amount
            &ctx.accounts.m_mint,                   // mint
            &ctx.accounts.signer.to_account_info(), // authority
            &ctx.accounts.m_token_program,          // token program
        )?;

        // Mint the amount of ext tokens to the user
        mint_tokens(
            &ctx.accounts.to_ext_token_account, // to
            amount_ext,                         // amount
            &ctx.accounts.ext_mint,             // mint
            &ctx.accounts.ext_mint_authority,   // authority
            &[&[
                MINT_AUTHORITY_SEED_PREFIX,
                ctx.accounts.ext_mint.key().as_ref(),
                &[ctx.accounts.ext_config.ext_mint_authority_bump],
            ]], // authority seeds
            &ctx.accounts.ext_token_program,    // token program
        )?;

        Ok(())
    }
}
