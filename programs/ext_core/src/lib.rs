use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;
pub mod utils;

use instructions::*;

declare_id!("91zVUYVKdA79VgkKEgk9nrGMqeDqvekvd9h8hfxLCKTF");

#[program]
pub mod ext_core {
    use super::*;

    pub fn wrap<'info>(ctx: Context<'_, '_, '_, 'info, Wrap<'info>>, amount: u64) -> Result<()> {
        instructions::open::wrap::handler(ctx, amount)
    }
}
