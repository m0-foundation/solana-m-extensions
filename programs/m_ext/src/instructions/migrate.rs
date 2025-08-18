// This instruction is optionally included when an extension needs to be upgraded from a previous version.
// It handles three cases for the M v2 migration:
// 1. Migrating wM from the legacy ext_earn program to the new m_ext "crank" variant, which involves a layout change
// 2. Migrating existing scaled-ui m_ext programs to the new M v2 variant, which involves adding a yield variant in the yield config
// 3. Migrating existing no-yield m_ext programs to the new M v2 variant, which involves adding a yield variant in the yield config
// All versions require resizing the global account to increase the space for the yield variant variable.

use anchor_lang::{
    prelude::*,
    system_program::{transfer, Transfer},
};
use anchor_spl::{
    token_2022::spl_token_2022::state::AccountState,
    token_interface::{Mint, Token2022, TokenAccount},
};
use cfg_if::cfg_if;
use spl_token_2022::extension::ExtensionType;

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, YieldConfig, YieldVariant, EXT_GLOBAL_SEED, M_VAULT_SEED},
};
use earn::{
    state::{EarnGlobal, GLOBAL_SEED as EARN_GLOBAL_SEED},
    utils::conversion::{get_mint_extensions, get_scaled_ui_config, principal_to_amount_down},
    ID as EARN_PROGRAM,
};

// Note: we have already ensured that the "migrate" feature is enabled when including this instruction
// Therfore, we only need to consider valid feature configurations here
cfg_if! {
    if #[cfg(feature = "wm")] {
        declare_program!(ext_earn);
        use ext_earn::accounts::ExtGlobal as ExtGlobalV1;
    } else if #[cfg(feature = "scaled-ui")] {
        declare_program!(m_ext_v1_scaled_ui);
        use m_ext_v1_scaled_ui::accounts::ExtGlobal as ExtGlobalV1;
    } else if #[cfg(feature = "no-yield")] {
        declare_program!(m_ext_v1_no_yield);
        use m_ext_v1_no_yield::accounts::ExtGlobal as ExtGlobalV1;
    }
}

#[derive(Accounts)]
pub struct MigrateM<'info> {
    /// Note: this account is mutable to pay for the resize operation
    #[account(mut)]
    pub admin: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = admin @ ExtError::NotAuthorized,
        has_one = ext_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobalV1>,

    #[account(
        seeds = [EARN_GLOBAL_SEED],
        seeds::program = EARN_PROGRAM,
        bump = m_earn_global_account.bump
    )]
    pub m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        mint::token_program = m_token_program,
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
        associated_token::token_program = m_token_program,
        constraint = new_vault_m_token_account.state == AccountState::Initialized @ ExtError::InvalidAccount,
    )]
    pub new_vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    #[account(
        associated_token::mint = old_m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = m_token_program,
    )]
    pub old_vault_m_token_account: InterfaceAccount<'info, TokenAccount>,

    pub m_token_program: Program<'info, Token2022>,

    pub system_program: Program<'info, System>,
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
        let old_global = ctx.accounts.global_account.clone();

        // Create the new yield config based on the feature configuration and currently stored values
        let yield_config: YieldConfig;

        cfg_if! {
            if #[cfg(feature = "wm")] {
                yield_config = YieldConfig {
                    yield_variant: YieldVariant::Crank,
                    earn_authority: old_global.earn_authority,
                    last_m_index: old_global.index,
                    last_ext_index: old_global.index, // we set the extension index to the same as the M index since V1 used the same one
                    timestamp: old_global.timestamp,
                };
            } else if #[cfg(feature = "scaled-ui")] {
                yield_config = YieldConfig {
                    yield_variant: YieldVariant::ScaledUi,
                    fee_bps: old_global.yield_config.fee_bps,
                    last_m_index: old_global.yield_config.last_m_index,
                    last_ext_index: old_global.yield_config.last_ext_index,
                };
            } else if #[cfg(feature = "no-yield")] {
                yield_config = YieldConfig {
                    yield_variant: YieldVariant::NoYield,
                };
            }
        };

        // Resize the global account to accommodate the new yield config
        // We need to take into account the current number of wrap authorities
        let new_size = ExtGlobalV2::size(old_global.wrap_authorities.len());
        let account_info = ctx.accounts.global_account.to_account_info();
        account_info.realloc(new_size, false)?;

        // Send lamports to the global account to cover the resize cost
        let rent_exempt_lamports = Rent::get().unwrap().minimum_balance(new_size).max(1);
        let top_up_lamports = rent_exempt_lamports.saturating_sub(account_info.lamports());

        if top_up_lamports > 0 {
            transfer(
                CpiContext::new(
                    ctx.accounts.system_program.to_account_info(),
                    Transfer {
                        from: ctx.accounts.admin.to_account_info(),
                        to: account_info,
                    },
                ),
                top_up_lamports,
            )?;
        }

        // Create the new layout and
        // update the m_mint and m_earn_global_account fields
        let new_global = ExtGlobalV2 {
            admin: old_global.admin,
            pending_admin: None,
            ext_mint: old_global.ext_mint,
            m_mint: ctx.accounts.new_m_mint.key(),
            m_earn_global_account: ctx.accounts.m_earn_global_account.key(),
            bump: old_global.bump,
            m_vault_bump: old_global.m_vault_bump,
            ext_mint_authority_bump: old_global.ext_mint_authority_bump,
            distribute: true,
            yield_config,
            wrap_authorities: old_global.wrap_authorities.clone(),
        };

        // Write the new global account data
        let account_info = ctx.accounts.global_account.to_account_info();
        let data = &mut account_info.try_borrow_mut_data()?;
        let mut slice: &mut [u8] = &mut *data;

        new_global.serialize(&mut slice)?;

        Ok(())
    }
}
