use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{
        AssetConfig, ExtGlobalV2, ASSET_CONFIG_SEED, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED,
        M_VAULT_SEED,
    },
    utils::token::{mint_tokens, transfer_tokens},
};

#[derive(Accounts)]
pub struct WrapAsset<'info> {
    pub token_authority: Signer<'info>,

    /// Will be set if a whitelisted authority is signing for a user
    pub replace_authority: Option<Signer<'info>>,

    /// Non-M asset mint (USDC, USDT, etc.) - CANNOT be M
    #[account(
        mint::token_program = asset_token_program,
        constraint = asset_mint.key() != global_account.m_mint @ ExtError::AssetNotAllowed,
    )]
    pub asset_mint: InterfaceAccount<'info, Mint>,

    /// Extension token mint
    #[account(mut, mint::token_program = ext_token_program)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    #[account(
        seeds = [ASSET_CONFIG_SEED, asset_mint.key().as_ref()],
        bump = asset_config.bump,
    )]
    pub asset_config: Account<'info, AssetConfig>,

    /// CHECK: Validated by seed, used as vault authority
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub asset_vault: AccountInfo<'info>,

    /// CHECK: Validated by seed, mint authority for ext tokens
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    /// User's asset token account (source of assets)
    #[account(
        mut,
        token::mint = asset_mint,
        token::token_program = asset_token_program,
    )]
    pub from_asset_token_account: InterfaceAccount<'info, TokenAccount>,

    /// Vault's asset token account (destination for assets)
    #[account(
        mut,
        associated_token::mint = asset_mint,
        associated_token::authority = asset_vault,
        associated_token::token_program = asset_token_program,
    )]
    pub vault_asset_token_account: InterfaceAccount<'info, TokenAccount>,

    /// User's ext token account (receives minted ext tokens)
    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program,
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    pub asset_token_program: Interface<'info, TokenInterface>,
    pub ext_token_program: Interface<'info, TokenInterface>,
}

impl WrapAsset<'_> {
    pub fn validate(&self, amount: u64) -> Result<()> {
        let auth = match &self.replace_authority {
            Some(auth) => auth.key,
            None => self.token_authority.key,
        };

        // Ensure the caller is authorized
        if !self.global_account.replace_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        if amount == 0 {
            return err!(ExtError::InvalidAmount);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate(amount))]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        // 1. Validate cap not exceeded
        let new_balance = ctx
            .accounts
            .vault_asset_token_account
            .amount
            .checked_add(amount)
            .ok_or(ExtError::MathOverflow)?;

        // Uninitialized asset fails at deserialization (no account exists)
        // Initialized with cap = 0 caught by new_balance > cap check
        if new_balance > ctx.accounts.asset_config.cap {
            return err!(ExtError::AssetCapExceeded);
        }

        // 2. Transfer assets from user to vault
        transfer_tokens(
            &ctx.accounts.from_asset_token_account,
            &ctx.accounts.vault_asset_token_account,
            amount,
            &ctx.accounts.asset_mint,
            &ctx.accounts.token_authority.to_account_info(),
            &ctx.accounts.asset_token_program,
        )?;

        // 3. Mint ext tokens (1:1 since all assets have 6 decimals)
        mint_tokens(
            &ctx.accounts.to_ext_token_account,
            amount,
            &ctx.accounts.ext_mint,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.ext_token_program,
        )?;

        // 4. Update tracking state
        ctx.accounts.global_account.yield_config.total_assets = ctx
            .accounts
            .global_account
            .yield_config
            .total_assets
            .checked_add(amount)
            .ok_or(ExtError::MathOverflow)?;

        Ok(())
    }
}
