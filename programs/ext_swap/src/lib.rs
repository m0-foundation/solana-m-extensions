#![allow(unexpected_cfgs)]

pub mod errors;
pub mod instructions;
pub mod state;

use anchor_lang::prelude::*;
use instructions::*;

#[cfg(not(feature = "no-entrypoint"))]
solana_security_txt::security_txt! {
    name: "M0 Swap Program",
    project_url: "https://m0.org/",
    contacts: "email:security@m0.xyz",
    policy: "https://github.com/m0-foundation/solana-m/blob/main/SECURITY.md",
    preferred_languages: "en",
    source_code: "https://github.com/m0-foundation/solana-extensions/tree/main/programs/ext_swap",
    auditors: ""
}

declare_id!("MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH");

#[program]
pub mod ext_swap {
    use super::*;

    pub fn initialize_global<'info>(ctx: Context<InitializeGlobal>, m_mint: Pubkey) -> Result<()> {
        InitializeGlobal::handler(ctx, m_mint)
    }

    pub fn whitelist_ext<'info>(
        ctx: Context<WhitelistExt>,
        ext_program: Pubkey,
        insert_idx: u8,
    ) -> Result<()> {
        WhitelistExt::handler(ctx, ext_program, insert_idx as usize)
    }

    pub fn swap<'info>(
        ctx: Context<'_, '_, '_, 'info, Swap<'info>>,
        amount: u64,
        remaining_accounts_split_idx: u8,
    ) -> Result<()> {
        Swap::handler(ctx, amount, remaining_accounts_split_idx as usize)
    }
}
