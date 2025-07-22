use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::spl_token_2022::state::AccountState,
    token_interface::{Mint, Token2022, TokenAccount},
};
use spl_token_2022::extension::ExtensionType;

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED, M_VAULT_SEED},
};
use earn::{
    state::{EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED},
    utils::conversion::{get_mint_extensions, get_scaled_ui_config, principal_to_amount_down},
    ID as EARN_PROGRAM,
};

#[derive(Accounts)]
pub struct MigrateM<'info> {
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobal>,

    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = EARN_PROGRAM,
        bump = m_earn_global_account.bump
    )]
    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        mint::token_program = token2022,
        mint::decimals = ext_mint.decimals,
        address = m_earn_global_account.m_mint,
    )]
    pub new_m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        address = global_account.m_mint,
    )]
    pub old_m_mint: InterfaceAccount<'info, Mint>,

    pub ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: This account is just a signer and is checked by the seeds
    #[account(
        seeds = [M_VAULT_SEED],
        bump = global_account.m_vault_bump,
    )]
    pub m_vault: UncheckedAccount<'info>,

    /// Note: this account must be created and thawed before the migration.
    #[account(
        associated_token::mint = new_m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = token2022,
        constraint = new_vault_m_token_account.state == AccountState::Initialized @ ExtError::InvalidAccount,
    )]
    pub new_vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        associated_token::mint = old_m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = token2022,
    )]
    pub old_vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token2022: Program<'info, Token2022>,
}

impl MigrateM<'_> {
    fn validate(&self) -> Result<()> {
        // Confirm that the new M mint has the ScaledUiAmount extension enabled
        let extensions = get_mint_extensions(&self.new_m_mint)?;

        if !extensions.contains(&ExtensionType::ScaledUiAmount) {
            return err!(ExtError::InvalidMint);
        }

        // Confirm that the new vault M token account has atleast as much M (adjusted for the multiplier) as the old vault M token account
        let new_scaled_ui_config = get_scaled_ui_config(&self.new_m_mint)?;
        let new_vault_m_amount = principal_to_amount_down(
            self.new_vault_m_token_account.amount,
            new_scaled_ui_config.new_multiplier.into(),
        )?;

        // Note: the v1 M token did not have a rebasing extension so we can use the amount directly
        let old_vault_m_amount = self.old_vault_m_token_account.amount;

        if new_vault_m_amount < old_vault_m_amount {
            return err!(ExtError::InsufficientCollateral);
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Set the new m mint and m_earn_global_account in the ext global account
        let global_account = &mut ctx.accounts.global_account;
        global_account.m_mint = ctx.accounts.new_m_mint.key();
        global_account.m_earn_global_account = ctx.accounts.m_earn_global_account.key();

        Ok(())
    }
}
