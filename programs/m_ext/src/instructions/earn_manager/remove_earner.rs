// external dependencies
use anchor_lang::prelude::*;

// local dependencies
use crate::{
    errors::ExtError,
    state::{
        EarnManager, Earner, ExtConfig, EARNER_SEED_PREFIX, EARN_MANAGER_SEED_PREFIX,
        EXT_CONFIG_SEED_PREFIX,
    },
};

#[derive(Accounts)]
pub struct RemoveEarner<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        mut,
        close = signer,
        constraint = earner_account.earn_manager == signer.key() @ ExtError::NotAuthorized,
        seeds = [EARNER_SEED_PREFIX, ext_config.ext_mint.as_ref(), earner_account.user_token_account.as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, Earner>,

    #[account(
        constraint = earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), signer.key().as_ref()],
        bump = earn_manager_account.bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    pub system_program: Program<'info, System>,
}

impl<'info> RemoveEarner<'info> {
    fn validate(&self) -> Result<()> {
        // Revert if extension does not support earner accounts
        match self.ext_config.yield_config {
            YieldConfig::Crank(_) => {}
            YieldConfig::MerkleClaims(_) => {}
            _ => {
                return err!(ExtError::InstructionNotSupported);
            }
        }

        Ok(())
    }
    #[access_control(ctx.accounts.validate())]
    pub fn handler(_ctx: Context<Self>) -> Result<()> {
        Ok(())
    }
}
