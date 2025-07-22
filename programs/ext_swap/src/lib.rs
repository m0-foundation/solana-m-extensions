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
    auditors: "Asymmetric Research,Adevar Labs,OtterSec,Halborn"
}

declare_id!("MSwapi3WhNKMUGm9YrxGhypgUEt7wYQH3ZgG32XoWzH");

#[program]
pub mod ext_swap {
    use super::*;

    pub fn initialize_global<'info>(ctx: Context<InitializeGlobal>) -> Result<()> {
        InitializeGlobal::handler(ctx)
    }

    pub fn whitelist_extension<'info>(ctx: Context<WhitelistExt>) -> Result<()> {
        WhitelistExt::handler(ctx)
    }

    pub fn remove_whitelisted_extension<'info>(
        ctx: Context<RemoveWhitelistedExt>,
        ext_program: Pubkey,
    ) -> Result<()> {
        RemoveWhitelistedExt::handler(ctx, ext_program)
    }

    pub fn whitelist_unwrapper<'info>(
        ctx: Context<WhitelistUnwrapper>,
        authority: Pubkey,
    ) -> Result<()> {
        WhitelistUnwrapper::handler(ctx, authority)
    }

    pub fn remove_whitelisted_unwrapper<'info>(
        ctx: Context<RemoveWhitelistedUnwrapper>,
        authority: Pubkey,
    ) -> Result<()> {
        RemoveWhitelistedUnwrapper::handler(ctx, authority)
    }

    pub fn swap<'info>(
        ctx: Context<'_, '_, '_, 'info, Swap<'info>>,
        principal: u64,
        exact_out: bool,
        remaining_accounts_split_idx: u8,
    ) -> Result<()> {
        Swap::handler(
            ctx,
            principal,
            exact_out,
            remaining_accounts_split_idx as usize,
        )
    }

    pub fn wrap<'info>(
        ctx: Context<'_, '_, '_, 'info, Wrap<'info>>,
        principal: u64,
        exact_out: bool,
    ) -> Result<()> {
        Wrap::handler(ctx, principal, exact_out)
    }

    pub fn unwrap<'info>(
        ctx: Context<'_, '_, '_, 'info, Unwrap<'info>>,
        principal: u64,
        exact_out: bool,
    ) -> Result<()> {
        Unwrap::handler(ctx, principal, exact_out)
    }
}
