use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token_interface::{Mint, TokenAccount, TokenInterface},
};
use spl_token_2022::extension::ExtensionType;

use crate::{
    errors::ExtError,
    state::{AssetConfig, ExtGlobalV2, ASSET_CONFIG_SEED, EXT_GLOBAL_SEED, M_VAULT_SEED},
    utils::conversion::get_mint_extensions,
};

#[derive(Accounts)]
pub struct SetAssetCap<'info> {
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(mint::token_program = asset_token_program)]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        init_if_needed,
        payer = admin,
        space = 8 + AssetConfig::INIT_SPACE,
        seeds = [ASSET_CONFIG_SEED, asset_mint.key().as_ref()],
        bump,
    )]
    pub asset_config: Account<'info, AssetConfig>,

    /// CHECK: PDA used as vault authority for all token types
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub vault_authority: AccountInfo<'info>,

    /// Asset vault ATA - created if needed
    #[account(
        init_if_needed,
        payer = admin,
        associated_token::mint = asset_mint,
        associated_token::authority = vault_authority,
        associated_token::token_program = asset_token_program,
    )]
    pub vault_asset_token_account: InterfaceAccount<'info, TokenAccount>,

    pub asset_token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

impl SetAssetCap<'_> {
    pub fn validate(&self) -> Result<()> {
        // Cannot set cap for M token
        if self.asset_mint.key() == self.global_account.m_mint {
            return err!(ExtError::CannotCapMToken);
        }
        // Only accept assets with 6 decimals
        if self.asset_mint.decimals != 6 {
            return err!(ExtError::InvalidDecimals);
        }
        // Reject assets with problematic Token 2022 extensions
        let extensions = get_mint_extensions(&self.asset_mint)?;
        if extensions.contains(&ExtensionType::ScaledUiAmount) {
            return err!(ExtError::UnsupportedExtension);
        }
        if extensions.contains(&ExtensionType::TransferFeeConfig) {
            return err!(ExtError::UnsupportedExtension);
        }
        if extensions.contains(&ExtensionType::NonTransferable) {
            return err!(ExtError::UnsupportedExtension);
        }
        if extensions.contains(&ExtensionType::InterestBearingConfig) {
            return err!(ExtError::UnsupportedExtension);
        }
        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, cap: u64) -> Result<()> {
        ctx.accounts.asset_config.set_inner(AssetConfig {
            cap: cap,
            bump: ctx.bumps.asset_config,
        });

        Ok(())
    }
}
