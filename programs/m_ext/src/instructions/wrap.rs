use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED, MINT_AUTHORITY_SEED, M_VAULT_SEED},
    utils::token::{mint_tokens, transfer_tokens_interface},
};

#[cfg(feature = "jmi")]
use crate::state::{AssetConfig, ASSET_CONFIG_SEED};

use crate::utils::conversion::{
    amount_to_principal_down, multiplier_to_index, principal_to_amount_down, sync_index,
};

#[cfg(feature = "jmi")]
use crate::utils::conversion::convert_to_6_decimals;

/// Unified Wrap accounts struct
/// - Non-JMI: source_mint must be M
/// - JMI: source_mint can be M or approved asset
#[derive(Accounts)]
pub struct Wrap<'info> {
    pub token_authority: Signer<'info>,

    /// Will be set if a whitelisted authority is signing for a user
    pub wrap_authority: Option<Signer<'info>>,

    /// Source token mint (M for non-JMI; M or approved asset for JMI)
    #[account(mint::token_program = source_token_program)]
    pub source_mint: InterfaceAccount<'info, Mint>,

    #[account(mut, mint::token_program = ext_token_program)]
    pub ext_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump
    )]
    pub source_vault: AccountInfo<'info>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [MINT_AUTHORITY_SEED],
        bump = global_account.ext_mint_authority_bump,
    )]
    pub ext_mint_authority: AccountInfo<'info>,

    #[account(
        mut,
        token::mint = source_mint,
        token::token_program = source_token_program,
    )]
    pub from_source_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        associated_token::mint = source_mint,
        associated_token::authority = source_vault,
        associated_token::token_program = source_token_program,
    )]
    pub vault_source_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        mut,
        token::mint = ext_mint,
        token::token_program = ext_token_program,
    )]
    pub to_ext_token_account: InterfaceAccount<'info, TokenAccount>,

    #[cfg(feature = "jmi")]
    /// AssetConfig for non-M assets (JMI only)
    /// - JMI + M path: must be None
    /// - JMI + asset path: must be Some with cap > 0
    #[account(
        mut,
        seeds = [ASSET_CONFIG_SEED, global_account.key().as_ref(), source_mint.key().as_ref()],
        bump = asset_config.bump,
    )]
    pub asset_config: Option<Account<'info, AssetConfig>>,

    pub source_token_program: Interface<'info, TokenInterface>,
    pub ext_token_program: Interface<'info, TokenInterface>,
}

impl Wrap<'_> {
    pub fn validate(&self, amount: u64) -> Result<()> {
        let auth = match &self.wrap_authority {
            Some(auth) => auth.key,
            None => self.token_authority.key,
        };

        // Ensure the caller is authorized to wrap
        if !self.global_account.wrap_authorities.contains(auth) {
            return err!(ExtError::NotAuthorized);
        }

        if amount == 0 {
            return err!(ExtError::InvalidAmount);
        }

        // Non-JMI: source_mint MUST be m_mint (replaces has_one constraint)
        #[cfg(not(feature = "jmi"))]
        {
            if self.source_mint.key() != self.global_account.m_mint {
                return err!(ExtError::InvalidAccount);
            }
        }

        // JMI: validate asset is either M or has an AssetConfig with cap > 0
        #[cfg(feature = "jmi")]
        {
            let is_m = self.source_mint.key() == self.global_account.m_mint;
            if !is_m {
                match &self.asset_config {
                    Some(config) => {
                        if config.cap == 0 {
                            return err!(ExtError::AssetNotAllowed);
                        }
                    }
                    None => {
                        return err!(ExtError::AssetNotAllowed);
                    }
                }
            }
        }

        Ok(())
    }

    // Single unified handler for all feature combinations
    #[access_control(ctx.accounts.validate(amount))]
    pub fn handler(ctx: Context<Self>, amount: u64) -> Result<()> {
        let authority_seeds: &[&[&[u8]]] = &[&[
            MINT_AUTHORITY_SEED,
            &[ctx.accounts.global_account.ext_mint_authority_bump],
        ]];

        let mut ext_amount = {
            let ext_index: u64 = sync_index(
                &mut ctx.accounts.ext_mint,
                &mut ctx.accounts.global_account,
                &ctx.accounts.source_mint,
                &ctx.accounts.vault_source_token_account,
                &ctx.accounts.ext_mint_authority,
                authority_seeds,
                &ctx.accounts.ext_token_program,
            )?;

            let m_scaled_ui_config =
                earn::utils::conversion::get_scaled_ui_config(&ctx.accounts.source_mint)?;
            let m_index = multiplier_to_index(m_scaled_ui_config.new_multiplier.into())?;

            amount_to_principal_down(principal_to_amount_down(amount, m_index)?, ext_index)?
        };

        // JMI: cap tracking for non-M assets (only with no-yield)
        #[cfg(feature = "jmi")]
        {
            let is_m = ctx.accounts.source_mint.key() == ctx.accounts.global_account.m_mint;
            if !is_m {
                let asset_config = ctx
                    .accounts
                    .asset_config
                    .as_mut()
                    .ok_or(ExtError::AssetNotAllowed)?;

                let new_balance = asset_config
                    .balance
                    .checked_add(amount)
                    .ok_or(ExtError::MathOverflow)?;
                if new_balance > asset_config.cap {
                    return err!(ExtError::AssetCapExceeded);
                }
                asset_config.balance = new_balance;

                let amount_in_6_decimals = convert_to_6_decimals(amount, asset_config.decimals)?;
                ctx.accounts.global_account.yield_config.total_assets = ctx
                    .accounts
                    .global_account
                    .yield_config
                    .total_assets
                    .checked_add(amount_in_6_decimals)
                    .ok_or(ExtError::MathOverflow)?;

                ext_amount = amount_in_6_decimals;
            }
        }

        // Transfer source tokens from user to vault
        transfer_tokens_interface(
            &ctx.accounts.from_source_token_account,
            &ctx.accounts.vault_source_token_account,
            amount,
            &ctx.accounts.source_mint,
            &ctx.accounts.token_authority.to_account_info(),
            &ctx.accounts.source_token_program,
        )?;

        // Mint ext tokens to user
        mint_tokens(
            &ctx.accounts.to_ext_token_account,
            ext_amount,
            &ctx.accounts.ext_mint,
            &ctx.accounts.ext_mint_authority,
            authority_seeds,
            &ctx.accounts.ext_token_program,
        )?;

        Ok(())
    }
}
