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
    use super::*;

    // Admin instructions

    // pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
    //     instructions::initialize::handler(ctx, wrap_authorities)
    // }

    // pub fn set_m_mint(ctx: Context<SetMMint>) -> Result<()> {
    //     instructions::set_m_mint::handler(ctx)
    // }

    // pub fn update_wrap_authority(
    //     ctx: Context<UpdateWrapAuthority>,
    //     index: u8,
    //     new_wrap_authority: Pubkey,
    // ) -> Result<()> {
    //     instructions::update_wrap_authority::handler(ctx, index, new_wrap_authority)
    // }

    // User instructions
    pub fn swap(ctx: Context<Swap>, amount_m: u64) -> Result<()> {
        instructions::swap::handler(ctx, amount_m)
    }

    pub fn wrap<'info>(ctx: Context<'_, '_, '_, 'info, Wrap<'info>>, amount_m: u64) -> Result<()> {
        Wrap::handler(ctx, amount_m)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount_m: u64) -> Result<()> {
        instructions::unwrap::handler(ctx, amount_m)
    }

    pub fn sync(ctx: Context<Sync>) -> Result<()> {
        instructions::sync::handler(ctx)
    }
}

#[derive(Accounts)]
pub struct Initialize {}
