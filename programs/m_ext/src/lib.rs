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

declare_id!("81gYpXqg8ZT9gdkFSe35eqiitqBWqVfYwDwVfXuk8Xfw");

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

    // #[cfg(feature = "no-yield")]
    // pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
    //     Initialize::handler(ctx, wrap_authorities, 0)
    // }

    #[cfg(feature = "scaled-ui")]
    pub fn set_fee(ctx: Context<SetFee>, fee_bps: u64) -> Result<()> {
        SetFee::handler(ctx, fee_bps)
    }

    pub fn set_m_mint(ctx: Context<SetMMint>) -> Result<()> {
        SetMMint::handler(ctx)
    }

    pub fn update_wrap_authority(
        ctx: Context<UpdateWrapAuthority>,
        index: u8,
        new_wrap_authority: Pubkey,
    ) -> Result<()> {
        UpdateWrapAuthority::handler(ctx, index, new_wrap_authority)
    }

    pub fn claim_fees(ctx: Context<ClaimFees>) -> Result<()> {
        ClaimFees::handler(ctx)
    }

    // Wrap authority instructions

    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        Wrap::handler(ctx, amount)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        Unwrap::handler(ctx, amount)
    }

    // Open instructions

    #[cfg(feature = "scaled-ui")]
    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        Sync::handler(ctx)
    }
}
