use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{EarnManager, ExtConfig, EARN_MANAGER_SEED_PREFIX, EXT_CONFIG_SEED_PREFIX},
};

#[derive(Accounts)]
pub struct RemoveEarnManager<'info> {
    pub ext_authority: Signer<'info>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
        has_one = ext_authority @ ExtError::NotAuthorized,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        mut,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), earn_manager_account.earn_manager.as_ref()],
        bump = earn_manager_account.bump,
    )]
    pub earn_manager_account: Account<'info, EarnManager>,
}

impl<'info> RemoveEarnManager<'info> {
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
    pub fn handler(ctx: Context<Self>) -> Result<()> {
        // We set the is_active flag to false instead of closing the account to avoid issues
        // with earner instructions which require the earn manager account
        ctx.accounts.earn_manager_account.is_active = false;

        Ok(())
    }
}
