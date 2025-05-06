#![allow(unexpected_cfgs)]

use anchor_lang::prelude::*;

#[cfg(feature = "transfer-hook")]
use spl_transfer_hook_interface::instruction::TransferHookInstruction;

pub use instructions::*;

pub mod constants;
pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("4yXxi6sRvWpYUUUx3CTnVKuKLYegooLoNakrePLLVoV4");

#[program]
pub mod dynamic_ext {
    use super::*;

    // Admin instructions

    #[cfg(feature = "permissioned-wrapping")]
    pub fn initialize(ctx: Context<Initialize>, wrap_authorities: Vec<Pubkey>) -> Result<()> {
        instructions::initialize::Initialize::handler(ctx, wrap_authorities)
    }

    #[cfg(not(feature = "permissioned-wrapping"))]
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        instructions::initialize::Initialize::handler(ctx, vec![])
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
    pub fn transfer_hook(ctx: Context<TransferHook>, amount: u64) -> Result<()> {
        instructions::transfer_hook::TransferHook::handler(ctx, amount)
    }

    // fallback instruction handler as workaround to anchor instruction discriminator check
    #[cfg(feature = "transfer-hook")]
    pub fn fallback<'info>(
        program_id: &Pubkey,
        accounts: &'info [AccountInfo<'info>],
        data: &[u8],
    ) -> Result<()> {
        let instruction = TransferHookInstruction::unpack(data)?;

        // match instruction discriminator to transfer hook interface execute instruction
        match instruction {
            TransferHookInstruction::Execute { amount } => {
                let amount_bytes = amount.to_le_bytes();

                // invoke custom transfer hook instruction on our program
                __private::__global::transfer_hook(program_id, accounts, &amount_bytes)
            }
            _ => return Err(ProgramError::InvalidInstructionData.into()),
        }
    }
}
