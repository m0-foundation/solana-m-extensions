#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

#[cfg(feature = "transfer-hook")]
use spl_discriminator::SplDiscriminate;
#[cfg(feature = "transfer-hook")]
use spl_transfer_hook_interface::instruction::{
    ExecuteInstruction, InitializeExtraAccountMetaListInstruction,
};

pub use instructions::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("4yXxi6sRvWpYUUUx3CTnVKuKLYegooLoNakrePLLVoV4");

// Validate feature combinations
const _: () = {
    let yield_features = {
        cfg!(feature = "scaled-ui") as u32
            + cfg!(feature = "ibt") as u32
            + cfg!(feature = "yield-crank") as u32
            + cfg!(feature = "no-yield") as u32
    };

    match yield_features {
        0 => panic!("No yield distribution feature enabled"),
        1 => {}
        2.. => panic!("Only one yield distribution feature can be enabled at a time"),
    }
};

const _: () = {
    let hook_features = {
        cfg!(feature = "transfer-hook") as u32 + cfg!(any(feature = "transfer-whitelist")) as u32
    };

    match hook_features {
        1 => panic!("Tranfer hook is required with transfer hook features"),
        _ => {}
    }
};

#[program]
pub mod dynamic_ext {
    use super::*;

    // Admin instructions

    #[cfg(feature = "permissioned-wrapping")]
    pub fn initialize(
        ctx: Context<Initialize>,
        yield_fee_bps: u16,
        wrap_authorities: Vec<Pubkey>,
    ) -> Result<()> {
        instructions::initialize::Initialize::handler(ctx, yield_fee_bps, wrap_authorities)
    }

    #[cfg(not(feature = "permissioned-wrapping"))]
    pub fn initialize(ctx: Context<Initialize>, yield_fee_bps: u16) -> Result<()> {
        instructions::initialize::Initialize::handler(ctx, yield_fee_bps, vec![])
    }

    // Wrap authority instructions

    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        instructions::wrap::Wrap::handler(ctx, amount)
    }

    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        instructions::unwrap::Unwrap::handler(ctx, amount)
    }

    // Open instructions

    pub fn sync_index(ctx: Context<SyncIndex>) -> Result<()> {
        instructions::sync::SyncIndex::handler(ctx)
    }

    // Transfer hook

    #[cfg(feature = "transfer-hook")]
    #[instruction(discriminator = InitializeExtraAccountMetaListInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn initialize_transfer_hook(ctx: Context<InitializeExtraAccountMetaList>) -> Result<()> {
        instructions::transfer_hook::InitializeExtraAccountMetaList::handler(ctx)
    }

    #[cfg(feature = "transfer-hook")]
    #[instruction(discriminator = ExecuteInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        instructions::transfer_hook::TransferHook::handler(ctx, amount)
    }
}
