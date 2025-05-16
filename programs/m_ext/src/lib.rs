// m_ext/lib.rs - top-level program file

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

use instructions::*;

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    // Required fields
    name: "<insert name>",
    project_url: "<insert project url>",
    contacts: "<insert contact email>",
    policy: "<insert terms file>",
    // Optional Fields
    preferred_languages: "en",
    source_code: "<insert source code url>",
    auditors: "<insert auditor name(s)>"
}

declare_id!("29MecrtFgHzVJYUsSa7xgng1LA1eogpfgoNhHwxJvVr4");

#[program]
pub mod m_ext {
    use std::task::Context;

    use super::*;

    // Admin instructions

    pub fn initialize_config(ctx: Context<InitializeConfig>) -> Result<()> {
        InitializeConfig::handler(ctx)
    }

    // Ext Authority instructions

    pub fn initialize_ext(
        ctx: Context<InitializeExt>,
        yield_params: YieldParams,
        access_params: AccessParams,
    ) -> Result<()> {
        InitializeExt::handler(ctx, yield_params, access_params)
    }

    // only YieldConfig::Manual
    pub fn add_earn_manager(
        ctx: Context<AddEarnManager>,
        earn_manager: Pubkey,
        fee_bps: u64,
    ) -> Result<()> {
        AddEarnManager::handler(ctx, earn_manager, fee_bps)
    }

    // only YieldConfig::Manual
    pub fn remove_earn_manager(ctx: Context<RemoveEarnManager>) -> Result<()> {
        RemoveEarnManager::handler(ctx)
    }

    // only YieldConfig::Manual
    pub fn set_earn_authority(
        ctx: Context<SetEarnAuthority>,
        new_earn_authority: Pubkey,
    ) -> Result<()> {
        SetEarnAuthority::handler(ctx, new_earn_authority)
    }

    // only YieldConfig::Rebasing, YieldConfig::None
    pub fn claim_excess(ctx: Context<ClaimExcess>) -> Result<()> {
        ClaimExcess::handler(ctx)
    }

    // Earn Manager instructions (only YieldConfig::Manual)

    pub fn add_earner(ctx: Context<AddEarner>, user: Pubkey) -> Result<()> {
        AddEarner::handler(ctx, user)
    }

    pub fn remove_earner(ctx: Context<RemoveEarner>) -> Result<()> {
        RemoveEarner::handler(ctx)
    }

    pub fn transfer_earner(ctx: Context<TransferEarner>, to_earn_manager: Pubkey) -> Result<()> {
        TransferEarner::handler(ctx, to_earn_manager)
    }

    pub fn configure_earn_manager(
        ctx: Context<ConfigureEarnManager>,
        fee_bps: Option<u64>,
    ) -> Result<()> {
        ConfigureEarnManager::handler(ctx, fee_bps)
    }

    // Earn Authority instructions

    // only YieldConfig::Manual::Crank
    pub fn claim_for(ctx: Context<ClaimFor>, snapshot_balance: u64) -> Result<()> {
        ClaimFor::handler(ctx, snapshot_balance)
    }

    // only YieldConfig::Manual::MerkleClaims
    pub fn update_claims_root(
        ctx: Context<UpdateClaimsRoot>,
        merkle_root: [u8; 32],
        new_root_ext_index: u64,
        new_claimable_amount: u64,
    ) -> Result<()> {
        UpdateClaimsRoot::handler(ctx, merkle_root, new_root_ext_index, new_claimable_amount)
    }

    // permissioned for YieldConfig::Manual, open for YieldConfig::Rebasing
    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        Sync::handler(ctx)
    }

    // User instructions

    pub fn swap(ctx: Context<Swap>, amount_m: u64) -> Result<()> {
        Swap::handler(ctx, amount_m)
    }

    pub fn wrap<'info>(ctx: Context<'_, '_, '_, 'info, Wrap<'info>>, amount_m: u64) -> Result<()> {
        Wrap::handler(ctx, amount_m)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount_m: u64) -> Result<()> {
        Unwrap::handler(ctx, amount_m)
    }

    // only YieldConfig::Manual::MerkleClaims
    pub fn claim(ctx: Context<Claim>, claimable_amount: u64, proof: Vec<[u8; 32]>) -> Result<()> {
        Claim::handler(ctx, claimable_amount, proof)
    }
}

#[derive(Accounts)]
pub struct Initialize {}
