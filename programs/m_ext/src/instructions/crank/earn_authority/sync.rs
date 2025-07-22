use anchor_lang::prelude::*;
use anchor_spl::token_interface::Mint;
use earn::{constants::INDEX_SCALE_F64, utils::conversion::get_scaled_ui_config};

use crate::{
    errors::ExtError,
    state::{ExtGlobal, EXT_GLOBAL_SEED},
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
    pub global_account: Account<'info, ExtGlobal>,
}

impl Sync<'_> {
    /// This instruction allows the earn authority to sync the index and timestamp with the latest values.
    /// It recalculates the index based on the current multiplier and updates the global account.
    /// The multiplier is scaled to a u64 index for storage.

    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // Convert the multiplier to a u64 index
        let scaled_ui_config = get_scaled_ui_config(&ctx.accounts.m_mint)?;
        let current_multiplier: f64 = scaled_ui_config.new_multiplier.into();
        let timestamp: i64 = scaled_ui_config.new_multiplier_effective_timestamp.into();
        let current_index: u64 = (INDEX_SCALE_F64 * current_multiplier).trunc() as u64;

        // Update the local data
        ctx.accounts.global_account.yield_config.index = current_index;
        ctx.accounts.global_account.yield_config.timestamp = timestamp as u64;

        emit!(SyncIndexUpdate {
            index: ctx.accounts.global_account.yield_config.index,
            ts: ctx.accounts.global_account.yield_config.timestamp,
        });

        Ok(())
    }
}

#[event]
pub struct SyncIndexUpdate {
    pub index: u64,
    pub ts: u64,
}
