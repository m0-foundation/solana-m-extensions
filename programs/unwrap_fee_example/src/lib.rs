use anchor_lang::prelude::*;
use m_ext_interface::instruction::{UnwrapInstruction, WrapInstruction};
use spl_discriminator::SplDiscriminate;

use instructions::*;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

declare_id!("FokZWSbq8zq8W75imoTJte3HkS2C9U1CsT71BV9rRbQC");

// TODO: replace with the actual program ID
const EXT_CORE_PROGRAM_ID: Pubkey = pubkey!("3C865D264L4NkAm78zfnDzQJJvXuU3fMjRUvRxyPi5da");

#[program]
pub mod unwrap_fee_example {
    use super::*;

    #[instruction(discriminator = WrapInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn wrap(ctx: Context<Wrap>, amount: u64) -> Result<()> {
        Wrap::handler(ctx, amount)
    }

    #[instruction(discriminator = UnwrapInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn unwrap(ctx: Context<Unwrap>, amount: u64) -> Result<()> {
        Unwrap::handler(ctx, amount)
    }
}
