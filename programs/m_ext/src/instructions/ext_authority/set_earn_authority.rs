// external dependencies
use anchor_lang::prelude::*;

// local dependencies
use crate::{
    errors::ExtError,
    state::{ExtConfig, EXT_CONFIG_SEED_PREFIX},
};

#[derive(Accounts)]
pub struct SetEarnAuthority<'info> {
    pub ext_authority: Signer<'info>,

    #[account(
        mut,
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        has_one = ext_authority @ ExtError::NotAuthorized,
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,
}

impl<'info> SetEarnAuthority<'info> {
    fn validate(&self) -> Result<()> {
        // Revert if extension does not support earner accounts
        match self.ext_config.yield_config {
            YieldConfig::Manual(_) => {}
            _ => {
                return err!(ExtError::InstructionNotSupported);
            }
        }

        Ok(())
    }

    #[access_control(ctx.accounts.validate())]
    pub fn handler(ctx: Context<Self>, new_earn_authority: Pubkey) -> Result<()> {
        match &mut ctx.accounts.ext_config.yield_config {
            YieldConfig::Manual(config) => {
                config.earn_authority = new_earn_authority;
            }
            _ => unreachable!(),
        }

        Ok(())
    }
}
