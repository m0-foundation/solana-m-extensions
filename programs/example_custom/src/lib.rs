use anchor_lang::prelude::*;

declare_id!("FokZWSbq8zq8W75imoTJte3HkS2C9U1CsT71BV9rRbQC");

use m_ext_interface::instruction::{UnwrapInstruction, WrapInstruction};
use spl_discriminator::SplDiscriminate;

#[program]
pub mod example_custom {
    use super::*;

    #[instruction(discriminator = WrapInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn wrap(ctx: Context<Wrap>) -> Result<()> {
        Ok(())
    }

    #[instruction(discriminator = UnwrapInstruction::SPL_DISCRIMINATOR_SLICE)]
    pub fn unwrap(ctx: Context<Unwrap>) -> Result<()> {
        Ok(())
    }
}

#[derive(Accounts)]
pub struct Wrap {}

#[derive(Accounts)]
pub struct Unwrap {}
