// scaled_ui_ext/lib.rs - top-level program file

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
    name: "<insert name>>",
    project_url: "<insert project url>",
    contacts: "<insert contact email>",
    policy: "<insert terms file>",
    // Optional Fields
    preferred_languages: "en",
    source_code: "<insert source code url>",
    auditors: "<insert auditor name(s)>"
}

declare_id!("3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da");

#[program]
pub mod scaled_ui_ext {
    use super::*;

    // Admin instructions

    pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        instructions::initialize::handler(ctx, wrap_authorities)
    }

    pub fn set_m_mint(ctx: Context<SetMMint>) -> Result<()> {
        instructions::set_m_mint::handler(ctx)
    }

    pub fn update_wrap_authority(
        ctx: Context<UpdateWrapAuthority>,
        index: u8,
        new_wrap_authority: Pubkey,
    ) -> Result<()> {
        instructions::update_wrap_authority::handler(ctx, index, new_wrap_authority)
    }

    // Wrap authority instructions

    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        instructions::wrap::handler(ctx, amount)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        instructions::unwrap::handler(ctx, amount)
    }

    // Open instructions

    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        instructions::sync::handler(ctx)
    }
}
