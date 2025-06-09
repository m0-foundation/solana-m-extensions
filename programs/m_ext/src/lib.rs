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

declare_id!("3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da");

// Validate feature combinations
const _: () = {
    let yield_features = { cfg!(feature = "ibt") as u32 + cfg!(feature = "no-yield") as u32 };

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

    pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        Initialize::handler(ctx, wrap_authorities)
    }

    #[cfg(feature = "ibt")]
    pub fn set_ibt_rate(ctx: Context<SetIbtRate>, rate: i16) -> Result<()> {
        SetIbtRate::handler(ctx, rate)
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
}
