// external dependencies
use anchor_lang::prelude::*;
use anchor_spl::token_interface::TokenAccount;

// local dependencies
use crate::{
    constants::ONE_HUNDRED_PERCENT_U64,
    errors::ExtError,
    state::{EarnManager, ExtConfig, EARN_MANAGER_SEED_PREFIX, EXT_CONFIG_SEED_PREFIX},
};

#[derive(Accounts)]
pub struct ConfigureEarnManager<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    #[account(
        seeds = [EXT_CONFIG_SEED_PREFIX, ext_config.ext_mint.as_ref()],
        bump = ext_config.bump,
    )]
    pub ext_config: Account<'info, ExtConfig>,

    #[account(
        mut,
        seeds = [EARN_MANAGER_SEED_PREFIX, ext_config.ext_mint.as_ref(), signer.key().as_ref()],
        bump = earn_manager_account.bump
    )]
    pub earn_manager_account: Account<'info, EarnManager>,

    #[account(token::mint = ext_config.ext_mint)]
    pub fee_token_account: Option<InterfaceAccount<'info, TokenAccount>>,
}

impl<'info> ConfigureEarnManager<'info> {
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
    pub fn handler(ctx: Context<Self>, fee_bps: Option<u64>) -> Result<()> {
        if let Some(fee_bps) = fee_bps {
            // Validate the fee percent is not greater than 100%
            if fee_bps > ONE_HUNDRED_PERCENT_U64 {
                return err!(ExtError::InvalidParam);
            }

            ctx.accounts.earn_manager_account.fee_bps = fee_bps;
        }

        if let Some(fee_token_account) = &ctx.accounts.fee_token_account {
            ctx.accounts.earn_manager_account.fee_token_account = fee_token_account.key();
        }

        Ok(())
    }
}
