#![allow(unexpected_cfgs)]

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

use instructions::*;

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "M0 Extension Program",
    project_url: "https://m0.org/",
    contacts: "email:security@m0.xyz",
    policy: "https://github.com/m0-foundation/solana-m/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/m0-foundation/solana-extensions/tree/main/programs/m_ext",
    auditors: "Asymmetric Research,Adevar Labs,OtterSec,Halborn"
}

declare_id!("3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da");

// Validate feature combinations
const _: () = {
    let yield_features = {
        cfg!(feature = "scaled-ui") as u32
            + cfg!(feature = "no-yield") as u32
            + cfg!(feature = "crank") as u32
    };

    match yield_features {
        0 => panic!("No yield distribution feature enabled"),
        1 => {}
        2.. => panic!("Only one yield distribution feature can be enabled at a time"),
    }

    // There are no existing m_ext crank programs to migrate from V1, only wM
    // Therefore, "migrate" + "crank" without "wm" is not a valid configuration
    if cfg!(feature = "migrate") && cfg!(feature = "crank") && !cfg!(feature = "wm") {
        panic!(
            "Invalid feature configuration: 'migrate' and 'crank' cannot be enabled without 'wm'"
        );
    }

    // JMI can only be used with no-yield (not scaled-ui or crank)
    if cfg!(feature = "jmi") && (cfg!(feature = "scaled-ui") || cfg!(feature = "crank")) {
        panic!("JMI feature can only be enabled with no-yield variant");
    }
};

#[program]
pub mod m_ext {
    use super::*;

    // Admin instructions
    #[cfg(feature = "scaled-ui")]
    pub fn initialize(
        ctx: Context<Initialize>,
        wrap_authorities: Vec<Pubkey>,
        fee_bps: u64,
    ) -> Result<()> {
        Initialize::handler(ctx, wrap_authorities, Some(fee_bps), None)
    }

    #[cfg(feature = "crank")]
    pub fn initialize(
        ctx: Context<Initialize>,
        wrap_authorities: Vec<Pubkey>,
        earn_authority: Pubkey,
    ) -> Result<()> {
        Initialize::handler(ctx, wrap_authorities, None, Some(earn_authority))
    }

    #[cfg(not(any(feature = "crank", feature = "scaled-ui")))]
    pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        Initialize::handler(ctx, wrap_authorities, None, None)
    }

    #[cfg(feature = "scaled-ui")]
    pub fn set_fee(ctx: Context<SetFee>, fee_bps: u64) -> Result<()> {
        SetFee::handler(ctx, fee_bps)
    }

    pub fn add_wrap_authority(
        ctx: Context<AddWrapAuthority>,
        new_wrap_authority: Pubkey,
    ) -> Result<()> {
        AddWrapAuthority::handler(ctx, new_wrap_authority)
    }

    pub fn remove_wrap_authority(
        ctx: Context<RemoveWrapAuthority>,
        wrap_authority: Pubkey,
    ) -> Result<()> {
        RemoveWrapAuthority::handler(ctx, wrap_authority)
    }

    #[cfg(any(feature = "scaled-ui", feature = "no-yield"))]
    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        ClaimFees::handler(ctx)
    }

    pub fn transfer_admin(ctx: Context<TransferAdmin>, new_admin: Pubkey) -> Result<()> {
        TransferAdmin::handler(ctx, new_admin)
    }

    pub fn accept_admin(ctx: Context<AcceptAdmin>) -> Result<()> {
        AcceptAdmin::handler(ctx)
    }

    pub fn revoke_admin_transfer(ctx: Context<RevokeAdminTransfer>) -> Result<()> {
        RevokeAdminTransfer::handler(ctx)
    }

    // JMI-specific instructions
    #[cfg(feature = "jmi")]
    pub fn set_asset_cap(ctx: Context<SetAssetCap>, cap: u64) -> Result<()> {
        SetAssetCap::handler(ctx, cap)
    }

    #[cfg(feature = "jmi")]
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        Pause::handler(ctx)
    }

    #[cfg(feature = "jmi")]
    pub fn unpause(ctx: Context<Unpause>) -> Result<()> {
        Unpause::handler(ctx)
    }

    #[cfg(feature = "jmi")]
    pub fn replace_asset_with_m(ctx: Context<ReplaceAssetWithM>, m_amount: u64) -> Result<()> {
        ReplaceAssetWithM::handler(ctx, m_amount)
    }

    #[cfg(feature = "jmi")]
    pub fn wrap_asset(ctx: Context<WrapAsset>, amount: u64) -> Result<()> {
        WrapAsset::handler(ctx, amount)
    }

    #[cfg(feature = "crank")]
    pub fn set_earn_authority(
        ctx: Context<SetEarnAuthority>,
        earn_authority: Pubkey,
    ) -> Result<()> {
        SetEarnAuthority::handler(ctx, earn_authority)
    }

    #[cfg(feature = "crank")]
    pub fn add_earn_manager(
        ctx: Context<AddEarnManager>,
        earn_manager: Pubkey,
        fee_bps: u64,
    ) -> Result<()> {
        AddEarnManager::handler(ctx, earn_manager, fee_bps)
    }

    #[cfg(feature = "crank")]
    pub fn remove_earn_manager(ctx: Context<RemoveEarnManager>) -> Result<()> {
        RemoveEarnManager::handler(ctx)
    }

    #[cfg(feature = "migrate")]
    pub fn migrate_m(ctx: Context<MigrateM>) -> Result<()> {
        MigrateM::handler(ctx)
    }

    // Wrap authority instructions

    pub fn wrap(ctx: Context<Wrap>, m_principal: u64) -> Result<()> {
        Wrap::handler(ctx, m_principal)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        Unwrap::handler(ctx, amount)
    }

    // Sync
    #[cfg(any(feature = "scaled-ui", feature = "crank"))]
    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        Sync::handler(ctx)
    }

    // Earn Authority instructions (Crank variant only)
    #[cfg(feature = "crank")]
    pub fn claim_for(ctx: Context<ClaimFor>, snapshot_balance: u64) -> Result<()> {
        ClaimFor::handler(ctx, snapshot_balance)
    }

    // Earn Manager instructions (Crank variant only)
    #[cfg(feature = "crank")]
    pub fn add_earner(ctx: Context<AddEarner>, user: Pubkey) -> Result<()> {
        AddEarner::handler(ctx, user)
    }

    #[cfg(feature = "crank")]
    pub fn configure_earn_manager(
        ctx: Context<ConfigureEarnManager>,
        fee_bps: Option<u64>,
    ) -> Result<()> {
        ConfigureEarnManager::handler(ctx, fee_bps)
    }

    #[cfg(feature = "crank")]
    pub fn remove_earner(ctx: Context<RemoveEarner>) -> Result<()> {
        RemoveEarner::handler(ctx)
    }

    #[cfg(feature = "crank")]
    pub fn transfer_earner(ctx: Context<TransferEarner>, to_earn_manager: Pubkey) -> Result<()> {
        TransferEarner::handler(ctx, to_earn_manager)
    }

    // Earner instructions (Crank variant only)
    #[cfg(feature = "crank")]
    pub fn set_recipient(ctx: Context<SetRecipient>) -> Result<()> {
        SetRecipient::handler(ctx)
    }

    // Open instructions (Crank variant only)
    #[cfg(feature = "crank")]
    pub fn remove_orphaned_earner(ctx: Context<RemoveOrphanedEarner>) -> Result<()> {
        RemoveOrphanedEarner::handler(ctx)
    }
}
