use anchor_lang::prelude::*;
use anchor_spl::token_interface::{Mint, TokenAccount};
use earn::state::Global as EarnGlobal;

declare_program!(ext_core);
use ext_core::{
    accounts::{Config as CoreConfig, ExtConfig},
    constants::{CONFIG_SEED as CORE_CONFIG_SEED, EXT_CONFIG_SEED_PREFIX, M_VAULT_SEED_PREFIX},
    program::ExtCore,
};

declare_id!("4TqLZemQ5ba29dgg1N2NvY65hyG2nDF5EnyGXm8xfjHb");

#[program]
pub mod ext_yield_interface {
    use super::*;

    pub fn sync(_ctx: Context<Sync>) -> Result<u64> {
        Ok(1_000_000_000_000u64)
    }
}

#[derive(Accounts)]
pub struct Sync<'info> {
    m_mint: InterfaceAccount<'info, Mint>,

    ext_mint: InterfaceAccount<'info, Mint>,

    /// CHECK: Add validation based on the specific implementation
    ext_global_account: UncheckedAccount<'info>,

    m_earn_global_account: Account<'info, EarnGlobal>,

    #[account(
        seeds = [CORE_CONFIG_SEED],
        bump = core_config.bump,
        seeds::program = ExtCore::id(),
        has_one = m_earn_global_account,
        has_one = m_mint,
    )]
    core_config: Account<'info, CoreConfig>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_mint.key().as_ref()],
        bump = ext_config.bump,
        has_one = ext_mint,
    )]
    ext_config: Account<'info, ExtConfig>,

    /// CHECK: This account is validated by the seed, it stores no data
    #[account(
        seeds = [M_VAULT_SEED_PREFIX, ext_mint.key().as_ref()],
        bump,
        seeds::program = ExtCore::id(),
    )]
    m_vault: AccountInfo<'info>,

    #[account(
        associated_token::mint = m_mint,
        associated_token::authority = m_vault,
        associated_token::token_program = core_config.m_token_program,
    )]
    vault_m_token_account: InterfaceAccount<'info, TokenAccount>,
}
