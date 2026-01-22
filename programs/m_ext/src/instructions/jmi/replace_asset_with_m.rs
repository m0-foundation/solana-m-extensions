use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{AssetConfig, ExtGlobalV2, ASSET_CONFIG_SEED, EXT_GLOBAL_SEED, M_VAULT_SEED},
    utils::{
        conversion::{multiplier_to_index, principal_to_amount_down},
        token::{transfer_tokens, transfer_tokens_from_program},
    },
};
use earn::utils::conversion::get_scaled_ui_config;

#[derive(Accounts)]
pub struct ReplaceAssetWithM<'info> {
    pub token_authority: Signer<'info>,

    /// Will be set if a whitelisted authority is signing for a user
    pub replace_authority: Option<Signer<'info>>,

    #[account(mint::token_program = m_token_program)]
    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mint::token_program = asset_token_program,
        constraint = asset_mint.key() != m_mint.key() @ ExtError::AssetNotAllowed,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        seeds = [ASSET_CONFIG_SEED, asset_mint.key().as_ref()],
        bump = asset_config.bump,
    )]
    pub asset_config: Account<'info, AssetConfig>,

    /// CHECK: Validated by seed
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = m_mint,
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
        associated_token::mint = asset_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = asset_token_program,
    )]
    pub vault_asset_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = asset_mint,
        token::token_program = asset_token_program,
    )]
    pub to_asset_token_account: InterfaceAccount<'info, TokenAccount>,

    pub m_token_program: Interface<'info, TokenInterface>,
    pub asset_token_program: Interface<'info, TokenInterface>,
}

impl ReplaceAssetWithM<'_> {
    pub fn validate(&self, m_principal: u64) -> Result<()> {
        let auth = match &self.replace_authority {
            Some(auth) => auth.key,
            None => self.token_authority.key,
        };

        // Ensure the caller is authorized (same as wrap/unwrap)
        if !self.global_account.wrap_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        if m_principal == 0 {
            return err!(ExtError::InvalidAmount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(m_principal))]
    pub fn handler(ctx: Context<Self>, m_principal: u64) -> Result<()> {
        // Get M index and convert principal to economic value
        let m_scaled_ui_config = get_scaled_ui_config(&ctx.accounts.m_mint)?;
        let m_index: u64 = multiplier_to_index(m_scaled_ui_config.new_multiplier.into())?;
        let asset_amount: u64 = principal_to_amount_down(m_principal, m_index)?;

        // Validate sufficient asset backing
        if asset_amount > ctx.accounts.vault_asset_token_account.amount {
            return err!(ExtError::InsufficientAssetBacking);
        }

        // Transfer M from caller to vault
        transfer_tokens(
            &ctx.accounts.from_m_token_account,
            &ctx.accounts.vault_m_token_account,
            m_principal,
            &ctx.accounts.m_mint,
            &ctx.accounts.token_authority.to_account_info(),
            &ctx.accounts.m_token_program,
        )?;

        // Transfer asset from vault to recipient
        transfer_tokens_from_program(
            &ctx.accounts.vault_asset_token_account,
            &ctx.accounts.to_asset_token_account,
            asset_amount,
            &ctx.accounts.asset_mint,
            &ctx.accounts.m_vault,
            &[&[M_VAULT_SEED, &[ctx.accounts.global_account.m_vault_bump]]],
            &ctx.accounts.asset_token_program,
        )?;

        // Update tracking
        ctx.accounts.global_account.yield_config.total_assets = ctx
            .accounts
            .global_account
            .yield_config
            .total_assets
            .checked_sub(asset_amount)
            .ok_or(ExtError::MathUnderflow)?;

        Ok(())
    }
}
