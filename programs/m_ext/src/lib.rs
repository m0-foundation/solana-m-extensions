#![allow(unexpected_cfgs)]

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use anchor_lang::prelude::*;

use instructions::*;
use utils::quote::Op;

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
    let yield_features = { cfg!(feature = "scaled-ui") as u32 + cfg!(feature = "no-yield") as u32 };

    match yield_features {
        0 => panic!("No yield distribution feature enabled"),
        1 => {}
        2.. => panic!("Only one yield distribution feature can be enabled at a time"),
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
        Initialize::handler(ctx, wrap_authorities, fee_bps)
    }

    #[cfg(feature = "no-yield")]
    pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        Initialize::handler(ctx, wrap_authorities, 0)
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

    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        ClaimFees::handler(ctx)
    }

    // Wrap authority instructions

    pub fn wrap(ctx: Context<Wrap>, principal: u64, exact_out: bool) -> Result<()> {
        Wrap::handler(ctx, principal, exact_out)
    }

    pub fn unwrap(ctx: Context<Unwrap>, principal: u64, exact_out: bool) -> Result<()> {
        Unwrap::handler(ctx, principal, exact_out)
    }

    // Open instructions

    #[cfg(feature = "scaled-ui")]
    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        Sync::handler(ctx)
    }

    pub fn quote(
        ctx: Context<Quote>,
        operation: Op,
        principal: u64,
        exact_out: bool,
    ) -> Result<u64> {
        Quote::handler(ctx, operation, principal, exact_out)
    }
}
