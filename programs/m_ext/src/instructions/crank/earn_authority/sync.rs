use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use earn::{constants::INDEX_SCALE_F64, utils::conversion::get_scaled_ui_config};

use crate::{
    errors::ExtError,
    state::{ExtGlobalV2, EXT_GLOBAL_SEED},
};

#[derive(Accounts)]
pub struct Sync<'info> {
    #[account(
        constraint = earn_authority.key() == global_account.yield_config.earn_authority @ ExtError::NotAuthorized,
    )]
    pub earn_authority: Signer<'info>,

    pub m_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        seeds = [EXT_GLOBAL_SEED],
        bump = global_account.bump,
        has_one = m_mint @ ExtError::InvalidAccount,
    )]
    pub global_account: Account<'info, ExtGlobalV2>,
}

impl Sync<'_> {
    /// This instruction allows the earn authority to sync the index and timestamp with the latest values.
    /// It recalculates the index based on the current multiplier and updates the global account.
    /// The multiplier is scaled to a u64 index for storage.

    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Convert the latest M multiplier to a u64 index
        let scaled_ui_config = get_scaled_ui_config(&ctx.accounts.m_mint)?;
        let current_multiplier: f64 = scaled_ui_config.new_multiplier.into();
        let timestamp: i64 = scaled_ui_config.new_multiplier_effective_timestamp.into();
        let current_index: u64 = (INDEX_SCALE_F64 * current_multiplier).trunc() as u64;

        // If yield is being distributed, calculate the new EXT index and update it
        if ctx.accounts.global_account.distribute {
            // Calculate the new EXT index based on the last synced EXT index and the change in M index
            let last_ext_index = ctx.accounts.global_account.yield_config.last_ext_index;
            let last_m_index = ctx.accounts.global_account.yield_config.last_m_index;

            let new_ext_index = (last_ext_index as u128)
                .checked_mul(current_index as u128)
                .ok_or(ExtError::MathOverflow)?
                .checked_div(last_m_index as u128)
                .ok_or(ExtError::MathUnderflow)? as u64;

            ctx.accounts.global_account.yield_config.last_ext_index = new_ext_index;
        }

        // Update the M index and timestamp to the current values on the M mint
        ctx.accounts.global_account.yield_config.last_m_index = current_index;
        ctx.accounts.global_account.yield_config.timestamp = timestamp as u64;

        emit!(SyncIndexUpdate {
            distribute: ctx.accounts.global_account.distribute,
            last_m_index: ctx.accounts.global_account.yield_config.last_m_index,
            last_ext_index: ctx.accounts.global_account.yield_config.last_ext_index,
            ts: ctx.accounts.global_account.yield_config.timestamp,
        });

        Ok(())
    }
}

#[event]
pub struct SyncIndexUpdate {
    pub distribute: bool,
    pub last_m_index: u64,
    pub last_ext_index: u64,
    pub ts: u64,
}
