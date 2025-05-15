use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount, TokenInterface};

use crate::{
    errors::ExtError,
    state::{
        Config, ExtConfig, YieldConfig, CONFIG_SEED, EXT_CONFIG_SEED_PREFIX,
        MINT_AUTHORITY_SEED_PREFIX, M_VAULT_SEED_PREFIX,
    },
};
use earn::state::Global as EarnGlobal;

#[derive(Accounts)]
pub struct Sync<'info> {
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

    pub ext_token_program: Interface<'info, TokenInterface>,

    /// CHECK: This program is validated if the extension has a custom yield distribution program
    pub ext_program: Option<AccountInfo<'info>>,
}

impl<'info> Sync<'info> {
    fn validate(&self) -> Result<()> {
        match &self.ext_config.yield_config {
            // Some yield distributions methods require the sync instruction to be permissioned
            YieldConfig::Crank(crank_config) => {
                if self.signer.key() != crank_config.earn_authority {
                    return err!(ExtError::NotAuthorized);
                }
            }
            YieldConfig::MerkleClaims(merkle_config) => {
                if self.signer.key() != merkle_config.earn_authority {
                    return err!(ExtError::NotAuthorized);
                }
            }
            _ => {}
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<'_, '_, '_, 'info, Self>, amount_m: u64) -> Result<()> {
        match &mut ctx.accounts.ext_config.yield_config {
            YieldConfig::None => {
                // no sync required
            }
            YieldConfig::Crank(crank_config) => {
                // sync the extension if required
                crank_config.sync(&ctx.accounts.m_earn_global_account)?;
            }
            YieldConfig::MerkleClaims(merkle_config) => {
                // sync the extension if required
                // merkle_config.sync(ctx)?;
                // TODO figure out the right pattern for these
            }
            YieldConfig::Rebasing(rebasing_config) => {
                // sync the extension if required
                rebasing_config.sync(
                    &mut ctx.accounts.ext_mint,
                    &ctx.accounts.m_earn_global_account,
                    &ctx.accounts.vault_m_token_account,
                    &ctx.accounts.ext_mint_authority,
                    &[&[
                        MINT_AUTHORITY_SEED_PREFIX,
                        ext_config.ext_mint.key().as_ref(),
                        &[ext_config.ext_mint_authority_bump],
                    ]],
                    &ctx.accounts.ext_token_program,
                )?;
            }
            YieldConfig::Custom(custom_config) => {
                // TODO should we allow a cpi here?
            }
        };

        Ok(())
    }
}
