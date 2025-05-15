use anchor_lang::prelude::*;

use crate::{
    errors::ExtError,
    state::{
        EarnManager, Earner, ExtConfig, EARNER_SEED_PREFIX, EARN_MANAGER_SEED_PREFIX,
        EXT_CONFIG_SEED_PREFIX,
    },
};

#[derive(Accounts)]
#[instruction(to_earn_manager: Pubkey)]
pub struct TransferEarner<'info> {
    pub signer: Signer<'info>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        mut,
        constraint = earner_account.earn_manager == signer.key() @ ExtError::NotAuthorized,
        seeds = [EARNER_SEED_PREFIX, ext_config.ext_mint.as_ref(), earner_account.user_token_account.as_ref()],
        bump = earner_account.bump,
    )]
    pub earner_account: Account<'info, Earner>,

    #[account(
        constraint = from_earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), signer.key().as_ref()],
        bump = from_earn_manager_account.bump,
    )]
    pub from_earn_manager_account: Account<'info, EarnManager>,

    #[account(
        constraint = to_earn_manager_account.is_active @ ExtError::NotActive,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), to_earn_manager.as_ref()],
        bump = to_earn_manager_account.bump,
    )]
    pub to_earn_manager_account: Account<'info, EarnManager>,
}

impl<'info> TransferEarner<'info> {
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
    pub fn handler(ctx: Context<Self>, to_earn_manager: Pubkey) -> Result<()> {
        ctx.accounts.earner_account.earn_manager = to_earn_manager;

        Ok(())
    }
}
